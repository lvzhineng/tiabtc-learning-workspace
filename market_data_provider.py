import math
import os
import re
import threading
import time
from urllib.request import getproxies

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
MARKET_CATALOG_TTL_SECONDS = 30 * 60


class CcxtBybitMarketDataProvider:
    def __init__(self, timeout_milliseconds=12_000):
        config = {
            "enableRateLimit": True,
            "timeout": timeout_milliseconds,
            "options": {
                "defaultType": "swap",
                "fetchMarkets": {"types": ["linear"]},
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
        if not proxy:
            system_proxies = getproxies()
            proxy = system_proxies.get("https") or system_proxies.get("http")
        if proxy:
            config["httpsProxy"] = proxy

        self.exchange = ccxt.bybit(config)
        self.request_lock = threading.RLock()
        self._catalog_state_lock = threading.Lock()
        self._perpetual_catalog = []
        self._perpetual_catalog_loaded_at = 0.0
        self._catalog_refreshing = False
        self._catalog_refresh_attempted_at = 0.0

    @staticmethod
    def _build_perpetual_catalog(markets):
        catalog_by_symbol = {}
        for market in (markets or {}).values():
            if (
                not market.get("swap")
                or market.get("linear") is not True
                or str(market.get("quote") or "").upper() != "USDT"
                or str(market.get("settle") or "").upper() != "USDT"
                or market.get("active") is False
            ):
                continue

            symbol = str(market.get("id") or "").strip().upper()
            base = str(market.get("base") or "").strip().upper()
            if not re.fullmatch(r"[A-Z0-9]{3,15}USDT", symbol):
                continue
            if not base or symbol != f"{base}USDT":
                continue
            catalog_by_symbol[symbol] = {
                "symbol": symbol,
                "base": base,
                "quote": "USDT",
                "name": f"{base}/USDT 永续",
            }
        return sorted(catalog_by_symbol.values(), key=lambda item: item["symbol"])

    @staticmethod
    def _market_match_key(item, query):
        symbol = item["symbol"]
        base = item["base"]
        if query == symbol:
            rank = 0
        elif query == base:
            rank = 1
        elif symbol.startswith(query):
            rank = 2
        elif base.startswith(query):
            rank = 3
        elif query in symbol:
            rank = 4
        else:
            return None
        return rank, len(symbol), symbol

    def _refresh_perpetual_catalog(self, reserved=False):
        if not reserved:
            with self._catalog_state_lock:
                if self._catalog_refreshing:
                    return
                self._catalog_refreshing = True
                self._catalog_refresh_attempted_at = time.monotonic()
        try:
            with self.request_lock:
                markets = self.exchange.load_markets(
                    reload=bool(self.exchange.markets)
                )
            catalog = self._build_perpetual_catalog(markets)
            with self._catalog_state_lock:
                self._perpetual_catalog = catalog
                self._perpetual_catalog_loaded_at = time.monotonic()
        except (ccxt.BaseError, OSError, TimeoutError, ConnectionError) as error:
            raise RuntimeError(f"CCXT Bybit 市场信息预热失败：{error}") from error
        finally:
            with self._catalog_state_lock:
                self._catalog_refreshing = False

    def _schedule_catalog_refresh(self):
        now = time.monotonic()
        with self._catalog_state_lock:
            if (
                self._catalog_refreshing
                or now - self._catalog_refresh_attempted_at < 60
            ):
                return
            self._catalog_refreshing = True
            self._catalog_refresh_attempted_at = now

        def refresh():
            try:
                self._refresh_perpetual_catalog(reserved=True)
            except RuntimeError:
                # Search returns the saved-symbol fallback while the catalog is
                # unavailable. The next search may retry after the cooldown.
                pass

        threading.Thread(
            target=refresh,
            name="ccxt-market-catalog-refresh",
            daemon=True,
        ).start()

    def warm_up(self):
        self._refresh_perpetual_catalog()

    def search_usdt_perpetual_markets(self, query, limit=20):
        normalized_query = re.sub(r"[^A-Z0-9]", "", str(query or "").upper())
        if not normalized_query:
            return []
        with self._catalog_state_lock:
            catalog = list(self._perpetual_catalog)
            catalog_is_stale = (
                not catalog
                or time.monotonic() - self._perpetual_catalog_loaded_at
                >= MARKET_CATALOG_TTL_SECONDS
            )
        if catalog_is_stale:
            self._schedule_catalog_refresh()
        if not catalog:
            raise RuntimeError("Bybit 永续合约目录正在加载，请稍后重试")

        matches = []
        for item in catalog:
            match_key = self._market_match_key(item, normalized_query)
            if match_key is not None:
                matches.append((match_key, item))
        matches.sort(key=lambda entry: entry[0])
        return [dict(item) for _key, item in matches[:limit]]

    def usdt_perpetual_presence(self, symbol):
        """Return 'present', 'absent', or 'unknown' for a compact USDT perpetual."""
        normalized = str(symbol or "").strip().upper()
        if not re.fullmatch(r"[A-Z0-9]{3,15}USDT", normalized):
            return "absent"
        with self._catalog_state_lock:
            catalog = list(self._perpetual_catalog)
            catalog_loaded = self._perpetual_catalog_loaded_at > 0
        if any(item["symbol"] == normalized for item in catalog):
            return "present"
        markets = self.exchange.markets or {}
        for market in markets.values():
            if (
                str(market.get("id") or "").strip().upper() == normalized
                and market.get("swap")
                and market.get("linear") is True
                and str(market.get("quote") or "").upper() == "USDT"
                and market.get("active") is not False
            ):
                return "present"
        if catalog_loaded:
            return "absent"
        self._schedule_catalog_refresh()
        return "unknown"

    def has_usdt_perpetual_symbol(self, symbol):
        return self.usdt_perpetual_presence(symbol) == "present"

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

    def fetch_open_interest_15m(self, symbol, start_timestamp, end_timestamp):
        return self._fetch_open_interest_bars(
            symbol,
            "15m",
            900_000,
            start_timestamp,
            end_timestamp,
        )

    def fetch_open_interest_1h(self, symbol, start_timestamp, end_timestamp):
        return self._fetch_open_interest_bars(
            symbol,
            "1h",
            3_600_000,
            start_timestamp,
            end_timestamp,
        )

    def _fetch_open_interest_bars(
        self,
        symbol,
        timeframe,
        bar_ms,
        start_timestamp,
        end_timestamp,
    ):
        if start_timestamp > end_timestamp:
            return []

        ccxt_symbol = self.to_ccxt_symbol(symbol)
        cursor = start_timestamp // bar_ms * bar_ms
        end_aligned = end_timestamp // bar_ms * bar_ms
        rows_by_timestamp = {}

        while cursor <= end_aligned:
            remaining = max(1, (end_aligned - cursor) // bar_ms + 1)
            page_limit = min(200, remaining)
            page_until = min(
                end_aligned,
                cursor + (page_limit - 1) * bar_ms,
            )
            try:
                with self.request_lock:
                    rows = self.exchange.fetch_open_interest_history(
                        ccxt_symbol,
                        timeframe,
                        cursor,
                        page_limit,
                        {
                            "category": "linear",
                            "until": page_until,
                        },
                    )
            except (ccxt.BaseError, OSError, TimeoutError, ConnectionError) as error:
                raise RuntimeError(f"CCXT Bybit OI 请求失败：{error}") from error

            for row in rows or []:
                timestamp = int(row.get("timestamp") or 0)
                amount = row.get("openInterestAmount")
                if amount is None:
                    info = row.get("info") or {}
                    amount = info.get("openInterest")
                if timestamp < cursor or timestamp > end_aligned or amount is None:
                    continue
                rows_by_timestamp[timestamp] = (
                    symbol,
                    timestamp,
                    float(amount),
                )

            next_cursor = page_until + bar_ms
            if next_cursor <= cursor:
                break
            cursor = next_cursor

        return [
            rows_by_timestamp[timestamp]
            for timestamp in sorted(rows_by_timestamp)
        ]
