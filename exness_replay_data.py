"""Account-isolated native Exness OHLC cache for imported position review."""

import threading
import time

from exness_market_provider import INTERVAL_MS, PAGE_LIMIT, market_scope


class ExnessReplayData:
    def __init__(self, database, database_lock, provider, load_credentials):
        self.database, self.database_lock = database, database_lock
        self.provider, self.load_credentials = provider, load_credentials
        self.locks_guard = threading.Lock()
        self.locks = {}
        self.failures = {}
        self.live_fetched_at = {}

    def _lock(self, key):
        with self.locks_guard:
            return self.locks.setdefault(key, threading.Lock())

    def _rows(self, scope, symbol, interval, start, end):
        with self.database() as connection:
            rows = connection.execute(
                """SELECT timestamp, open, high, low, close FROM exness_market_candles
                   WHERE scope=? AND symbol=? AND interval=? AND timestamp BETWEEN ? AND ?
                   ORDER BY timestamp LIMIT 3000""", (scope, symbol, interval, start, end)).fetchall()
        return [dict(row) for row in rows]

    def _missing(self, scope, symbol, interval, start, end):
        with self.database() as connection:
            ranges = connection.execute(
                """SELECT start_timestamp, end_timestamp FROM exness_market_cache_ranges
                   WHERE scope=? AND symbol=? AND interval=? AND end_timestamp>=? AND start_timestamp<=?
                   ORDER BY start_timestamp""", (scope, symbol, interval, start, end)).fetchall()
        cursor, missing = start, []
        for row in ranges:
            if row["start_timestamp"] > cursor:
                missing.append((cursor, min(end, row["start_timestamp"] - 1)))
            cursor = max(cursor, row["end_timestamp"] + 1)
        if cursor <= end:
            missing.append((cursor, end))
        return missing

    def _store(self, scope, symbol, interval, start, end, rows):
        with self.database_lock, self.database() as connection:
            connection.executemany(
                """INSERT INTO exness_market_candles VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(scope, symbol, interval, timestamp) DO UPDATE SET
                   open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close""",
                [(scope, symbol, interval, row["timestamp"], row["open"], row["high"], row["low"], row["close"]) for row in rows])
            if end < start:
                return
            adjacent = connection.execute(
                """SELECT start_timestamp, end_timestamp FROM exness_market_cache_ranges
                   WHERE scope=? AND symbol=? AND interval=? AND end_timestamp>=? AND start_timestamp<=?""",
                (scope, symbol, interval, start - 1, end + 1)).fetchall()
            left = min([start] + [row["start_timestamp"] for row in adjacent])
            right = max([end] + [row["end_timestamp"] for row in adjacent])
            connection.execute(
                """DELETE FROM exness_market_cache_ranges WHERE scope=? AND symbol=? AND interval=?
                   AND end_timestamp>=? AND start_timestamp<=?""", (scope, symbol, interval, start - 1, end + 1))
            connection.execute("INSERT INTO exness_market_cache_ranges VALUES (?, ?, ?, ?, ?, ?)",
                               (scope, symbol, interval, left, right, time.time()))

    def load_window(self, symbol, interval, start, end, *, offline=False):
        if interval not in INTERVAL_MS:
            raise ValueError("不支持该Exness K线周期")
        step = INTERVAL_MS[interval]
        if start <= 0 or end < start or (end - start) // step + 1 > 3000:
            raise ValueError("Exness K线窗口无效或超过3000根上限")
        credentials = self.load_credentials()
        scope = market_scope(credentials)
        # Position review includes the current native D/W candle. Persist its
        # OHLC, but never mark its unfinished period as permanent coverage.
        complete_end = min(end, int(time.time() * 1000) - step)
        warning = None
        key = (scope, symbol, interval)
        with self._lock(key):
            attempted_fetch = False
            missing = self._missing(scope, symbol, interval, start, complete_end)
            live_start = max(start, complete_end + 1)
            refresh_live = live_start <= end and time.monotonic() - self.live_fetched_at.get(key, 0) >= 30
            if refresh_live:
                if missing and missing[-1][1] + 1 == live_start:
                    missing[-1] = (missing[-1][0], end)
                else:
                    missing.append((live_start, end))
            try:
                if missing and offline:
                    raise RuntimeError("离线模式：仅显示本机已有Exness行情")
                previous = self.failures.get(key)
                if missing and previous and time.monotonic() < previous[0]:
                    raise RuntimeError(previous[1])
                for left, right in missing:
                    cursor = left
                    while cursor <= right:
                        page_end = min(right + 1, cursor + PAGE_LIMIT * step)
                        attempted_fetch = True
                        rows = self.provider.fetch(credentials, symbol, interval, cursor, page_end)
                        self._store(scope, symbol, interval, cursor, min(page_end - 1, complete_end), rows)
                        cursor = page_end
                if refresh_live:
                    if len(self.live_fetched_at) > 100:
                        self.live_fetched_at.clear()
                    self.live_fetched_at[key] = time.monotonic()
                self.failures.pop(key, None)
            except RuntimeError as error:
                warning = str(error)
                if not offline and attempted_fetch:
                    if len(self.failures) > 100:
                        self.failures.clear()
                    self.failures[key] = (time.monotonic() + 5, warning)
            rows = self._rows(scope, symbol, interval, start, end)
        if not rows and warning and not offline:
            raise RuntimeError(warning)
        return {"candles": rows, "source": "exness", "candleVenue": scope,
                "volumeAvailable": False, "warning": warning, "priceType": "bid"}

    def load_edge(self, symbol, interval, *, before=None, after=None, limit=500, offline=False):
        if interval not in INTERVAL_MS or not 1 <= limit <= 3000 or (before is None) == (after is None):
            raise ValueError("Exness延展参数无效")
        boundary = before if before is not None else after
        if boundary <= 0:
            raise ValueError("Exness延展时间无效")
        step = INTERVAL_MS[interval]
        # A bounded date window keeps closures empty; no scan of all history.
        if before is not None:
            start, end = max(1, before - limit * step), before - 1
        else:
            start, end = after + 1, min(int(time.time() * 1000), after + limit * step)
        if end < start:
            return {"candles": [], "source": "exness", "candleVenue": market_scope(self.load_credentials()),
                    "volumeAvailable": False, "warning": None, "priceType": "bid"}
        return self.load_window(symbol, interval, start, end, offline=offline)
