"""Read-only Gate TradFi/CFD public market data (no account credentials)."""

import json
import math
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


CFD_SYMBOLS = {
    "XAUUSD": {"symbol": "XAUUSD", "name": "黄金", "quote": "USD"},
    "NAS100": {"symbol": "NAS100", "name": "纳斯达克100", "quote": "USD"},
    "JPN225": {"symbol": "JPN225", "name": "日经225", "quote": "JPY"},
}
CFD_TIMEFRAMES = {"1": "1m", "5": "5m", "15": "15m", "60": "1h", "240": "4h", "D": "1d", "W": "7d"}
CFD_INTERVAL_MS = {"1": 60_000, "5": 300_000, "15": 900_000, "60": 3_600_000, "240": 14_400_000, "D": 86_400_000, "W": 604_800_000}


def validate_cfd_scope(symbol, interval):
    if symbol not in CFD_SYMBOLS:
        raise ValueError("不支持该 CFD 品种")
    if interval not in CFD_TIMEFRAMES:
        raise ValueError("不支持该 CFD K 线周期")


class GateCfdRequestError(RuntimeError):
    def __init__(self, label, message):
        self.label = label
        super().__init__(message)


class GateCfdMarketDataProvider:
    PAGE_LIMIT = 500

    def __init__(self):
        self.request_lock = threading.Lock()
        self.next_request_at = 0.0

    def _request(self, symbol, params):
        url = f"https://api.gateio.ws/api/v4/tradfi/symbols/{symbol}/klines?{urlencode(params)}"
        for attempt in range(3):
            try:
                with self.request_lock:
                    time.sleep(max(0, self.next_request_at - time.monotonic()))
                    self.next_request_at = time.monotonic() + 0.25
                    request = Request(url, headers={"Accept": "application/json", "User-Agent": "TiaBTC-CFD-Replay/1.0"})
                    with urlopen(request, timeout=12) as response:
                        encoded = response.read(5_000_001)
                    if len(encoded) > 5_000_000:
                        raise RuntimeError("Gate CFD 行情响应过大")
                    data = json.loads(encoded)
                if not isinstance(data, dict) or data.get("label"):
                    raise GateCfdRequestError(str(data.get("label", "")), "Gate CFD 返回行情错误")
                rows = data.get("data", {}).get("list")
                if not isinstance(rows, list):
                    raise RuntimeError("Gate CFD 行情格式无效")
                candles = {}
                for row in rows:
                    timestamp = int(row["t"]) * 1000
                    prices = [float(row[key]) for key in ("o", "h", "l", "c")]
                    if timestamp <= 0 or not all(math.isfinite(value) and value > 0 for value in prices):
                        raise ValueError("invalid OHLC")
                    if prices[1] < max(prices[0], prices[2], prices[3]) or prices[2] > min(prices[0], prices[1], prices[3]):
                        raise ValueError("invalid OHLC range")
                    candles[timestamp] = dict(zip(("timestamp", "open", "high", "low", "close"), (timestamp, *prices)))
                return sorted(candles.values(), key=lambda row: row["timestamp"])
            except HTTPError as error:
                try:
                    data = json.loads(error.read(4096))
                except (ValueError, OSError):
                    data = {}
                label = str(data.get("label", ""))
                message = str(data.get("message", ""))
                if error.code < 500 and error.code != 429 and label != "INTERNAL_SERVER_ERROR":
                    raise GateCfdRequestError(label, f"Gate CFD 请求失败：{message or label or error.code}") from None
            except (URLError, TimeoutError, OSError):
                pass
            except (ValueError, TypeError, KeyError, AttributeError) as error:
                raise RuntimeError("Gate CFD 行情格式无效") from error
            if attempt < 2:
                time.sleep(0.5 * (attempt + 1))
        raise RuntimeError("Gate CFD 暂时无法连接，请稍后重试")

    def fetch(self, symbol, interval, *, start=None, end=None, limit=None):
        validate_cfd_scope(symbol, interval)
        params = {"kline_type": CFD_TIMEFRAMES[interval]}
        if start is not None:
            params["begin_time"] = start // 1000
        if end is not None:
            params["end_time"] = end // 1000
        # Gate rejects begin_time + end_time + limit together.
        if limit is not None and start is None:
            params["limit"] = min(self.PAGE_LIMIT, limit)
        try:
            return self._request(symbol, params)
        except GateCfdRequestError as error:
            message = str(error).lower()
            if interval != "5" or not ("kline" in message and any(word in message for word in ("unsupported", "not support", "不支持"))):
                raise
            # Only an explicit unsupported-period error permits aggregation.
            end = end if end is not None else int(time.time() * 1000)
            start = start if start is not None else end - (limit or 500) * 300_000 * 3
            raw = []
            cursor = start
            while cursor <= end:
                page_end = min(end, cursor + (self.PAGE_LIMIT - 1) * 60_000)
                raw.extend(self.fetch(symbol, "1", start=cursor, end=page_end))
                cursor = page_end + 1000
            grouped = {}
            for row in raw:
                stamp = row["timestamp"] // 300_000 * 300_000
                item = grouped.setdefault(stamp, {**row, "timestamp": stamp})
                item["high"] = max(item["high"], row["high"])
                item["low"] = min(item["low"], row["low"])
                item["close"] = row["close"]
            result = sorted(grouped.values(), key=lambda row: row["timestamp"])
            return result[-limit:] if limit else result
