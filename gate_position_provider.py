import math
import os
import re
import threading
from urllib.request import getproxies

import ccxt

from market_data_provider import CCXT_TIMEFRAMES


GATE_VENUE = "gate"
GATE_SETTLE = "usdt"
USDT_CHART_SYMBOL_RE = re.compile(r"^[A-Z0-9]{3,20}USDT$")


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


def _to_ms(value):
    if value is None or value == "":
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric <= 0:
        return None
    if numeric < 10_000_000_000:
        return int(numeric * 1000)
    return int(numeric)


def chart_symbol_from_gate_contract(contract):
    raw = str(contract or "").strip().upper()
    if not raw:
        raise ValueError("无法从交易对解析图表 symbol")
    if "/" in raw:
        base, rest = raw.split("/", 1)
        quote = rest.split(":", 1)[0]
        compact = f"{base}{quote}"
    else:
        compact = raw.replace("_", "").replace("-", "").replace(":", "")
    if not USDT_CHART_SYMBOL_RE.fullmatch(compact):
        raise ValueError("无法从交易对解析图表 symbol")
    return compact


def parse_gate_leverage(row, info):
    lever = _first_float(info.get("lever"))
    isolated = _first_float(row.get("leverage"), info.get("leverage"))
    cross = _first_float(info.get("cross_leverage_limit"))
    if lever and lever > 0:
        return lever
    if isolated and isolated > 0:
        return isolated
    if cross and cross > 0:
        return cross
    return None


def parse_gate_margin_mode(row, info):
    isolated = _first_float(row.get("leverage"), info.get("leverage"))
    if isolated is not None:
        return "isolated" if isolated > 0 else "cross"
    mode = str(info.get("margin_mode") or row.get("marginMode") or "").strip().lower()
    if mode in {"isolated", "cross"}:
        return mode
    return None


def parse_gate_fill(row):
    if not isinstance(row, dict):
        return None
    contract = str(row.get("contract") or "").strip()
    if not contract:
        return None
    try:
        chart_symbol = chart_symbol_from_gate_contract(contract)
    except ValueError:
        return None
    exec_id = str(row.get("id") or row.get("trade_id") or "").strip()
    if not exec_id:
        return None
    time_ms = _to_ms(row.get("create_time"))
    if not time_ms:
        return None
    size = _to_float(row.get("size"))
    if size is None or size == 0:
        return None
    close_size = _to_float(row.get("close_size")) or 0.0
    side = "buy" if size > 0 else "sell"
    if close_size == 0:
        trade_side = "open"
    elif (close_size > 0 and size > 0) or (close_size < 0 and size < 0):
        trade_side = "close"
    else:
        trade_side = None
    unified = contract.replace("_", "/") + ":USDT" if "_" in contract else contract
    return {
        "venue": GATE_VENUE,
        "execId": exec_id,
        "orderId": str(row.get("order_id") or "").strip() or None,
        "chartSymbol": chart_symbol,
        "unifiedSymbol": unified,
        "side": side,
        "tradeSide": trade_side,
        "price": _to_float(row.get("price")),
        "quantity": abs(size),
        "pnl": None,
        "fee": _to_float(row.get("fee")),
        "timeMs": time_ms,
    }


class GateUsdtPositionProvider:
    def __init__(self, api_key, secret, timeout_milliseconds=20_000):
        if not api_key or not secret:
            raise ValueError("Gate 只读密钥不完整，需要 API Key 和 Secret")
        config = {
            "apiKey": api_key,
            "secret": secret,
            "enableRateLimit": True,
            "timeout": timeout_milliseconds,
            "options": {
                "defaultType": "swap",
                "defaultSettle": GATE_SETTLE,
                "fetchMarkets": {"types": ["swap"]},
                "swap": {
                    "fetchMarkets": {"settlementCurrencies": [GATE_SETTLE]},
                },
            },
        }
        proxy = https_proxy_url()
        if proxy:
            config["httpsProxy"] = proxy
        self.exchange = ccxt.gate(config)
        self.request_lock = threading.RLock()

    def warm_up_markets(self):
        try:
            with self.request_lock:
                if self.exchange.markets:
                    return
                self.exchange.load_markets()
        except (ccxt.BaseError, OSError, TimeoutError, ConnectionError) as error:
            raise RuntimeError(f"CCXT Gate 市场信息预热失败：{error}") from error

    def _swap_params(self, extra=None):
        params = {"type": "swap", "settle": GATE_SETTLE}
        if extra:
            params.update(extra)
        return params

    def fetch_balance_usdt(self):
        try:
            with self.request_lock:
                balance = self.exchange.fetch_balance(self._swap_params())
        except (ccxt.BaseError, OSError, TimeoutError, ConnectionError) as error:
            raise RuntimeError(f"Gate 账户余额读取失败：{error}") from error
        usdt = balance.get("USDT") or {}
        total = _first_float(
            usdt.get("total"),
            (balance.get("info") or {}).get("total")
            if isinstance(balance.get("info"), dict)
            else None,
        )
        return {
            "total": total,
            "free": _to_float(usdt.get("free")),
            "used": _to_float(usdt.get("used")),
        }

    def fetch_open_positions(self):
        try:
            with self.request_lock:
                rows = self.exchange.fetch_positions(None, self._swap_params())
        except (ccxt.BaseError, OSError, TimeoutError, ConnectionError) as error:
            raise RuntimeError(f"Gate 当前持仓读取失败：{error}") from error
        positions = []
        for row in rows or []:
            parsed = self._parse_open_position(row)
            if parsed is not None:
                positions.append(parsed)
        return positions

    def fetch_closed_positions(self, since_ms, until_ms, limit=1000, max_pages=50):
        positions = []
        offset = 0
        since_sec = max(0, int(since_ms / 1000))
        until_sec = max(since_sec, int(until_ms / 1000))
        try:
            for _ in range(max_pages):
                params = {
                    "settle": GATE_SETTLE,
                    "from": since_sec,
                    "to": until_sec,
                    "limit": limit,
                    "offset": offset,
                }
                with self.request_lock:
                    response = self.exchange.privateFuturesGetSettlePositionClose(
                        params
                    )
                if not isinstance(response, list):
                    raise RuntimeError("Gate 历史仓位返回格式无效")
                for row in response:
                    parsed = self._parse_closed_position(row)
                    if parsed is not None:
                        positions.append(parsed)
                if len(response) < limit:
                    return positions
                offset += limit
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
            raise RuntimeError(f"Gate 历史仓位读取失败：{error}") from error
        raise RuntimeError(
            f"Gate 历史仓位超过 {max_pages * limit} 条，无法确认同步完整性"
        )

    def fetch_fills(self, since_ms, until_ms, limit=1000, max_pages=50):
        fills = []
        offset = 0
        since_sec = max(0, int(since_ms / 1000))
        until_sec = max(since_sec, int(until_ms / 1000))
        try:
            for _ in range(max_pages):
                params = {
                    "settle": GATE_SETTLE,
                    "from": since_sec,
                    "to": until_sec,
                    "limit": limit,
                    "offset": offset,
                }
                with self.request_lock:
                    response = (
                        self.exchange.privateFuturesGetSettleMyTradesTimerange(
                            params
                        )
                    )
                if not isinstance(response, list):
                    raise RuntimeError("Gate 成交明细返回格式无效")
                for row in response:
                    parsed = parse_gate_fill(row)
                    if parsed is not None:
                        fills.append(parsed)
                if len(response) < limit:
                    return fills
                offset += limit
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
            raise RuntimeError(f"Gate 成交明细读取失败：{error}") from error
        raise RuntimeError(
            f"Gate 成交明细超过 {max_pages * limit} 条，无法确认同步完整性"
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
            page_limit = min(1000, remaining)
            page_until = min(
                end_timestamp,
                cursor + (page_limit - 1) * interval_milliseconds,
            )
            try:
                with self.request_lock:
                    rows = self.exchange.fetch_ohlcv(
                        ccxt_symbol,
                        timeframe=timeframe,
                        since=cursor,
                        limit=page_limit,
                        params={"until": page_until, "settle": GATE_SETTLE},
                    )
            except (ccxt.BaseError, OSError, TimeoutError, ConnectionError) as error:
                raise RuntimeError(f"CCXT Gate K 线请求失败：{error}") from error
            if not rows:
                break
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
                break
            latest_timestamp = max(received_timestamps)
            if latest_timestamp >= end_timestamp or len(rows) < page_limit:
                break
            next_cursor = latest_timestamp + interval_milliseconds
            if next_cursor <= cursor:
                break
            cursor = next_cursor
        return [
            candles_by_timestamp[timestamp]
            for timestamp in sorted(candles_by_timestamp)
        ]

    def _parse_open_position(self, row):
        if not isinstance(row, dict):
            return None
        info = row.get("info") if isinstance(row.get("info"), dict) else {}
        contracts = _first_float(row.get("contracts"), info.get("size")) or 0.0
        if contracts == 0:
            return None
        contract = str(
            info.get("contract") or row.get("symbol") or ""
        ).strip()
        if not contract:
            return None
        try:
            chart_symbol = chart_symbol_from_gate_contract(contract)
        except ValueError:
            return None
        side = str(row.get("side") or "").strip().lower()
        if side not in {"long", "short"}:
            size = _to_float(info.get("size"))
            if size is None:
                return None
            side = "long" if size > 0 else "short"
        entry_time_ms = _to_ms(
            info.get("open_time") or row.get("timestamp")
        )
        if not entry_time_ms:
            return None
        unified_symbol = str(row.get("symbol") or "").strip() or (
            f"{chart_symbol[:-4]}/USDT:USDT"
        )
        leverage = parse_gate_leverage(row, info)
        return {
            "venue": GATE_VENUE,
            "positionId": f"open:{chart_symbol}:{side}:{entry_time_ms}",
            "unifiedSymbol": unified_symbol,
            "chartSymbol": chart_symbol,
            "side": side,
            "status": "open",
            "entryPrice": _first_float(
                row.get("entryPrice"), info.get("entry_price")
            ),
            "exitPrice": None,
            "contracts": abs(contracts),
            "leverage": leverage,
            "marginMode": parse_gate_margin_mode(row, info),
            "hedged": str(info.get("mode") or "").strip().lower() == "dual",
            "realizedPnl": _first_float(
                row.get("realizedPnl"), info.get("realised_pnl")
            ),
            "netPnl": _first_float(
                info.get("realised_pnl"), row.get("realizedPnl")
            ),
            "funding": None,
            "openFee": None,
            "closeFee": None,
            "entryTimeMs": entry_time_ms,
            "exitTimeMs": None,
        }

    def _parse_closed_position(self, row):
        if not isinstance(row, dict):
            return None
        contract = str(row.get("contract") or "").strip()
        if not contract:
            return None
        try:
            chart_symbol = chart_symbol_from_gate_contract(contract)
        except ValueError:
            return None
        side = str(row.get("side") or "").strip().lower()
        if side not in {"long", "short"}:
            return None
        entry_time_ms = _to_ms(row.get("first_open_time"))
        exit_time_ms = _to_ms(row.get("time"))
        if not entry_time_ms or not exit_time_ms:
            return None
        long_price = _to_float(row.get("long_price"))
        short_price = _to_float(row.get("short_price"))
        if side == "long":
            entry_price, exit_price = long_price, short_price
        else:
            entry_price, exit_price = short_price, long_price
        fee = _to_float(row.get("pnl_fee"))
        unified_symbol = (
            f"{chart_symbol[:-4]}/USDT:USDT"
            if chart_symbol.endswith("USDT")
            else contract
        )
        return {
            "venue": GATE_VENUE,
            "positionId": f"close:{chart_symbol}:{side}:{entry_time_ms}:{exit_time_ms}",
            "unifiedSymbol": unified_symbol,
            "chartSymbol": chart_symbol,
            "side": side,
            "status": "closed",
            "entryPrice": entry_price,
            "exitPrice": exit_price,
            "contracts": _first_float(
                row.get("accum_size"), row.get("max_size")
            ),
            "leverage": parse_gate_leverage({}, row),
            "marginMode": None,
            "hedged": False,
            "realizedPnl": _first_float(row.get("pnl_pnl"), row.get("pnl")),
            "netPnl": _to_float(row.get("pnl")),
            "funding": _to_float(row.get("pnl_fund")),
            "openFee": None,
            "closeFee": fee,
            "entryTimeMs": entry_time_ms,
            "exitTimeMs": exit_time_ms,
        }
