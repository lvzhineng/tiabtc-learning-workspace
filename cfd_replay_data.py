"""Independent CFD cache and drawings. Market closures are queried ranges, not holes."""

import json
import threading
import time
from datetime import datetime

from gate_cfd_provider import CFD_INTERVAL_MS, validate_cfd_scope


class CfdReplayData:
    def __init__(self, database, database_lock, provider):
        self.database = database
        self.database_lock = database_lock
        self.provider = provider
        self.locks_guard = threading.Lock()
        self.locks = {}
        self.failures = {}

    def _lock(self, symbol, interval):
        with self.locks_guard:
            return self.locks.setdefault((symbol, interval), threading.Lock())

    def _rows(self, symbol, interval, start, end, limit=3000):
        with self.database() as connection:
            rows = connection.execute(
                "SELECT timestamp, open, high, low, close FROM cfd_candles "
                "WHERE symbol = ? AND interval = ? AND timestamp BETWEEN ? AND ? ORDER BY timestamp LIMIT ?",
                (symbol, interval, start, end, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def _store(self, symbol, interval, start, end, candles):
        now = time.time()
        with self.database_lock, self.database() as connection:
            connection.executemany(
                "INSERT INTO cfd_candles VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(symbol, interval, timestamp) DO UPDATE SET "
                "open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close",
                [(symbol, interval, row["timestamp"], row["open"], row["high"], row["low"], row["close"]) for row in candles],
            )
            ranges = connection.execute(
                "SELECT start_timestamp, end_timestamp, fetched_at FROM cfd_cache_ranges "
                "WHERE symbol=? AND interval=? AND end_timestamp>=? AND start_timestamp<=?",
                (symbol, interval, start - 1, end + 1),
            ).fetchall()
            connection.execute(
                "DELETE FROM cfd_cache_ranges WHERE symbol=? AND interval=? "
                "AND end_timestamp>=? AND start_timestamp<=?",
                (symbol, interval, start - 1, end + 1),
            )
            connection.execute(
                "INSERT INTO cfd_cache_ranges VALUES (?, ?, ?, ?, ?)",
                (symbol, interval, min([start, *[row["start_timestamp"] for row in ranges]]),
                 max([end, *[row["end_timestamp"] for row in ranges]]), now),
            )

    def _missing(self, symbol, interval, start, end):
        now_ms = int(time.time() * 1000)
        with self.database() as connection:
            ranges = connection.execute(
                "SELECT start_timestamp, end_timestamp FROM cfd_cache_ranges "
                "WHERE symbol=? AND interval=? AND end_timestamp>=? AND start_timestamp<=? "
                "ORDER BY start_timestamp",
                (symbol, interval, start, end),
            ).fetchall()
        # Live bars are re-read at most once per 30 seconds by _ensure.
        cursor, missing = start, []
        for row in ranges:
            left, right = row["start_timestamp"], row["end_timestamp"]
            if left > cursor:
                missing.append((cursor, min(end, left - 1)))
            cursor = max(cursor, right + 1)
        if cursor <= end:
            missing.append((cursor, end))
        if end >= now_ms - CFD_INTERVAL_MS[interval] * 2:
            with self.database() as connection:
                recent = connection.execute(
                    "SELECT MAX(fetched_at) FROM cfd_cache_ranges WHERE symbol=? AND interval=? AND end_timestamp>=?",
                    (symbol, interval, end),
                ).fetchone()[0]
            if recent is None or time.time() - recent >= 30:
                missing.append((max(start, now_ms - CFD_INTERVAL_MS[interval] * 2), end))
        return missing

    def _fetch(self, symbol, interval, **params):
        key = (symbol, interval, tuple(sorted(params.items())))
        failed = self.failures.get(key)
        if failed and time.monotonic() - failed[0] < 5:
            raise RuntimeError(failed[1])
        try:
            result = self.provider.fetch(symbol, interval, **params)
        except RuntimeError as error:
            self.failures[key] = (time.monotonic(), str(error))
            if len(self.failures) > 128:
                self.failures.pop(next(iter(self.failures)))
            raise
        self.failures.pop(key, None)
        return result

    def _ensure(self, symbol, interval, start, end):
        if start > end:
            return
        step = CFD_INTERVAL_MS[interval]
        for left, right in self._missing(symbol, interval, start, end):
            cursor = left
            while cursor <= right:
                page_end = min(right, cursor + 499 * step)
                candles = self._fetch(symbol, interval, start=cursor, end=page_end)
                candles = [row for row in candles if cursor <= row["timestamp"] <= page_end]
                self._store(symbol, interval, cursor, page_end, candles)
                cursor = page_end + 1

    def _before(self, symbol, interval, end, count):
        # Find actual bars with end_time pagination, so weekends need no scans.
        step = CFD_INTERVAL_MS[interval]
        start = max(1, end - count * step * 2)
        cached = self._rows(symbol, interval, start, end, limit=count * 2)
        if cached:
            cached_start = cached[max(0, len(cached) - count)]["timestamp"]
            self._ensure(symbol, interval, cached_start, end)
            cached = self._rows(symbol, interval, cached_start, end, limit=count * 2)
            if len(cached) >= count:
                return cached[-count:]
        if not self._missing(symbol, interval, start, end):
            return cached[-count:]
        candles = {row["timestamp"]: row for row in cached}
        cursor = cached[0]["timestamp"] - 1 if cached else end
        while len(candles) < count:
            page = self._fetch(symbol, interval, end=cursor, limit=min(500, count - len(candles)))
            page = [row for row in page if row["timestamp"] <= cursor]
            if not page:
                self._store(symbol, interval, max(1, cursor - 500 * step), cursor, [])
                break
            left = page[0]["timestamp"]
            self._store(symbol, interval, left, cursor, page)
            candles.update((row["timestamp"], row) for row in page)
            cursor = left - 1
            if cursor <= 0:
                break
        return sorted(candles.values(), key=lambda row: row["timestamp"])[-count:]

    def _after(self, symbol, interval, start, end, count):
        step = CFD_INTERVAL_MS[interval]
        rows, cursor = [], start
        # Bounded look-ahead skips closures without fetching unbounded history.
        horizon = min(end, start + max(count * step * 4, 14 * 86_400_000))
        while cursor <= horizon and len(rows) < count:
            page_end = min(horizon, cursor + 499 * step)
            self._ensure(symbol, interval, cursor, page_end)
            rows.extend(self._rows(symbol, interval, cursor, page_end))
            cursor = page_end + 1
        return rows[:count]

    def load(self, symbol, interval, *, anchor=None, before=None, after=None, replay_cursor=None, cutoff=None, limit=500, offline=False):
        validate_cfd_scope(symbol, interval)
        if not isinstance(limit, int) or not 1 <= limit <= 3000:
            raise ValueError("CFD 单次加载数量必须是 1–3000")
        for value in (anchor, before, after, replay_cursor, cutoff):
            if value is not None and (not isinstance(value, int) or value <= 0):
                raise ValueError("CFD K 线时间无效")
        now = int(time.time() * 1000)
        end = min(now, cutoff or now)
        latest_closed_start = end - CFD_INTERVAL_MS[interval]
        warning = None
        with self._lock(symbol, interval):
            target = min(latest_closed_start, before - 1 if before is not None else replay_cursor or anchor or end)
            try:
                if offline:
                    raise RuntimeError("离线模式：仅显示本机已有 CFD 行情")
                if after is not None:
                    candles = self._after(symbol, interval, after + 1, latest_closed_start, limit)
                else:
                    count_before = limit if before is not None or target == latest_closed_start else max(1, limit * 3 // 4)
                    candles = self._before(symbol, interval, target, count_before)
                    if before is None and target < latest_closed_start:
                        candles += self._after(symbol, interval, target + 1, latest_closed_start, limit - len(candles))
            except RuntimeError as error:
                # Read-only fallback; never record failed requests as coverage.
                warning = str(error)
                if after is not None:
                    candles = self._rows(symbol, interval, after + 1, end)[:limit]
                else:
                    with self.database() as connection:
                        rows = connection.execute(
                            "SELECT timestamp, open, high, low, close FROM cfd_candles "
                            "WHERE symbol=? AND interval=? AND timestamp<=? ORDER BY timestamp DESC LIMIT ?",
                            (symbol, interval, target, limit),
                        ).fetchall()
                    candles = [dict(row) for row in reversed(rows)]
                if not candles and not offline:
                    raise
        # Like the existing replay feed, only return completed bars. Otherwise
        # ArrowRight on a live bar would persist a replay cursor in the future.
        candles = [row for row in candles if row["timestamp"] + CFD_INTERVAL_MS[interval] <= end]
        return {"candles": candles[:limit], "source": "gate-cfd", "volumeAvailable": False, "warning": warning}

    def list_drawings(self, symbol, interval):
        validate_cfd_scope(symbol, interval)
        with self.database() as connection:
            rows = connection.execute("SELECT interval, tool_json FROM cfd_drawings WHERE symbol=? ORDER BY created_at, id", (symbol,)).fetchall()
        return [{**json.loads(row["tool_json"]), "interval": row["interval"]} for row in rows]

    def save_drawing(self, payload, validator):
        symbol, interval = str(payload.get("symbol", "")), str(payload.get("interval", ""))
        validate_cfd_scope(symbol, interval)
        drawing, encoded = validator(payload)
        now = datetime.now().astimezone().isoformat()
        with self.database_lock, self.database() as connection:
            connection.execute(
                "INSERT INTO cfd_drawings VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(symbol, id) DO UPDATE SET interval=excluded.interval, tool_json=excluded.tool_json, updated_at=excluded.updated_at",
                (symbol, drawing["id"], interval, encoded, now, now),
            )
        return {**drawing, "interval": interval}

    def replace_drawings(self, payload, validator):
        symbol, interval = str(payload.get("symbol", "")), str(payload.get("interval", ""))
        validate_cfd_scope(symbol, interval)
        drawings = payload.get("drawings")
        if not isinstance(drawings, list) or len(drawings) > 500:
            raise ValueError("画图批量记录无效")
        validated, ids = [], set()
        for item in drawings:
            item_interval = str(item.get("interval", interval))
            validate_cfd_scope(symbol, item_interval)
            drawing, encoded = validator(item)
            if drawing["id"] in ids:
                raise ValueError("画图 ID 重复")
            ids.add(drawing["id"])
            validated.append((drawing, encoded, item_interval))
        now = datetime.now().astimezone().isoformat()
        with self.database_lock, self.database() as connection:
            created = {row["id"]: row["created_at"] for row in connection.execute("SELECT id, created_at FROM cfd_drawings WHERE symbol=?", (symbol,))}
            connection.execute("DELETE FROM cfd_drawings WHERE symbol=?", (symbol,))
            connection.executemany("INSERT INTO cfd_drawings VALUES (?, ?, ?, ?, ?, ?)",
                                   [(symbol, drawing["id"], item_interval, encoded, created.get(drawing["id"], now), now) for drawing, encoded, item_interval in validated])
        return [{**drawing, "interval": item_interval} for drawing, _, item_interval in validated]

    def delete_drawings(self, query):
        symbol, interval = query.get("symbol", [""])[0], query.get("interval", [""])[0]
        validate_cfd_scope(symbol, interval)
        drawing_id = query.get("id", [""])[0]
        with self.database_lock, self.database() as connection:
            if drawing_id:
                connection.execute("DELETE FROM cfd_drawings WHERE symbol=? AND id=?", (symbol, drawing_id))
            else:
                connection.execute("DELETE FROM cfd_drawings WHERE symbol=?", (symbol,))
