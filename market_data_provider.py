import math
import os
import re
import threading

import ccxt


CCXT_TIMEFRAMES = {
    "1": "1m",
    "5": "5m",
    "15": "15m",
    "60": "1h",
    "240": "4h",
    "D": "1d",
    "W": "1w",
}


class CcxtBybitMarketDataProvider:
    def __init__(self, timeout_milliseconds=12_000):
        config = {
            "enableRateLimit": True,
            "timeout": timeout_milliseconds,
            "options": {
                "defaultType": "swap",
                "maxRetriesOnFailure": 3,
                "maxRetriesOnFailureDelay": 500,
            },
        }
        proxy = (
            os.environ.get("HTTPS_PROXY")
            or os.environ.get("https_proxy")
            or os.environ.get("HTTP_PROXY")
            or os.environ.get("http_proxy")
        )
        if proxy:
            config["httpsProxy"] = proxy

        self.exchange = ccxt.bybit(config)
        self.request_lock = threading.RLock()

    def warm_up(self):
        try:
            with self.request_lock:
                self.exchange.load_markets()
        except (ccxt.BaseError, OSError, TimeoutError, ConnectionError) as error:
            raise RuntimeError(f"CCXT Bybit 市场信息预热失败：{error}") from error

    @staticmethod
    def to_ccxt_symbol(symbol):
        normalized = str(symbol or "").strip().upper()
        if not re.match(r"^[A-Z0-9]{3,15}USDT$", normalized):
            raise ValueError("交割单交易对无法映射为 Bybit USDT 永续合约")
        return f"{normalized[:-4]}/USDT:USDT"

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

        ccxt_symbol = self.to_ccxt_symbol(symbol)
        candles_by_timestamp = {}
        cursor = start_timestamp

        while cursor <= end_timestamp:
            remaining = max(
                1,
                math.ceil((end_timestamp - cursor) / interval_milliseconds) + 1,
            )
            page_limit = min(1000, remaining)
            try:
                with self.request_lock:
                    rows = self.exchange.fetch_ohlcv(
                        ccxt_symbol,
                        timeframe=timeframe,
                        since=cursor,
                        limit=page_limit,
                        params={"category": "linear"},
                    )
            except (ccxt.BaseError, OSError, TimeoutError, ConnectionError) as error:
                raise RuntimeError(f"CCXT Bybit K 线请求失败：{error}") from error

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
