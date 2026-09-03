import math
import os
import re
import threading
from urllib.request import getproxies

import ccxt

from market_data_provider import CCXT_TIMEFRAMES


BITGET_CANDLE_MAX_RANGE_MS = 89 * 24 * 60 * 60 * 1000


def https_proxy_url():
    proxy = (
        os.environ.get("HTTPS_PROXY")
        or os.environ.get("https_proxy")
        or os.environ.get("HTTP_PROXY")
        or os.environ.get("http_proxy")
    )
    if not proxy:
        system_proxies = getproxies()
        proxy = system_proxies.get("https") or system_proxies.get("http")
    return proxy


def chart_symbol_from_unified(symbol):
    unified = str(symbol or "").strip().upper()
    if "/" in unified:
        base, rest = unified.split("/", 1)
        quote = rest.split(":", 1)[0]
        return f"{base}{quote}"
    compact = unified.replace("/", "").replace(":", "")
    if compact.endswith("USDT"):
        return compact
    raise ValueError("无法从交易对解析图表 symbol")


def _to_float(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value):
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _first_float(*values):
    for value in values:
        parsed = _to_float(value)
        if parsed is not None:
            return parsed
    return None


def parse_uta_fill(row):
    if not isinstance(row, dict):
        return None
    category = str(row.get("category") or "").upper()
    if category and category not in {"USDT-FUTURES", "USDC-FUTURES", "COIN-FUTURES"}:
        return None
    if category and category != "USDT-FUTURES":
        return None
    raw_symbol = str(row.get("symbol") or "").strip().upper()
    if not raw_symbol:
        return None
    try:
        chart_symbol = (
            raw_symbol
            if re.fullmatch(r"[A-Z0-9]{3,20}USDT", raw_symbol)
            else chart_symbol_from_unified(raw_symbol)
        )
    except ValueError:
        return None
    if not re.fullmatch(r"[A-Z0-9]{3,20}USDT", chart_symbol):
        return None
    exec_id = str(row.get("execId") or row.get("tradeId") or "").strip()
    if not exec_id:
        return None
    order_id = str(row.get("orderId") or "").strip() or None
    time_ms = _to_int(row.get("createdTime") or row.get("cTime"))
    if not time_ms:
        return None
    side = str(row.get("side") or "").strip().lower()
    if side not in {"buy", "sell"}:
        return None
    trade_side = str(row.get("tradeSide") or "").strip().lower() or None
    if trade_side not in {"open", "close", None}:
        trade_side = None
    fee_detail = row.get("feeDetail")
    fee = None
    if isinstance(fee_detail, list) and fee_detail and isinstance(fee_detail[0], dict):
        fee = _to_float(fee_detail[0].get("fee"))
    elif isinstance(fee_detail, dict):
        fee = _first_float(fee_detail.get("fee"), fee_detail.get("totalFee"))
    return {
        "venue": "bitget",
        "execId": exec_id,
        "orderId": order_id,
        "chartSymbol": chart_symbol,
        "unifiedSymbol": raw_symbol,
        "side": side,
        "tradeSide": trade_side,
        "price": _first_float(row.get("execPrice"), row.get("price")),
        "quantity": _first_float(
            row.get("execQty"), row.get("size"), row.get("baseVolume")
        ),
        "pnl": _first_float(row.get("execPnl"), row.get("profit")),
        "fee": fee,
        "timeMs": time_ms,
    }


def fill_matches_position(fill, position):
    if fill.get("chartSymbol") != position.get("chartSymbol"):
        return False
    pos_side = position.get("side")
    trade_side = fill.get("tradeSide")
    fill_side = fill.get("side")
    if trade_side == "open":
        return (pos_side == "long" and fill_side == "buy") or (
            pos_side == "short" and fill_side == "sell"
        )
    if trade_side == "close":
        return (pos_side == "long" and fill_side == "sell") or (
            pos_side == "short" and fill_side == "buy"
        )
    if pos_side == "long":
        return fill_side in {"buy", "sell"}
    if pos_side == "short":
        return fill_side in {"buy", "sell"}
    return False


def classify_fill_role(fill, position):
    if not fill_matches_position(fill, position):
        return None
    trade_side = fill.get("tradeSide")
    fill_side = fill.get("side")
    pos_side = position.get("side")
    if trade_side == "open":
        return "open"
    if trade_side == "close":
        return "close"
    if pos_side == "long":
        return "open" if fill_side == "buy" else "close"
    if pos_side == "short":
        return "open" if fill_side == "sell" else "close"
    return None


class BitgetUtaPositionProvider:
    def __init__(self, api_key, secret, password, timeout_milliseconds=20_000):
        if not api_key or not secret or not password:
            raise ValueError("Bitget 只读密钥不完整，需要 API Key、Secret 和 Passphrase")
        config = {
            "apiKey": api_key,
            "secret": secret,
            "password": password,
            "enableRateLimit": True,
            "timeout": timeout_milliseconds,
            "options": {
                "defaultType": "swap",
                "uta": True,
            },
        }
        proxy = https_proxy_url()
        if proxy:
            config["httpsProxy"] = proxy
        self.exchange = ccxt.bitget(config)
        self.request_lock = threading.RLock()

    def warm_up_markets(self):
        try:
            with self.request_lock:
                if self.exchange.markets:
                    return
                self.exchange.load_markets()
        except (ccxt.BaseError, OSError, TimeoutError, ConnectionError) as error:
            raise RuntimeError(f"CCXT Bitget 市场信息预热失败：{error}") from error

    def _uta_params(self, extra=None):
        params = {"uta": True, "productType": "USDT-FUTURES"}
        if extra:
            params.update(extra)
        return params

    def fetch_balance_usdt(self):
        try:
            with self.request_lock:
                balance = self.exchange.fetch_balance(self._uta_params())
        except (ccxt.BaseError, OSError, TimeoutError, ConnectionError) as error:
            raise RuntimeError(f"Bitget 账户余额读取失败：{error}") from error
        usdt = balance.get("USDT") or {}
        return {
            "total": _to_float(usdt.get("total")),
            "free": _to_float(usdt.get("free")),
            "used": _to_float(usdt.get("used")),
        }

    def fetch_open_positions(self):
        try:
            with self.request_lock:
                rows = self.exchange.fetch_positions(
                    None,
                    self._uta_params(),
                )
        except (ccxt.BaseError, OSError, TimeoutError, ConnectionError) as error:
            raise RuntimeError(f"Bitget 当前持仓读取失败：{error}") from error
        positions = []
        for row in rows or []:
            contracts = _to_float(row.get("contracts")) or 0.0
            if contracts == 0:
                continue
            parsed = self._parse_position(row, status="open")
            if parsed is not None:
                positions.append(parsed)
        return positions

    def fetch_closed_positions(self, since_ms, until_ms, limit=100, max_pages=50):
        positions = []
        cursor = None
        seen_cursors = set()
        try:
            with self.request_lock:
                self.exchange.load_markets()
            for _ in range(max_pages):
                params = {
                    "category": "USDT-FUTURES",
                    "startTime": str(int(since_ms)),
                    "endTime": str(int(until_ms)),
                    "limit": str(limit),
                }
                if cursor:
                    params["cursor"] = cursor
                with self.request_lock:
                    response = self.exchange.privateUtaGetV3PositionHistoryPosition(
                        params
                    )
                data = response.get("data") if isinstance(response, dict) else None
                if not isinstance(data, dict):
                    raise RuntimeError("Bitget 历史仓位返回格式无效")
                raw_rows = data.get("list") or []
                if not isinstance(raw_rows, list):
                    raise RuntimeError("Bitget 历史仓位列表格式无效")
                rows = self.exchange.parse_positions(raw_rows)
                for row in rows:
                    parsed = self._parse_position(row, status="closed")
                    if parsed is not None:
                        positions.append(parsed)
                next_cursor = str(data.get("cursor") or "").strip()
                if not raw_rows or not next_cursor:
                    return positions
                if next_cursor in seen_cursors:
                    raise RuntimeError("Bitget 历史仓位分页游标重复，同步已中止")
                seen_cursors.add(next_cursor)
                cursor = next_cursor
                if len(raw_rows) < limit:
                    return positions
        except RuntimeError:
            raise
        except (
            ccxt.BaseError,
            OSError,
            TimeoutError,
            ConnectionError,
            AttributeError,
            TypeError,
            ValueError,
        ) as error:
            raise RuntimeError(f"Bitget 历史仓位读取失败：{error}") from error
        raise RuntimeError(
            f"Bitget 历史仓位超过 {max_pages * limit} 条，无法确认同步完整性"
        )

    def fetch_fills(self, since_ms, until_ms, limit=100, max_pages=50):
        fills = []
        cursor = None
        seen_cursors = set()
        try:
            for _ in range(max_pages):
                params = {
                    "category": "USDT-FUTURES",
                    "startTime": str(int(since_ms)),
                    "endTime": str(int(until_ms)),
                    "limit": str(limit),
                }
                if cursor:
                    params["cursor"] = cursor
                with self.request_lock:
                    response = self.exchange.privateUtaGetV3TradeFills(params)
                data = response.get("data") if isinstance(response, dict) else None
                if not isinstance(data, dict):
                    raise RuntimeError("Bitget 成交明细返回格式无效")
                rows = data.get("list") or []
                if not isinstance(rows, list):
                    raise RuntimeError("Bitget 成交明细列表格式无效")
                for row in rows:
                    parsed = parse_uta_fill(row)
                    if parsed is not None:
                        fills.append(parsed)
                next_cursor = str(data.get("cursor") or "").strip()
                if not rows or not next_cursor:
                    return fills
                if next_cursor in seen_cursors:
                    raise RuntimeError("Bitget 成交明细分页游标重复，同步已中止")
                seen_cursors.add(next_cursor)
                cursor = next_cursor
                if len(rows) < limit:
                    return fills
        except RuntimeError:
            raise
        except (
            ccxt.BaseError,
            OSError,
            TimeoutError,
            ConnectionError,
            AttributeError,
            TypeError,
            ValueError,
        ) as error:
            raise RuntimeError(f"Bitget 成交明细读取失败：{error}") from error
        raise RuntimeError(
            f"Bitget 成交明细超过 {max_pages * limit} 条，无法确认同步完整性"
        )

    def fetch_candles(
        self,
        symbol,
        interval,
        interval_milliseconds,
        start_timestamp,
        end_timestamp,
    ):
        timeframe = CCXT_TIMEFRAMES.get(interval)
        if timeframe is None:
            raise ValueError("不支持该 K 线周期")
        if start_timestamp > end_timestamp:
            return []
        ccxt_symbol = f"{str(symbol)[:-4]}/USDT:USDT"
        candles_by_timestamp = {}
        cursor = start_timestamp
        while cursor <= end_timestamp:
            remaining = max(
                1,
                math.ceil((end_timestamp - cursor) / interval_milliseconds) + 1,
            )
            page_limit = min(200, remaining)
            page_until = min(
                end_timestamp,
                cursor + (page_limit - 1) * interval_milliseconds,
                cursor + BITGET_CANDLE_MAX_RANGE_MS,
            )
            try:
                with self.request_lock:
                    rows = self.exchange.fetch_ohlcv(
                        ccxt_symbol,
                        timeframe=timeframe,
                        since=cursor,
                        limit=page_limit,
                        params={
                            "uta": True,
                            "until": page_until,
                            "category": "USDT-FUTURES",
                        },
                    )
            except (ccxt.BaseError, OSError, TimeoutError, ConnectionError) as error:
                raise RuntimeError(f"CCXT Bitget K 线请求失败：{error}") from error
            if not rows:
                if page_until >= end_timestamp:
                    break
                next_cursor = page_until + interval_milliseconds
                if next_cursor <= cursor:
                    break
                cursor = next_cursor
                continue
            received_timestamps = []
            for row in rows:
                if len(row) < 6:
                    continue
                timestamp = int(row[0])
                received_timestamps.append(timestamp)
                if start_timestamp <= timestamp <= end_timestamp:
                    candles_by_timestamp[timestamp] = (
                        symbol,
                        interval,
                        timestamp,
                        float(row[1]),
                        float(row[2]),
                        float(row[3]),
                        float(row[4]),
                        float(row[5]),
                    )
            if not received_timestamps:
                if page_until >= end_timestamp:
                    break
                next_cursor = page_until + interval_milliseconds
                if next_cursor <= cursor:
                    break
                cursor = next_cursor
                continue
            latest_timestamp = max(received_timestamps)
            next_cursor = latest_timestamp + interval_milliseconds
            if page_until < end_timestamp:
                next_cursor = max(next_cursor, page_until + interval_milliseconds)
            if latest_timestamp >= end_timestamp or next_cursor > end_timestamp:
                break
            if next_cursor <= cursor:
                break
            if len(rows) < page_limit and page_until >= end_timestamp:
                break
            cursor = next_cursor
        return [
            candles_by_timestamp[timestamp]
            for timestamp in sorted(candles_by_timestamp)
        ]

    def _parse_position(self, row, status):
        info = row.get("info") if isinstance(row.get("info"), dict) else {}
        unified_symbol = str(row.get("symbol") or info.get("symbol") or "").strip()
        if not unified_symbol:
            return None
        try:
            chart_symbol = chart_symbol_from_unified(unified_symbol)
        except ValueError:
            return None
        if not re.fullmatch(r"[A-Z0-9]{3,20}USDT", chart_symbol):
            return None
        side = str(row.get("side") or info.get("posSide") or "").strip().lower()
        if side not in {"long", "short"}:
            return None
        entry_time_ms = _to_int(info.get("createdTime")) or _to_int(row.get("timestamp"))
        if not entry_time_ms:
            return None
        exit_time_ms = _to_int(info.get("updatedTime")) if status == "closed" else None
        position_id = str(
            row.get("id")
            or info.get("positionId")
            or info.get("posId")
            or f"open:{chart_symbol}:{side}:{entry_time_ms}"
        )
        return {
            "venue": "bitget",
            "positionId": position_id,
            "unifiedSymbol": unified_symbol,
            "chartSymbol": chart_symbol,
            "side": side,
            "status": status,
            "entryPrice": _first_float(
                row.get("entryPrice"), info.get("openPriceAvg"), info.get("avgPrice")
            ),
            "exitPrice": _first_float(
                info.get("closePriceAvg"), row.get("markPrice")
            ),
            "contracts": _first_float(
                row.get("contracts"),
                info.get("closeTotalPos"),
                info.get("openTotalPos"),
                info.get("total"),
            ),
            "leverage": _first_float(row.get("leverage"), info.get("leverage")),
            "marginMode": str(row.get("marginMode") or info.get("marginMode") or "").lower() or None,
            "hedged": bool(row.get("hedged")),
            "realizedPnl": _first_float(
                row.get("realizedPnl"),
                info.get("cumRealisedPnl"),
                info.get("curRealisedPnl"),
            ),
            "netPnl": _first_float(info.get("netProfit"), row.get("realizedPnl")),
            "funding": _to_float(info.get("totalFunding")),
            "openFee": _to_float(info.get("openFeeTotal")),
            "closeFee": _to_float(info.get("closeFeeTotal")),
            "entryTimeMs": entry_time_ms,
            "exitTimeMs": exit_time_ms,
        }
