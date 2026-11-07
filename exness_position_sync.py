"""Read-only Exness trading-history sync and position aggregation."""

import hashlib
import json
import math
import re
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import urlencode

from exness_importer import chart_symbol
from exness_market_provider import market_scope


# Reserve four signed GETs for gateway discovery, limits, account verification,
# and the current-state snapshot; history paging is capped at 36 requests.
MAX_HISTORY_REQUESTS = 36
MAX_SYNC_REQUESTS = MAX_HISTORY_REQUESTS + 4
MAX_SYNC_SECONDS = 45
PAGE_SIZE = 200
MAX_DEALS_PER_SYNC = 100_000
OVERLAP_MS = 24 * 60 * 60 * 1000
MAX_POSITION_ID_LENGTH = 80


def _utc_ms(value):
    text = str(value).replace("Z", "+00:00")
    # Python 3.9 accepts only 3/6 fractional digits. Exness also returns
    # shorter fractions; normalize precision without changing the UTC instant.
    text = re.sub(r"\.(\d+)(?=[+-]\d{2}:\d{2}$)",
                  lambda match: "." + match.group(1).ljust(6, "0")[:6], text)
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        raise ValueError()
    return int(parsed.timestamp() * 1000)


def _decimal(value, *, positive=False, optional=False):
    if optional and value in (None, ""):
        return None
    try:
        result = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError() from None
    if not result.is_finite() or not math.isfinite(float(result)) or (positive and result <= 0):
        raise ValueError()
    return result


def _setting(connection, key):
    row = connection.execute("SELECT value FROM app_settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None


def _upsert_setting(connection, key, value):
    connection.execute(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value)
    )


def _clean_deal(item):
    if not isinstance(item, dict) or not isinstance(item.get("deal"), dict):
        raise ValueError("Exness交易历史响应格式无效")
    deal = item["deal"]
    deal_id = str(deal.get("deal_id") or "")
    position_id = str(deal.get("position_id") or "")
    kind = str(deal.get("type") or "")
    if not re.fullmatch(r"[0-9]{1,20}", deal_id):
        raise ValueError("Exness交易历史包含无效成交编号")
    if kind == "balance":
        return None
    if not re.fullmatch(r"[0-9]{1,20}", position_id):
        if kind in {"open", "close"}:
            raise ValueError("Exness交易历史缺少仓位编号，已中止以避免遗漏交易")
        # Balance-only/account deals have no position and do not belong in a trade journal.
        return None
    if kind not in {"open", "close", "swap_fee", "admin_fee", "dividend", "null_compensation", "exness_dollar"}:
        raise ValueError("Exness交易历史包含不支持的成交类型")
    direction = deal.get("direction")
    if kind in {"open", "close"} and direction not in {"buy", "sell"}:
        raise ValueError("Exness交易历史包含无效成交方向")
    instrument = str(deal.get("instrument") or "").upper()
    if (instrument or kind in {"open", "close"}) and not re.fullmatch(r"[A-Z0-9._-]{2,40}", instrument):
        raise ValueError("Exness交易历史包含无效品种")
    event_ms = _utc_ms(item.get("event_time") or deal.get("create_time"))
    trade_ms = _utc_ms(deal.get("create_time") or item.get("event_time"))
    volume = _decimal(deal.get("volume"), positive=True, optional=kind not in {"open", "close"})
    price = _decimal(deal.get("price"), positive=True, optional=kind not in {"open", "close"})
    profit = deal.get("profit")
    amount = _decimal(profit.get("amount"), optional=True) if isinstance(profit, dict) else None
    currency = str(profit.get("currency") or "").upper() if isinstance(profit, dict) else ""
    if currency and not re.fullmatch(r"[A-Z]{3,8}", currency):
        currency = ""
    commission = _decimal(deal.get("commission"), optional=True)
    return {
        "dealId": deal_id, "positionId": position_id, "type": kind,
        "direction": direction, "instrument": instrument, "eventTimeMs": event_ms,
        "tradeTimeMs": trade_ms,
        "volume": str(volume) if volume is not None else None,
        "price": str(price) if price is not None else None,
        "profit": str(amount) if amount is not None else None,
        "currency": currency or None,
        "commission": str(commission) if commission is not None else None,
    }


def _position_id(scope, native_id):
    digest = hashlib.sha256(scope.encode()).hexdigest()[:16]
    return f"api:{digest}:{native_id}"[:MAX_POSITION_ID_LENGTH]


def _make_position(scope, native_id, currency, deals, current=None, entry_anchor=None):
    trades = [row for row in deals if row["type"] in {"open", "close"}]
    opens = [row for row in trades if row["type"] == "open"]
    closes = [row for row in trades if row["type"] == "close"]
    swaps = [row for row in deals if row["type"] == "swap_fee"]
    if not opens and current is None and entry_anchor is None:
        return None

    anchor = current or entry_anchor or (opens[0] if opens else None)
    instrument = ((current or {}).get("instrument") or anchor.get("instrument")
                  or anchor.get("unifiedSymbol"))
    if opens:
        instrument = opens[0]["instrument"]
        if any(row["instrument"] != instrument for row in opens + closes):
            raise ValueError("同一 Exness position ID 出现多个品种，已中止同步")
        if any(row["direction"] != opens[0]["direction"] for row in opens):
            raise ValueError("同一 Exness position ID 出现多个开仓方向，已中止同步")
        side = "long" if opens[0]["direction"] == "buy" else "short"
        open_volume = sum((_decimal(row["volume"], positive=True) for row in opens), Decimal(0))
        open_value = sum((_decimal(row["volume"], positive=True) * _decimal(row["price"], positive=True)
                          for row in opens), Decimal(0))
        entry_price = open_value / open_volume
        entry_time = min(row.get("tradeTimeMs", row["eventTimeMs"]) for row in opens)
    else:
        if current:
            if current.get("direction") not in {"buy", "sell"}:
                raise ValueError("Exness当前仓位方向无效")
            side = "long" if current["direction"] == "buy" else "short"
            open_volume = _decimal(current.get("initial_volume") or current.get("volume"), positive=True)
            entry_price = _decimal(current.get("open_price"), positive=True)
            entry_time = _utc_ms(current["create_time"])
        else:
            if entry_anchor.get("side") not in {"long", "short"}:
                raise ValueError("Exness已保存仓位方向无效")
            side = entry_anchor["side"]
            open_volume = _decimal(entry_anchor.get("contracts"), positive=True)
            entry_price = _decimal(entry_anchor.get("entryPrice"), positive=True)
            entry_time = int(entry_anchor["entryTimeMs"])

    close_volume = sum((_decimal(row["volume"], positive=True) for row in closes), Decimal(0))
    if close_volume > open_volume + Decimal("0.00000001"):
        raise ValueError("Exness成交历史平仓手数超过可见开仓手数，已保留原仓位")
    closed = bool(closes) and close_volume >= open_volume - Decimal("0.00000001")
    exit_volume = close_volume
    exit_price = (sum((_decimal(row["volume"], positive=True) * _decimal(row["price"], positive=True)
                       for row in closes), Decimal(0)) / exit_volume) if exit_volume else None
    realized = sum((_decimal(row["profit"], optional=True) or Decimal(0) for row in closes), Decimal(0))
    funding = sum((_decimal(row["profit"], optional=True) or Decimal(0) for row in swaps), Decimal(0))
    open_fee = sum((abs(_decimal(row["commission"], optional=True) or Decimal(0)) for row in opens), Decimal(0))
    close_fee = sum((abs(_decimal(row["commission"], optional=True) or Decimal(0)) for row in closes), Decimal(0))
    open_fee_available = any(row.get("commission") is not None for row in opens)
    close_fee_available = any(row.get("commission") is not None for row in closes)
    funding_available = bool(swaps)
    if current:
        if (current.get("instrument") != instrument
                or current.get("direction") != ("buy" if side == "long" else "sell")):
            raise ValueError("Exness当前仓位与成交历史的品种或方向不一致，已保留原仓位")
        open_volume = _decimal(current.get("initial_volume") or current.get("volume"), positive=True)
        # Snapshot values are the broker's current anchor for still-open exposure.
        entry_price = _decimal(current.get("open_price"), positive=True)
        entry_time = _utc_ms(current["create_time"])
        if not opens:
            open_fee = abs(_decimal(current.get("commission"), optional=True) or Decimal(0))
            open_fee_available = current.get("commission") is not None
        if not swaps:
            funding = _decimal(current.get("swap"), optional=True) or Decimal(0)
            funding_available = current.get("swap") is not None
        closed = False
        exit_price = None

    return {
        "venue": "exness", "positionId": _position_id(scope, native_id),
        "unifiedSymbol": instrument, "chartSymbol": chart_symbol(instrument),
        "side": side, "status": "closed" if closed else "open",
        "entryPrice": float(entry_price), "exitPrice": float(exit_price) if exit_price is not None else None,
        "contracts": float(open_volume), "contractSize": None, "leverage": None,
        "marginMode": None, "hedged": False, "realizedPnl": float(realized),
        "netPnl": None, "funding": float(funding) if funding_available else None,
        "openFee": float(open_fee) if open_fee_available else None,
        "closeFee": float(close_fee) if close_fee_available else None,
        "entryTimeMs": entry_time,
        "exitTimeMs": max(row.get("tradeTimeMs", row["eventTimeMs"]) for row in closes) if closed else None,
        "currency": currency or next((row["currency"] for row in closes if row["currency"]), None),
    }


class ExnessPositionSync:
    """Fetch signed read-only history pages and persist normalized positions."""

    def __init__(self, database, database_lock, provider, load_credentials, upsert_position):
        self.database = database
        self.database_lock = database_lock
        self.provider = provider
        self.load_credentials = load_credentials
        self.upsert_position = upsert_position

    def _get(self, base_url, path, credentials, interval=1.1):
        try:
            data = self.provider._get(base_url, path, credentials)
        except RuntimeError as error:
            message = str(error)
            if message.startswith("Exness当前未提供该品种的原生历史K线"):
                raise RuntimeError("Exness交易记录接口暂不可用") from None
            if message.startswith("Exness不接受该行情时间范围或周期"):
                raise RuntimeError("Exness不接受该历史查询范围或参数") from None
            raise RuntimeError(message) from None
        except ValueError:
            raise RuntimeError("Exness交易记录连接凭据无效，请重新保存连接") from None
        # Share the market provider's serialized request lane with candles.
        lock = getattr(self.provider, "request_lock", None)
        if lock is not None:
            with lock:
                self.provider.next_request_at = max(
                    self.provider.next_request_at, time.monotonic() + max(1.1, interval)
                )
        return data

    def _defer_shared_lane(self, interval):
        lock = getattr(self.provider, "request_lock", None)
        if lock is not None:
            with lock:
                self.provider.next_request_at = max(
                    self.provider.next_request_at, time.monotonic() + max(1.1, interval)
                )

    def _shared_lane_wait(self):
        lock = getattr(self.provider, "request_lock", None)
        if lock is None:
            return 0.0
        with lock:
            return max(0.0, self.provider.next_request_at - time.monotonic())

    @staticmethod
    def _interval(methods, path, global_rate):
        row = next((item for item in methods if item.get("path") == path), None)
        if not row:
            return max(1.1, global_rate)
        rate = row.get("rate_limit") or {}
        try:
            local = float(rate["window_seconds"]) / int(rate["limit"])
        except (KeyError, TypeError, ValueError, ZeroDivisionError):
            local = 1.1
        return max(1.1, global_rate, local)

    def fetch(self, now_ms):
        started_at = time.monotonic()
        initial_request_count = getattr(self.provider, "request_count", None)
        credentials = self.load_credentials()
        scope = market_scope(credentials)
        account_id = credentials["accountId"]
        base = self.provider._access_point(credentials)
        limits_path = f"/v1/configuration/accounts/{account_id}/limits"
        limits_data = self._get(base, limits_path, credentials)
        limits = limits_data.get("limits", {})
        rest = limits.get("rest", {})
        methods = rest.get("methods", [])
        if not isinstance(methods, list):
            raise RuntimeError("Exness未返回有效的历史查询限额")
        global_rate = 1.1
        try:
            global_limit = rest["global_account_rate"]
            global_rate = float(global_limit["window_seconds"]) / int(global_limit["limit"])
        except (KeyError, TypeError, ValueError, ZeroDivisionError):
            pass

        limits_template = "/v1/configuration/accounts/{account_id}/limits"
        self._defer_shared_lane(self._interval(methods, limits_template, global_rate))

        deals_template = "/v1/history/accounts/{account_id}/deals"
        deals_path = f"/v1/history/accounts/{account_id}/deals"
        deals_rule = next((item for item in methods if item.get("path") == deals_template), None)
        if not deals_rule:
            raise RuntimeError("当前 Exness API 未开放成交历史查询")
        shape = deals_rule.get("limits") or {}
        try:
            age_days = int(shape["history_age_days"])
            range_days = int(shape["history_range_days"])
        except (KeyError, TypeError, ValueError):
            raise RuntimeError("Exness 未返回成交历史可查询范围") from None
        if not 1 <= age_days <= 36500 or not 1 <= range_days <= 36500:
            raise RuntimeError("Exness 成交历史查询范围无效")

        account_template = "/v1/configuration/accounts/{account_id}/account"
        account_interval = self._interval(methods, account_template, global_rate)
        self._defer_shared_lane(account_interval)
        account_data = self._get(
            base, f"/v1/configuration/accounts/{account_id}/account", credentials, account_interval
        )
        if str(account_data.get("account_id")) != account_id:
            raise RuntimeError("Exness返回的账户与连接账户不一致")
        raw_currency = (account_data.get("settings") or {}).get("currency")
        currency = str(raw_currency) if isinstance(raw_currency, str) and re.fullmatch(r"[A-Z]{3,8}", raw_currency) else None
        snapshot_path = f"/v1/trading/accounts/{account_id}/snapshot"
        snapshot_interval = self._interval(methods, "/v1/trading/accounts/{account_id}/snapshot", global_rate)
        snapshot_data = self._get(base, snapshot_path, credentials,
                                  snapshot_interval)
        current = snapshot_data.get("positions", [])
        if not isinstance(current, list):
            raise RuntimeError("Exness当前仓位响应格式无效")
        for row in current:
            if not isinstance(row, dict) or not re.fullmatch(r"[0-9]{1,20}", str(row.get("position_id") or "")):
                raise RuntimeError("Exness当前仓位响应格式无效")

        history_key = f"exness_history_end_{scope}"
        with self.database_lock, self.database() as connection:
            stored = _setting(connection, history_key)
        try:
            progress = json.loads(stored) if stored else {}
            if not isinstance(progress, dict):
                progress = {}
        except (ValueError, TypeError):
            progress = {}

        target_end = max(1, now_ms - 1000)
        history_floor = max(1, max(now_ms, int(time.time() * 1000)) - age_days * 86_400_000 + 10_000)
        next_from = max(history_floor, min(target_end, int(progress.get("nextFromMs") or history_floor) - OVERLAP_MS))
        resume_from = progress.get("resumeFromMs")
        resume_to = progress.get("resumeToMs")
        cursor = progress.get("cursor")
        if cursor and (not resume_from or not resume_to or int(resume_to) <= history_floor):
            cursor = None
            resume_from = resume_to = None
            progress_warning = "Exness历史分页游标已超出当前可查范围，已从可查范围内重新续传"
        else:
            progress_warning = None
        if resume_from and resume_to and cursor:
            next_from = max(history_floor, int(resume_from))

        request_interval = self._interval(methods, deals_template, global_rate)
        chunk_ms = range_days * 86_400_000
        fetched = []
        # Conservatively reserve discovery, limits, account verification, and snapshot.
        request_count = 4
        history_pages = 0
        warning = progress_warning
        request_limit_warning = None
        while next_from < target_end:
            chunk_from = int(resume_from) if cursor and resume_from else next_from
            chunk_to = int(resume_to) if cursor and resume_to else min(target_end, chunk_from + chunk_ms)
            seen_cursors = {cursor} if cursor else set()
            while True:
                if initial_request_count is not None:
                    request_count = self.provider.request_count - initial_request_count
                # Include bounded signature correction and account re-discovery.
                request_reserve = getattr(self.provider, "max_requests_per_read", 2)
                if request_count + request_reserve > MAX_SYNC_REQUESTS or history_pages >= MAX_HISTORY_REQUESTS:
                    request_limit_warning = "Exness历史较多，本次达到安全请求上限；已保存进度，可再次同步继续"
                    break
                elapsed = time.monotonic() - started_at
                if elapsed + self._shared_lane_wait() >= MAX_SYNC_SECONDS:
                    request_limit_warning = "本次 Exness 同步达到45秒时间预算；已保存进度，可再次同步继续"
                    break
                if cursor:
                    params = urlencode({"cursor": cursor, "limit": PAGE_SIZE})
                else:
                    stamp = lambda ms: datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat()
                    params = urlencode({"from": stamp(chunk_from), "to": stamp(chunk_to), "limit": PAGE_SIZE})
                try:
                    response = self._get(base, f"{deals_path}?{params}", credentials, request_interval)
                except RuntimeError as error:
                    if cursor and "不接受该历史查询范围或参数" in str(error):
                        cursor = None
                        resume_from = resume_to = None
                        next_from = history_floor
                        request_limit_warning = "Exness分页游标已失效，进度已清除；再次手动同步会从当前可查范围开始"
                        break
                    raise
                request_count += 1
                history_pages += 1
                items = response.get("items")
                if not isinstance(items, list) or len(items) > PAGE_SIZE:
                    raise RuntimeError("Exness成交历史响应格式无效")
                if len(fetched) + len(items) > MAX_DEALS_PER_SYNC:
                    raise RuntimeError("Exness单次历史成交超过安全上限；请缩短时间范围后重试")
                try:
                    fetched.extend(row for row in (_clean_deal(item) for item in items) if row)
                except (ValueError, TypeError, KeyError, OverflowError):
                    raise RuntimeError("Exness成交历史包含无效字段，本次未覆盖本机记录") from None
                next_cursor = response.get("next_cursor")
                has_more = bool(response.get("has_more"))
                if next_cursor:
                    next_cursor = str(next_cursor)
                    if next_cursor in seen_cursors:
                        raise RuntimeError("Exness成交历史分页游标重复，已中止同步")
                    seen_cursors.add(next_cursor)
                    cursor = next_cursor
                    if not has_more:
                        # Cursor presence is authoritative; continue until its page is exhausted.
                        continue
                    continue
                if has_more:
                    raise RuntimeError("Exness成交历史标记仍有后续数据，但未返回分页游标")
                cursor = None
                next_from = chunk_to
                resume_from = resume_to = None
                break
            if request_limit_warning:
                if cursor:
                    resume_from, resume_to = chunk_from, chunk_to
                else:
                    resume_from = resume_to = None
                break

        account_state = snapshot_data.get("account_state") or {}
        if not isinstance(account_state, dict):
            account_state = {}
        balance_value = account_state.get("equity")
        try:
            balance = float(_decimal(balance_value)) if balance_value is not None else None
        except ValueError:
            balance = None
        return {
            "scope": scope, "currency": currency, "deals": fetched, "current": current,
            "balance": balance, "historyAgeDays": age_days,
            "progress": {"nextFromMs": next_from, "resumeFromMs": resume_from,
                         "resumeToMs": resume_to, "cursor": cursor},
            "historyKey": history_key,
            "warning": "；".join(filter(None, [warning, request_limit_warning])) or None,
            "requestCount": request_count, "durationSeconds": time.monotonic() - started_at,
        }

    def persist(self, connection, snapshot, synced_at):
        scope = snapshot["scope"]
        currency = snapshot.get("currency")
        current_by_id = {str(row["position_id"]): row for row in snapshot.get("current", [])}
        for deal in snapshot.get("deals", []):
            connection.execute(
                """INSERT INTO exness_api_deals(scope, deal_id, position_id, event_time_ms, payload_json)
                   VALUES (?, ?, ?, ?, ?) ON CONFLICT(scope, deal_id) DO UPDATE SET
                   position_id=excluded.position_id, event_time_ms=excluded.event_time_ms,
                   payload_json=excluded.payload_json""",
                (scope, deal["dealId"], deal["positionId"], deal["eventTimeMs"],
                 json.dumps(deal, ensure_ascii=False, separators=(",", ":"))),
            )
        _upsert_setting(connection, snapshot["historyKey"], json.dumps(snapshot["progress"], separators=(",", ":")))
        _upsert_setting(connection, "exness_balance_total", json.dumps(snapshot.get("balance")))
        _upsert_setting(connection, "exness_balance_scope", scope)
        _upsert_setting(connection, "exness_balance_currency", currency or "")
        _upsert_setting(connection, "exness_last_synced_at", synced_at)

        rows = connection.execute(
            "SELECT DISTINCT position_id FROM exness_api_deals WHERE scope=?", (scope,)
        ).fetchall()
        native_ids = {row["position_id"] for row in rows} | set(current_by_id)
        warnings = []
        closed_count = 0
        open_count = 0
        for native_id in native_ids:
            stored_deals = connection.execute(
                "SELECT payload_json FROM exness_api_deals WHERE scope=? AND position_id=? ORDER BY event_time_ms, deal_id",
                (scope, native_id),
            ).fetchall()
            deals = [json.loads(row["payload_json"]) for row in stored_deals]
            current = current_by_id.get(native_id)
            existing_map = connection.execute(
                "SELECT position_id FROM exness_api_positions WHERE scope=? AND native_position_id=?",
                (scope, native_id),
            ).fetchone()
            existing_position = None
            if existing_map:
                existing_position = connection.execute(
                    """SELECT unified_symbol, side, entry_price, contracts, entry_time_ms, status
                       FROM exchange_positions WHERE venue='exness' AND position_id=?""",
                    (existing_map["position_id"],),
                ).fetchone()
            has_open_deal = any(row["type"] == "open" for row in deals)
            has_close_deal = any(row["type"] == "close" for row in deals)
            if not has_open_deal and current is None and not existing_position:
                if has_close_deal:
                    warnings.append("部分 Exness 历史仓位缺少开仓锚点，未猜测入场价格或时间")
                continue
            if not current and not has_close_deal:
                # The snapshot is authoritative for live positions. An open-only
                # history page may simply be a budget boundary, so wait for closes.
                warnings.append("部分 Exness 历史尚未确认平仓或当前持仓，等待继续同步")
                continue
            entry_anchor = None
            if not has_open_deal and current is None and existing_position:
                entry_anchor = {
                    "unifiedSymbol": existing_position["unified_symbol"],
                    "side": existing_position["side"], "entryPrice": existing_position["entry_price"],
                    "contracts": existing_position["contracts"], "entryTimeMs": existing_position["entry_time_ms"],
                }
            try:
                position = _make_position(scope, native_id, currency, deals, current, entry_anchor)
            except ValueError as error:
                warnings.append(str(error))
                continue
            if position is None:
                warnings.append("部分 Exness 历史缺少完整开仓信息，未写入不完整仓位")
                continue
            if not current and position["status"] != "closed":
                warnings.append("Exness历史只有部分平仓明细或尚未取全，保留原仓位并等待继续同步")
                continue
            legacy_id = None if existing_map else self._match_legacy_csv(connection, native_id, position)
            if not existing_map and not legacy_id and connection.execute(
                    "SELECT 1 FROM exchange_positions WHERE venue='exness' AND position_id=? LIMIT 1",
                    (f"default:{native_id}",)).fetchone():
                warnings.append("部分 Exness API 与同编号历史文件的开仓信息无法核对，已分别保留，请人工核对")
            position_id = existing_map["position_id"] if existing_map else legacy_id or position["positionId"]
            if len(position_id) > MAX_POSITION_ID_LENGTH:
                raise RuntimeError("Exness仓位编号超出本地长度限制")
            position["positionId"] = position_id
            connection.execute(
                """INSERT INTO exness_api_positions(scope, native_position_id, position_id, currency)
                   VALUES (?, ?, ?, ?) ON CONFLICT(scope, native_position_id) DO UPDATE SET
                   currency=excluded.currency""",
                (scope, native_id, position_id, currency),
            )
            self.upsert_position(connection, position, synced_at)
            if position["status"] == "closed":
                closed_count += 1
            else:
                open_count += 1
        warning = "；".join(filter(None, [snapshot.get("warning"), *dict.fromkeys(warnings)])) or None
        return {"warning": warning, "closedCount": closed_count, "openCount": open_count}

    @staticmethod
    def _match_legacy_csv(connection, native_id, position):
        """Reuse an imported ticket only when all documented lot-based anchors agree."""
        candidates = connection.execute(
            """SELECT position_id, unified_symbol, side, entry_price, contracts, entry_time_ms
               FROM exchange_positions WHERE venue='exness' AND position_id=?""",
            (f"default:{native_id}",),
        ).fetchall()
        matches = []
        api_volume = _decimal(position.get("contracts"), positive=True)
        api_price = _decimal(position.get("entryPrice"), positive=True)
        api_time = int(position["entryTimeMs"]) // 1000
        for candidate in candidates:
            if (candidate["unified_symbol"] != position["unifiedSymbol"]
                    or candidate["side"] != position["side"]
                    or int(candidate["entry_time_ms"]) // 1000 != api_time):
                continue
            try:
                same_price = _decimal(candidate["entry_price"], positive=True) == api_price
                same_volume = _decimal(candidate["contracts"], positive=True) == api_volume
            except ValueError:
                continue
            if not (same_price and same_volume):
                continue
            linked = connection.execute(
                "SELECT 1 FROM exness_api_positions WHERE position_id=? LIMIT 1", (candidate["position_id"],)
            ).fetchone()
            if not linked:
                matches.append(candidate["position_id"])
        # Duplicate historical tickets with identical entry fields are ambiguous.
        return matches[0] if len(matches) == 1 else None


def enrich_positions(connection, positions):
    """Attach account currency and exact API deal fills to API-linked rows."""
    for position in positions:
        if position.get("venue") != "exness":
            continue
        link = connection.execute(
            "SELECT scope, native_position_id, currency FROM exness_api_positions WHERE position_id=?",
            (position["positionId"],),
        ).fetchone()
        if not link:
            position["currency"] = None
            continue
        position["currency"] = link["currency"] or None
        rows = connection.execute(
            """SELECT payload_json FROM exness_api_deals
               WHERE scope=? AND position_id=? ORDER BY event_time_ms, deal_id""",
            (link["scope"], link["native_position_id"]),
        ).fetchall()
        deals = [json.loads(row["payload_json"]) for row in rows]
        deals.sort(key=lambda deal: (deal.get("tradeTimeMs", deal["eventTimeMs"]), deal["dealId"]))
        opens = [deal for deal in deals if deal["type"] == "open"]
        closes = [deal for deal in deals if deal["type"] == "close"]
        first_open_id = opens[0]["dealId"] if opens else None
        final_close_id = closes[-1]["dealId"] if position.get("status") == "closed" and closes else None
        fills = []
        for deal in deals:
            kind = deal["type"]
            if kind not in {"open", "close"}:
                continue
            is_open = kind == "open"
            is_close = kind == "close"
            direction = deal.get("direction")
            if direction not in {"buy", "sell"}:
                direction = "sell" if position["side"] == "long" else "buy"
            profit = float(deal["profit"]) if deal.get("profit") is not None else None
            fills.append({
                "execId": deal["dealId"], "timeMs": deal.get("tradeTimeMs", deal["eventTimeMs"]),
                "side": direction, "tradeSide": "open" if is_open else "close" if is_close else None,
                "kind": "open" if deal["dealId"] == first_open_id else
                        "scaleIn" if is_open else "close" if deal["dealId"] == final_close_id else
                        "reduce",
                "price": float(deal["price"]) if deal.get("price") is not None else None,
                "quantity": float(deal["volume"]) if deal.get("volume") is not None else None,
                "pnl": profit,
            })
        position["fills"] = fills
    return positions
