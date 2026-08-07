import json
import math
import re
import os
import shutil
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from market_data_provider import CcxtBybitMarketDataProvider


ROOT = Path(__file__).resolve().parent
STATE_FILE = ROOT / "learning-state.json"
DEFAULT_DATABASE_FILE = ROOT / "tiabtc-review.sqlite"
DATABASE_FILE = DEFAULT_DATABASE_FILE
SEED_DATABASE_FILE = ROOT / "data" / "tiabtc-review-seed.sqlite"
HOST = "127.0.0.1"
PORT = 8765
VALID_STATUSES = {"unlearned", "learning", "learned"}
VALID_SYMBOLS = {"BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "DOGEUSDT", "XRPUSDT"}
VALID_INTERVALS = {"1", "5", "15", "60", "240", "D", "W"}
VALID_DRAWING_TYPES = {
    "TrendLine", "HorizontalLine", "HorizontalRay", "VerticalLine", "FibRetracement", "Ray",
    "ExtendedLine", "Arrow", "Rectangle", "ParallelChannel", "ShortPosition", "LongPosition",
    "DatePriceRange", "Path", "TextAnnotation", "FixedRangeVolumeProfile", "ArrowMarkUp",
    "ArrowMarkDown", "Brush", "RotatedRectangle",
}
DRAWING_POINT_COUNTS = {
    "TrendLine": 2, "HorizontalLine": 1, "HorizontalRay": 1, "VerticalLine": 1,
    "FibRetracement": 2, "Ray": 2,
    "ExtendedLine": 2, "Arrow": 2, "Rectangle": 2, "ParallelChannel": 3,
    "ShortPosition": 3, "LongPosition": 3, "DatePriceRange": 2, "Path": (2, 500),
    "TextAnnotation": 1, "FixedRangeVolumeProfile": 2, "ArrowMarkUp": 1,
    "ArrowMarkDown": 1, "Brush": (2, 1000), "RotatedRectangle": 3,
}
SYSTEM_DRAWING_PREFIX = "__system__:"
GLOBAL_DRAWING_SCOPE = "__global__"
MAX_DRAWING_JSON_BYTES = 200_000
INTERVAL_MILLISECONDS = {
    "1": 60_000,
    "5": 5 * 60_000,
    "15": 15 * 60_000,
    "60": 60 * 60_000,
    "240": 4 * 60 * 60_000,
    "D": 24 * 60 * 60_000,
    "W": 7 * 24 * 60 * 60_000,
}
FETCH_FAILURE_COOLDOWN_SECONDS = 60
TRAILING_REFRESH_COOLDOWN_SECONDS = 90
DATABASE_LOCK = threading.RLock()
MARKET_FETCH_LOCKS_GUARD = threading.Lock()
MARKET_FETCH_LOCKS = {}
MARKET_FETCH_FAILURES = {}
MARKET_TRAILING_REFRESH_AT = {}
MARKET_TRAILING_REFRESHING = set()
MARKET_DATA_PROVIDER = CcxtBybitMarketDataProvider()
MARKET_REFRESHING = set()


def load_state():
    if not STATE_FILE.exists():
        return {"records": {}}
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        records = data.get("records", {})
        return {"records": records if isinstance(records, dict) else {}}
    except (OSError, json.JSONDecodeError):
        return {"records": {}}


def write_state(state):
    temporary_file = STATE_FILE.with_suffix(".json.tmp")
    temporary_file.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary_file, STATE_FILE)


@contextmanager
def database():
    connection = sqlite3.connect(DATABASE_FILE, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=30000")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_database():
    if DATABASE_FILE == DEFAULT_DATABASE_FILE and not DATABASE_FILE.exists() and SEED_DATABASE_FILE.exists():
        shutil.copy2(SEED_DATABASE_FILE, DATABASE_FILE)
    with DATABASE_LOCK, database() as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS market_candles (
                symbol TEXT NOT NULL,
                interval TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                open REAL NOT NULL,
                high REAL NOT NULL,
                low REAL NOT NULL,
                close REAL NOT NULL,
                volume REAL NOT NULL,
                PRIMARY KEY (symbol, interval, timestamp)
            );
            CREATE TABLE IF NOT EXISTS market_cache_ranges (
                symbol TEXT NOT NULL,
                interval TEXT NOT NULL,
                start_timestamp INTEGER NOT NULL,
                end_timestamp INTEGER NOT NULL,
                fetched_at TEXT NOT NULL,
                PRIMARY KEY (symbol, interval, start_timestamp, end_timestamp)
            );
            CREATE TABLE IF NOT EXISTS chart_drawings (
                id TEXT PRIMARY KEY,
                video_id TEXT NOT NULL,
                symbol TEXT NOT NULL,
                interval TEXT NOT NULL,
                tool_type TEXT NOT NULL,
                tool_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS custom_symbols (
                symbol TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                added_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS paper_trades (
                id TEXT PRIMARY KEY,
                video_id TEXT NOT NULL,
                symbol TEXT NOT NULL,
                interval TEXT NOT NULL,
                direction TEXT NOT NULL,
                entry_price REAL NOT NULL,
                tp_price REAL NOT NULL,
                sl_price REAL NOT NULL,
                rr_ratio REAL NOT NULL,
                status TEXT NOT NULL,
                pnl_r REAL DEFAULT 0,
                created_at TEXT NOT NULL,
                closed_at TEXT
            );
            INSERT OR IGNORE INTO app_settings (key, value) VALUES ('offline_mode', 'true');
            """
        )
        drawing_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(chart_drawings)").fetchall()
        }
        expected_columns = {
            "id", "video_id", "symbol", "interval", "tool_type",
            "tool_json", "created_at", "updated_at",
        }
        if drawing_columns != expected_columns:
            raise RuntimeError(
                "chart_drawings 表结构与当前版本不兼容。为避免丢失画图数据，"
                "服务不会自动删表；请先备份数据库并执行显式迁移。"
            )
        connection.execute(
            "UPDATE chart_drawings SET video_id = ? WHERE video_id <> ?",
            (GLOBAL_DRAWING_SCOPE, GLOBAL_DRAWING_SCOPE),
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_chart_drawings_scope ON chart_drawings (symbol)"
        )


def get_offline_mode():
    with DATABASE_LOCK, database() as connection:
        row = connection.execute("SELECT value FROM app_settings WHERE key = 'offline_mode'").fetchone()
    return row is None or str(row["value"]).lower() not in {"0", "false", "off"}


def set_offline_mode(value):
    if not isinstance(value, bool):
        raise ValueError("仅本地模式必须是布尔值")
    with DATABASE_LOCK, database() as connection:
        connection.execute(
            "INSERT INTO app_settings (key, value) VALUES ('offline_mode', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            ("true" if value else "false",),
        )
    return value


def validate_market_scope(symbol, interval):
    if not isinstance(symbol, str) or not re.match(r"^[A-Z0-9]{3,15}USDT$", symbol):
        raise ValueError("合约标的格式无效，必须为 USDT 永续合约（如 SOLUSDT）")
    if symbol not in VALID_SYMBOLS:
        with DATABASE_LOCK, database() as connection:
            custom_symbol = connection.execute(
                "SELECT 1 FROM custom_symbols WHERE symbol = ?",
                (symbol,),
            ).fetchone()
        if not custom_symbol:
            raise ValueError("该合约尚未添加，请先通过自定义合约入口校验")
    if interval not in VALID_INTERVALS:
        raise ValueError("不支持该 K 线周期")


def missing_cached_ranges(symbol, interval, start_timestamp, end_timestamp):
    with DATABASE_LOCK, database() as connection:
        rows = connection.execute(
            """SELECT start_timestamp, end_timestamp FROM market_cache_ranges
               WHERE symbol = ? AND interval = ?
                 AND end_timestamp >= ? AND start_timestamp <= ?
               ORDER BY start_timestamp ASC""",
            (symbol, interval, start_timestamp, end_timestamp),
        ).fetchall()

    missing = []
    cursor = start_timestamp
    for row in rows:
        range_start = max(start_timestamp, int(row["start_timestamp"]))
        range_end = min(end_timestamp, int(row["end_timestamp"]))
        if range_end < cursor:
            continue
        if range_start > cursor:
            missing.append((cursor, range_start - 1))
        cursor = max(cursor, range_end + 1)
        if cursor > end_timestamp:
            break
    if cursor <= end_timestamp:
        missing.append((cursor, end_timestamp))
    return missing


def cached_range_contains(symbol, interval, start_timestamp, end_timestamp):
    return not missing_cached_ranges(
        symbol,
        interval,
        start_timestamp,
        end_timestamp,
    )


def fetch_market_candles(symbol, interval, start_timestamp, end_timestamp):
    interval_milliseconds = INTERVAL_MILLISECONDS.get(interval)
    if interval_milliseconds is None:
        raise ValueError("不支持该 K 线周期")
    return MARKET_DATA_PROVIDER.fetch_candles(
        symbol,
        interval,
        interval_milliseconds,
        start_timestamp,
        end_timestamp,
    )


def market_range_chunks(interval, start_timestamp, end_timestamp, limit=1000):
    interval_milliseconds = INTERVAL_MILLISECONDS[interval]
    cursor = start_timestamp
    chunk_span = interval_milliseconds * limit
    while cursor <= end_timestamp:
        chunk_end = min(end_timestamp, cursor + chunk_span - 1)
        yield cursor, chunk_end
        cursor = chunk_end + 1


def save_candles(symbol, interval, start_timestamp, end_timestamp, candles):
    fetched_at = datetime.now().astimezone().isoformat()
    with DATABASE_LOCK, database() as connection:
        connection.executemany(
            """INSERT INTO market_candles
               (symbol, interval, timestamp, open, high, low, close, volume)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(symbol, interval, timestamp) DO UPDATE SET
                 open = excluded.open, high = excluded.high, low = excluded.low,
                 close = excluded.close, volume = excluded.volume""",
            candles,
        )
        merged_start = start_timestamp
        merged_end = end_timestamp
        while True:
            overlapping_ranges = connection.execute(
                """SELECT start_timestamp, end_timestamp
                   FROM market_cache_ranges
                   WHERE symbol = ? AND interval = ?
                     AND end_timestamp >= ? AND start_timestamp <= ?""",
                (
                    symbol,
                    interval,
                    merged_start - 1,
                    merged_end + 1,
                ),
            ).fetchall()
            expanded_start = min(
                [merged_start]
                + [int(row["start_timestamp"]) for row in overlapping_ranges]
            )
            expanded_end = max(
                [merged_end]
                + [int(row["end_timestamp"]) for row in overlapping_ranges]
            )
            if expanded_start == merged_start and expanded_end == merged_end:
                break
            merged_start = expanded_start
            merged_end = expanded_end
        connection.execute(
            """DELETE FROM market_cache_ranges
               WHERE symbol = ? AND interval = ?
                 AND end_timestamp >= ? AND start_timestamp <= ?""",
            (
                symbol,
                interval,
                merged_start - 1,
                merged_end + 1,
            ),
        )
        connection.execute(
            """INSERT INTO market_cache_ranges
               (symbol, interval, start_timestamp, end_timestamp, fetched_at)
               VALUES (?, ?, ?, ?, ?)""",
            (symbol, interval, merged_start, merged_end, fetched_at),
        )


def list_candles(symbol, interval, start_timestamp, end_timestamp):
    with DATABASE_LOCK, database() as connection:
        rows = connection.execute(
            """SELECT timestamp, open, high, low, close, volume
               FROM market_candles
               WHERE symbol = ? AND interval = ? AND timestamp BETWEEN ? AND ?
               ORDER BY timestamp ASC""",
            (symbol, interval, start_timestamp, end_timestamp),
        ).fetchall()
    return [dict(row) for row in rows]


def market_fetch_lock(symbol, interval):
    key = (symbol, interval)
    with MARKET_FETCH_LOCKS_GUARD:
        return MARKET_FETCH_LOCKS.setdefault(key, threading.Lock())


def warm_up_market_provider():
    try:
        MARKET_DATA_PROVIDER.warm_up()
        print("[market] CCXT Bybit 市场信息预热完成", flush=True)
    except RuntimeError as error:
        print(f"[market] {error}", flush=True)


def schedule_candle_refresh(symbol, interval, start_timestamp, end_timestamp):
    fetch_key = (symbol, interval)
    with MARKET_FETCH_LOCKS_GUARD:
        if fetch_key in MARKET_REFRESHING:
            return
        MARKET_REFRESHING.add(fetch_key)

    def refresh():
        try:
            with market_fetch_lock(symbol, interval):
                if cached_range_contains(symbol, interval, start_timestamp, end_timestamp):
                    return
                failed_at, failed_message = MARKET_FETCH_FAILURES.get(fetch_key, (0, ""))
                if failed_message and time.monotonic() - failed_at < FETCH_FAILURE_COOLDOWN_SECONDS:
                    return
                try:
                    for missing_start, missing_end in missing_cached_ranges(
                        symbol,
                        interval,
                        start_timestamp,
                        end_timestamp,
                    ):
                        for chunk_start, chunk_end in market_range_chunks(
                            interval,
                            missing_start,
                            missing_end,
                        ):
                            fetched = fetch_market_candles(
                                symbol,
                                interval,
                                chunk_start,
                                chunk_end,
                            )
                            save_candles(
                                symbol,
                                interval,
                                chunk_start,
                                chunk_end,
                                fetched,
                            )
                    MARKET_FETCH_FAILURES.pop(fetch_key, None)
                except RuntimeError as error:
                    MARKET_FETCH_FAILURES[fetch_key] = (time.monotonic(), str(error))
        finally:
            with MARKET_FETCH_LOCKS_GUARD:
                MARKET_REFRESHING.discard(fetch_key)

    threading.Thread(
        target=refresh,
        name=f"market-refresh-{symbol}-{interval}",
        daemon=True,
    ).start()


def current_open_candle_timestamp(interval, now_timestamp=None):
    now_timestamp = int(time.time() * 1000) if now_timestamp is None else now_timestamp
    interval_milliseconds = INTERVAL_MILLISECONDS[interval]
    alignment_offset = 4 * 86_400_000 if interval == "W" else 0
    return (
        (now_timestamp - alignment_offset) // interval_milliseconds * interval_milliseconds
        + alignment_offset
    )


def latest_closed_candle_timestamp(interval, now_timestamp=None):
    return current_open_candle_timestamp(interval, now_timestamp) - INTERVAL_MILLISECONDS[interval]


def trailing_refresh_bar_count(interval):
    # Incomplete daily/weekly bars are often cached once and then never updated,
    # which creates fake open/close price gaps. Always refresh a short trailing window.
    if interval == "W":
        return 4
    if interval == "D":
        return 14
    if interval in {"240", "60"}:
        return 8
    return 5


def live_trailing_window(interval, now_timestamp=None):
    now_timestamp = int(time.time() * 1000) if now_timestamp is None else now_timestamp
    interval_milliseconds = INTERVAL_MILLISECONDS[interval]
    bar_count = trailing_refresh_bar_count(interval)
    open_ts = current_open_candle_timestamp(interval, now_timestamp)
    refresh_start = open_ts - interval_milliseconds * (bar_count - 1)
    refresh_end = open_ts + interval_milliseconds - 1
    return refresh_start, refresh_end


def request_needs_trailing_refresh(interval, start_timestamp, end_timestamp):
    refresh_start, refresh_end = live_trailing_window(interval)
    return end_timestamp >= refresh_start and start_timestamp <= refresh_end


def refresh_trailing_candles(symbol, interval):
    """Force-upsert recent live candles even when the cache range looks covered."""
    fetch_key = (symbol, interval)
    now_monotonic = time.monotonic()
    last_refresh_at = MARKET_TRAILING_REFRESH_AT.get(fetch_key, 0)
    if now_monotonic - last_refresh_at < TRAILING_REFRESH_COOLDOWN_SECONDS:
        return 0

    refresh_start, refresh_end = live_trailing_window(interval)
    if refresh_end < refresh_start:
        return 0

    with market_fetch_lock(symbol, interval):
        # Re-check cooldown under the lock so concurrent callers share one fetch.
        last_refresh_at = MARKET_TRAILING_REFRESH_AT.get(fetch_key, 0)
        if time.monotonic() - last_refresh_at < TRAILING_REFRESH_COOLDOWN_SECONDS:
            return 0
        failed_at, failed_message = MARKET_FETCH_FAILURES.get(fetch_key, (0, ""))
        if failed_message and time.monotonic() - failed_at < FETCH_FAILURE_COOLDOWN_SECONDS:
            return 0
        try:
            fetched = fetch_market_candles(
                symbol,
                interval,
                refresh_start,
                refresh_end,
            )
            if fetched:
                save_candles(
                    symbol,
                    interval,
                    refresh_start,
                    refresh_end,
                    fetched,
                )
            MARKET_FETCH_FAILURES.pop(fetch_key, None)
            MARKET_TRAILING_REFRESH_AT[fetch_key] = time.monotonic()
            print(
                f"[market] trailing-refresh {symbol} {interval} "
                f"bars={len(fetched)} window={trailing_refresh_bar_count(interval)}",
                flush=True,
            )
            return len(fetched)
        except RuntimeError as error:
            MARKET_FETCH_FAILURES[fetch_key] = (time.monotonic(), str(error))
            return 0


def schedule_trailing_refresh(symbol, interval, start_timestamp, end_timestamp):
    """Refresh live trailing bars in the background so chart requests stay snappy."""
    if not request_needs_trailing_refresh(interval, start_timestamp, end_timestamp):
        return
    fetch_key = (symbol, interval)
    now_monotonic = time.monotonic()
    last_refresh_at = MARKET_TRAILING_REFRESH_AT.get(fetch_key, 0)
    if now_monotonic - last_refresh_at < TRAILING_REFRESH_COOLDOWN_SECONDS:
        return
    with MARKET_FETCH_LOCKS_GUARD:
        if fetch_key in MARKET_TRAILING_REFRESHING:
            return
        MARKET_TRAILING_REFRESHING.add(fetch_key)

    def refresh():
        try:
            refresh_trailing_candles(symbol, interval)
        finally:
            with MARKET_FETCH_LOCKS_GUARD:
                MARKET_TRAILING_REFRESHING.discard(fetch_key)

    threading.Thread(
        target=refresh,
        name=f"market-trailing-{symbol}-{interval}",
        daemon=True,
    ).start()


def load_candle_range(symbol, interval, start_timestamp, end_timestamp, offline=None):
    source = "sqlite"
    warning = ""
    offline = get_offline_mode() if offline is None else offline
    covered = cached_range_contains(symbol, interval, start_timestamp, end_timestamp)
    candles = list_candles(symbol, interval, start_timestamp, end_timestamp)
    if not covered and not offline and candles:
        schedule_candle_refresh(symbol, interval, start_timestamp, end_timestamp)
        schedule_trailing_refresh(symbol, interval, start_timestamp, end_timestamp)
        return candles, source, warning
    if not covered and not offline:
        fetch_key = (symbol, interval)
        with market_fetch_lock(symbol, interval):
            missing_ranges = missing_cached_ranges(
                symbol,
                interval,
                start_timestamp,
                end_timestamp,
            )
            if missing_ranges:
                failed_at, failed_message = MARKET_FETCH_FAILURES.get(fetch_key, (0, ""))
                cooldown_remaining = FETCH_FAILURE_COOLDOWN_SECONDS - (time.monotonic() - failed_at)
                if failed_message and cooldown_remaining > 0:
                    warning = f"{failed_message}（稍后再试，避免重复等待）"
                else:
                    fetch_started = time.perf_counter()
                    fetched_count = 0
                    chunk_count = 0
                    try:
                        for missing_start, missing_end in missing_ranges:
                            for chunk_start, chunk_end in market_range_chunks(
                                interval,
                                missing_start,
                                missing_end,
                            ):
                                fetched = fetch_market_candles(
                                    symbol,
                                    interval,
                                    chunk_start,
                                    chunk_end,
                                )
                                save_candles(
                                    symbol,
                                    interval,
                                    chunk_start,
                                    chunk_end,
                                    fetched,
                                )
                                fetched_count += len(fetched)
                                chunk_count += 1
                        MARKET_FETCH_FAILURES.pop(fetch_key, None)
                        source = "bybit"
                    except RuntimeError as error:
                        warning = str(error)
                        MARKET_FETCH_FAILURES[fetch_key] = (time.monotonic(), warning)
                    finally:
                        elapsed_milliseconds = round(
                            (time.perf_counter() - fetch_started) * 1000,
                            1,
                        )
                        print(
                            f"[market] {symbol} {interval} "
                            f"missing={len(missing_ranges)} chunks={chunk_count} "
                            f"candles={fetched_count} elapsed={elapsed_milliseconds}ms",
                            flush=True,
                        )
            covered = not missing_cached_ranges(
                symbol,
                interval,
                start_timestamp,
                end_timestamp,
            )
    elif covered and not offline:
        schedule_trailing_refresh(symbol, interval, start_timestamp, end_timestamp)
    candles = list_candles(symbol, interval, start_timestamp, end_timestamp)
    if offline and not covered:
        warning = "仅本地模式：该时间范围的缓存不完整"
    if not candles and warning:
        raise RuntimeError(warning)
    return candles, source, warning


def load_chart_candles(symbol, interval, anchor_timestamp):
    validate_market_scope(symbol, interval)
    if anchor_timestamp < 1_500_000_000_000 or anchor_timestamp > int(time.time() * 1000) + 31 * 86_400_000:
        raise ValueError("视频时间无效")
    effective_cutoff = anchor_timestamp
    start_timestamp = anchor_timestamp - INTERVAL_MILLISECONDS[interval] * 500
    loaded_cutoff = effective_cutoff
    candles, source, warning = load_candle_range(symbol, interval, start_timestamp, loaded_cutoff)
    return {
        "candles": candles,
        "anchor": anchor_timestamp,
        "requestedCutoff": effective_cutoff,
        "effectiveCutoff": effective_cutoff,
        "loadedCutoff": loaded_cutoff,
        "hasMoreLater": loaded_cutoff < effective_cutoff,
        "source": source,
        "warning": warning,
    }


def load_bitlang_trade_candles(symbol, interval, entry_timestamp, exit_timestamp):
    if not isinstance(symbol, str) or not re.match(r"^[A-Z0-9]{3,15}USDT$", symbol):
        raise ValueError("交割单交易对无法映射为 Bybit USDT 永续合约")
    if interval not in VALID_INTERVALS:
        raise ValueError("不支持该 K 线周期")
    now_timestamp = int(time.time() * 1000)
    if (
        entry_timestamp < 1_230_768_000_000
        or exit_timestamp < entry_timestamp
        or exit_timestamp > now_timestamp
    ):
        raise ValueError("交割单开平仓时间无效")

    interval_milliseconds = INTERVAL_MILLISECONDS[interval]
    holding_bars = max(
        1,
        math.ceil((exit_timestamp - entry_timestamp) / interval_milliseconds),
    )
    padding_bars = 200 if holding_bars < 400 else 50
    start_timestamp = entry_timestamp - interval_milliseconds * padding_bars
    end_timestamp = min(
        now_timestamp,
        exit_timestamp + interval_milliseconds * padding_bars,
    )
    candles, source, warning = load_candle_range(
        symbol,
        interval,
        start_timestamp,
        end_timestamp,
    )
    return {
        "candles": candles,
        "source": source,
        "warning": warning,
        "entry": entry_timestamp,
        "exit": exit_timestamp,
    }


def load_earlier_candles(symbol, interval, before_timestamp, limit):
    validate_market_scope(symbol, interval)
    if before_timestamp < 1_000_000_000_000 or before_timestamp > int(time.time() * 1000) + 31 * 86_400_000:
        raise ValueError("K 线时间无效")
    if limit < 100 or limit > 1000:
        raise ValueError("单次加载数量必须是 100–1000")
    end_timestamp = before_timestamp - 1
    start_timestamp = before_timestamp - INTERVAL_MILLISECONDS[interval] * limit
    candles, source, warning = load_candle_range(symbol, interval, start_timestamp, end_timestamp)
    return {
        "candles": candles,
        "source": source,
        "warning": warning,
        "hasMore": len(candles) >= limit and not warning,
    }


def load_replay_candles(symbol, interval, cursor_timestamp, limit):
    validate_market_scope(symbol, interval)
    now_timestamp = int(time.time() * 1000)
    if cursor_timestamp < 1_230_768_000_000 or cursor_timestamp > now_timestamp:
        raise ValueError("复盘时间无效")
    if limit < 100 or limit > 1000:
        raise ValueError("单次加载数量必须是 100–1000")
    interval_milliseconds = INTERVAL_MILLISECONDS[interval]
    latest_closed_timestamp = latest_closed_candle_timestamp(interval, now_timestamp)
    start_timestamp = cursor_timestamp - interval_milliseconds * 500
    end_timestamp = min(latest_closed_timestamp, cursor_timestamp + interval_milliseconds * limit)
    candles, source, warning = load_candle_range(symbol, interval, start_timestamp, end_timestamp)
    candles = [
        candle for candle in candles
        if int(candle["timestamp"]) + interval_milliseconds <= now_timestamp
    ]
    return {
        "candles": candles,
        "cursor": cursor_timestamp,
        "effectiveCutoff": end_timestamp,
        "source": source,
        "warning": warning,
        "hasMore": end_timestamp < latest_closed_timestamp,
    }


def load_later_candles(symbol, interval, after_timestamp, limit, cutoff_timestamp=None):
    validate_market_scope(symbol, interval)
    now_timestamp = int(time.time() * 1000)
    if after_timestamp < 1_230_768_000_000 or after_timestamp > now_timestamp:
        raise ValueError("K 线时间无效")
    if limit < 100 or limit > 1000:
        raise ValueError("单次加载数量必须是 100–1000")
    interval_milliseconds = INTERVAL_MILLISECONDS[interval]
    target_end = latest_closed_candle_timestamp(interval, now_timestamp)
    if cutoff_timestamp is not None:
        if cutoff_timestamp < 1_230_768_000_000 or cutoff_timestamp > now_timestamp + 31 * 86_400_000:
            raise ValueError("K 线截止时间无效")
        target_end = min(target_end, cutoff_timestamp)
    start_timestamp = after_timestamp + 1
    end_timestamp = min(target_end, after_timestamp + interval_milliseconds * limit)
    if start_timestamp > end_timestamp:
        return {"candles": [], "source": "sqlite", "warning": "", "hasMore": False}
    candles, source, warning = load_candle_range(symbol, interval, start_timestamp, end_timestamp)
    candles = [
        candle for candle in candles
        if int(candle["timestamp"]) > after_timestamp
        and int(candle["timestamp"]) + interval_milliseconds <= now_timestamp
    ]
    return {
        "candles": candles,
        "source": source,
        "warning": warning,
        "hasMore": end_timestamp < target_end,
    }


def validate_drawing(payload):
    if not isinstance(payload, dict):
        raise ValueError("画图记录必须是对象")
    video_id = str(payload.get("videoId", "")).strip()
    symbol = str(payload.get("symbol", ""))
    interval = str(payload.get("interval", ""))
    drawing_id = str(payload.get("id", "")).strip()
    tool_type = str(payload.get("toolType", ""))
    validate_market_scope(symbol, interval)
    if not video_id or "/" in video_id or len(video_id) > 100:
        raise ValueError("视频 ID 无效")
    if not drawing_id or len(drawing_id) > 100 or drawing_id.startswith(SYSTEM_DRAWING_PREFIX):
        raise ValueError("画图 ID 无效")
    if tool_type not in VALID_DRAWING_TYPES:
        raise ValueError("画图类型无效")
    points = payload.get("points")
    expected = DRAWING_POINT_COUNTS[tool_type]
    valid_point_count = (
        isinstance(points, list)
        and (
            expected[0] <= len(points) <= expected[1]
            if isinstance(expected, tuple)
            else len(points) == expected
        )
    )
    if not valid_point_count:
        raise ValueError("画图控制点数量无效")
    normalized_points = []
    for point in points:
        if not isinstance(point, dict):
            raise ValueError("画图控制点无效")
        try:
            timestamp = float(point.get("timestamp"))
            price = float(point.get("price"))
        except (TypeError, ValueError):
            raise ValueError("画图控制点无效") from None
        if not math.isfinite(timestamp) or not math.isfinite(price) or timestamp <= 0 or price <= 0:
            raise ValueError("画图控制点无效")
        normalized_points.append({"timestamp": timestamp, "price": price})
    options = payload.get("options")
    if not isinstance(options, dict):
        raise ValueError("画图选项无效")
    drawing = {"id": drawing_id, "toolType": tool_type, "points": normalized_points, "options": options}
    try:
        encoded = json.dumps(drawing, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError):
        raise ValueError("画图选项无效") from None
    if len(encoded.encode("utf-8")) > MAX_DRAWING_JSON_BYTES:
        raise ValueError("画图记录过大")
    return video_id, symbol, interval, drawing, encoded


def save_drawing(payload):
    video_id, symbol, interval, drawing, encoded = validate_drawing(payload)
    video_id = GLOBAL_DRAWING_SCOPE
    now = datetime.now().astimezone().isoformat()
    with DATABASE_LOCK, database() as connection:
        existing = connection.execute("SELECT created_at FROM chart_drawings WHERE id = ?", (drawing["id"],)).fetchone()
        created_at = existing["created_at"] if existing else now
        connection.execute(
            """INSERT INTO chart_drawings
               (id, video_id, symbol, interval, tool_type, tool_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 video_id = excluded.video_id, symbol = excluded.symbol,
                 interval = excluded.interval, tool_type = excluded.tool_type,
                 tool_json = excluded.tool_json, updated_at = excluded.updated_at""",
            (
                drawing["id"], video_id, symbol, interval,
                drawing["toolType"], encoded, created_at, now,
            ),
        )
    return {**drawing, "interval": interval}


def replace_drawings(payload):
    if not isinstance(payload, dict):
        raise ValueError("画图批量记录必须是对象")
    video_id = str(payload.get("videoId", "")).strip()
    symbol = str(payload.get("symbol", ""))
    interval = str(payload.get("interval", ""))
    drawings = payload.get("drawings")
    validate_market_scope(symbol, interval)
    if not video_id or "/" in video_id or len(video_id) > 100:
        raise ValueError("视频 ID 无效")
    if not isinstance(drawings, list) or len(drawings) > 500:
        raise ValueError("画图批量记录无效")
    validated = []
    seen_ids = set()
    for drawing in drawings:
        drawing_interval = str(drawing.get("interval", interval))
        drawing_payload = {
            **drawing,
            "videoId": video_id,
            "symbol": symbol,
            "interval": drawing_interval,
        }
        item_video, item_symbol, item_interval, normalized, encoded = validate_drawing(drawing_payload)
        if normalized["id"] in seen_ids:
            raise ValueError("画图 ID 重复")
        seen_ids.add(normalized["id"])
        validated.append((item_video, item_symbol, item_interval, normalized, encoded))

    now = datetime.now().astimezone().isoformat()
    with DATABASE_LOCK, database() as connection:
        created_times = {
            row["id"]: row["created_at"]
            for row in connection.execute(
                "SELECT id, created_at FROM chart_drawings WHERE symbol = ?",
                (symbol,),
            ).fetchall()
        }
        connection.execute(
            "DELETE FROM chart_drawings WHERE symbol = ?",
            (symbol,),
        )
        connection.executemany(
            """INSERT INTO chart_drawings
               (id, video_id, symbol, interval, tool_type, tool_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    drawing["id"], GLOBAL_DRAWING_SCOPE, item_symbol, item_interval,
                    drawing["toolType"], encoded, created_times.get(drawing["id"], now), now,
                )
                for item_video, item_symbol, item_interval, drawing, encoded in validated
            ],
        )
    return [
        {**normalized, "interval": item_interval}
        for _item_video, _item_symbol, item_interval, normalized, _encoded in validated
    ]


def list_drawings(video_id, symbol, interval):
    validate_market_scope(symbol, interval)
    if not video_id or "/" in video_id or len(video_id) > 100:
        raise ValueError("视频 ID 无效")
    with DATABASE_LOCK, database() as connection:
        rows = connection.execute(
            """SELECT interval, tool_json FROM chart_drawings
               WHERE symbol = ?
               ORDER BY created_at ASC""",
            (symbol,),
        ).fetchall()
    return [
        {**json.loads(row["tool_json"]), "interval": row["interval"]}
        for row in rows
    ]



def get_all_symbols():
    preset = [
        {"symbol": "BTCUSDT", "name": "BTCUSDT 永续", "custom": False},
        {"symbol": "ETHUSDT", "name": "ETHUSDT 永续", "custom": False},
        {"symbol": "SOLUSDT", "name": "SOLUSDT 永续", "custom": False},
        {"symbol": "BNBUSDT", "name": "BNBUSDT 永续", "custom": False},
        {"symbol": "DOGEUSDT", "name": "DOGEUSDT 永续", "custom": False},
        {"symbol": "XRPUSDT", "name": "XRPUSDT 永续", "custom": False},
    ]
    with DATABASE_LOCK, database() as connection:
        rows = connection.execute("SELECT symbol, name FROM custom_symbols ORDER BY added_at ASC").fetchall()
    customs = [{"symbol": row["symbol"], "name": row["name"], "custom": True} for row in rows]
    preset_symbols = {item["symbol"] for item in preset}
    for c in customs:
        if c["symbol"] not in preset_symbols:
            preset.append(c)
    return preset


def add_custom_symbol(symbol_str):
    symbol = str(symbol_str or "").strip().upper()
    if not re.match(r"^[A-Z0-9]{3,15}USDT$", symbol):
        raise ValueError("合约代码格式无效，需为 USDT 永续合约")
    now_ts = int(time.time() * 1000)
    start_ts = now_ts - 86_400_000 * 2
    try:
        candles = fetch_market_candles(symbol, "60", start_ts, now_ts)
    except Exception as err:
        raise ValueError(f"校验该合约失败：{err}")
    if not candles:
        raise ValueError("交易所未返回该合约的 K 线，请检查合约代码")

    now = datetime.now().astimezone().isoformat()
    name = f"{symbol} 永续"
    with DATABASE_LOCK, database() as connection:
        connection.execute(
            "INSERT INTO custom_symbols (symbol, name, added_at) VALUES (?, ?, ?) "
            "ON CONFLICT(symbol) DO UPDATE SET name = excluded.name",
            (symbol, name, now),
        )
    return {"symbol": symbol, "name": name}


def get_paper_trades(symbol=None):
    if symbol:
        validate_market_scope(symbol, "60")
    with DATABASE_LOCK, database() as connection:
        if symbol:
            rows = connection.execute(
                "SELECT * FROM paper_trades WHERE symbol = ? ORDER BY created_at DESC",
                (symbol,),
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT * FROM paper_trades ORDER BY created_at DESC"
            ).fetchall()
    return [dict(row) for row in rows]


def save_paper_trade(payload):
    if not isinstance(payload, dict):
        raise ValueError("模拟订单数据格式无效")
    trade_id = str(payload.get("id", "")).strip() or f"trade_{int(time.time()*1000)}"
    video_id = str(payload.get("videoId", "__global__")).strip()
    symbol = str(payload.get("symbol", "")).strip().upper()
    interval = str(payload.get("interval", "60")).strip()
    direction = str(payload.get("direction", "LONG")).strip().upper()
    entry_price = float(payload.get("entryPrice", 0))
    tp_price = float(payload.get("tpPrice", 0))
    sl_price = float(payload.get("slPrice", 0))
    status = str(payload.get("status", "OPEN")).strip().upper()
    now = datetime.now().astimezone().isoformat()
    created_at = str(payload.get("createdAt") or now)
    closed_at = payload.get("closedAt")

    validate_market_scope(symbol, interval)
    if not re.match(r"^[A-Za-z0-9_-]{1,100}$", trade_id):
        raise ValueError("模拟订单 ID 无效")
    if not video_id or "/" in video_id or len(video_id) > 100:
        raise ValueError("视频 ID 无效")
    if direction not in {"LONG", "SHORT"}:
        raise ValueError("交易方向必须为 LONG 或 SHORT")
    if status not in {"OPEN", "WIN", "LOSS"}:
        raise ValueError("交易状态无效")
    if not all(math.isfinite(value) and value > 0 for value in (entry_price, tp_price, sl_price)):
        raise ValueError("开仓价、止盈价和止损价必须大于 0")
    if direction == "LONG" and not (tp_price > entry_price > sl_price):
        raise ValueError("做多订单必须满足：止盈价 > 开仓价 > 止损价")
    if direction == "SHORT" and not (tp_price < entry_price < sl_price):
        raise ValueError("做空订单必须满足：止盈价 < 开仓价 < 止损价")
    rr_ratio = round(abs(tp_price - entry_price) / abs(entry_price - sl_price), 2)
    if not math.isfinite(rr_ratio) or rr_ratio <= 0 or rr_ratio > 100:
        raise ValueError("盈亏比必须在 0–100 之间")
    pnl_r = 0 if status == "OPEN" else rr_ratio if status == "WIN" else -1.0
    try:
        datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        if closed_at:
            closed_at = str(closed_at)
            datetime.fromisoformat(closed_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("模拟订单时间格式无效") from error
    if status == "OPEN":
        closed_at = None
    elif not closed_at:
        closed_at = now

    with DATABASE_LOCK, database() as connection:
        connection.execute(
            """INSERT INTO paper_trades
               (id, video_id, symbol, interval, direction, entry_price, tp_price, sl_price, rr_ratio, status, pnl_r, created_at, closed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 status = excluded.status, pnl_r = excluded.pnl_r, closed_at = excluded.closed_at""",
            (trade_id, video_id, symbol, interval, direction, entry_price, tp_price, sl_price, rr_ratio, status, pnl_r, created_at, closed_at),
        )
    return {
        "id": trade_id, "videoId": video_id, "symbol": symbol, "interval": interval,
        "direction": direction, "entryPrice": entry_price, "tpPrice": tp_price,
        "slPrice": sl_price, "rrRatio": rr_ratio, "status": status, "pnlR": pnl_r,
        "createdAt": created_at, "closedAt": closed_at,
    }


def delete_paper_trades(trade_id=None):
    if not trade_id:
        raise ValueError("删除模拟订单时必须提供订单 ID")
    if trade_id and not re.match(r"^[A-Za-z0-9_-]{1,100}$", trade_id):
        raise ValueError("模拟订单 ID 无效")
    with DATABASE_LOCK, database() as connection:
        connection.execute("DELETE FROM paper_trades WHERE id = ?", (trade_id,))
    return True

def delete_drawings(query):
    drawing_id = query.get("id", [""])[0]
    video_id = query.get("videoId", [""])[0]
    symbol = query.get("symbol", [""])[0]
    interval = query.get("interval", [""])[0]
    validate_market_scope(symbol, interval)
    if not video_id or "/" in video_id or len(video_id) > 100:
        raise ValueError("缺少视频 ID")
    with DATABASE_LOCK, database() as connection:
        if drawing_id:
            connection.execute(
                "DELETE FROM chart_drawings WHERE id = ? AND symbol = ?",
                (drawing_id, symbol),
            )
            return
        connection.execute(
            "DELETE FROM chart_drawings WHERE symbol = ?",
            (symbol,),
        )


class StudyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == "/":
            self.send_response(HTTPStatus.TEMPORARY_REDIRECT)
            self.send_header("Location", "http://127.0.0.1:3000/")
            self.end_headers()
            return
        if parsed.path == "/api/health":
            return self.send_json(
                HTTPStatus.OK,
                {
                    "service": "tiabtc-learning-workspace",
                    "version": 8,
                    "capabilities": [
                        "learning",
                        "marketReplay",
                        "bitlangTradeReview",
                        "oneMinuteCandles",
                        "resilientBybitFetch",
                        "ccxtBybitMarketData",
                        "gapAwareMarketCache",
                        "apiOnlyBackend",
                        "warmCcxtMarkets",
                    ],
                },
            )
        if parsed.path == "/api/symbols":
            self.send_json(HTTPStatus.OK, {"symbols": get_all_symbols()})
            return

        if parsed.path == "/api/paper-trades":
            try:
                symbol = query.get("symbol", [""])[0]
                return self.send_json(HTTPStatus.OK, {"trades": get_paper_trades(symbol)})
            except ValueError as error:
                return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        if parsed.path == "/api/state":
            return self.send_json(HTTPStatus.OK, load_state())
        if parsed.path == "/api/chart/config":
            return self.send_json(
                HTTPStatus.OK,
                {"offlineMode": get_offline_mode()},
            )
        if parsed.path == "/api/bitlang/candles":
            try:
                symbol = query.get("symbol", [""])[0]
                interval = query.get("interval", [""])[0]
                entry = int(query.get("entry", ["0"])[0])
                exit_timestamp = int(query.get("exit", ["0"])[0])
                return self.send_json(
                    HTTPStatus.OK,
                    load_bitlang_trade_candles(
                        symbol,
                        interval,
                        entry,
                        exit_timestamp,
                    ),
                )
            except ValueError as error:
                return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except RuntimeError as error:
                return self.send_json(HTTPStatus.BAD_GATEWAY, {"error": str(error)})
        if parsed.path == "/api/chart/candles":
            try:
                query = parse_qs(parsed.query)
                symbol = query.get("symbol", [""])[0]
                interval = query.get("interval", [""])[0]
                before = query.get("before", [""])[0]
                after = query.get("after", [""])[0]
                replay_cursor = query.get("replayCursor", [""])[0]
                if before:
                    limit = int(query.get("limit", ["1000"])[0])
                    return self.send_json(
                        HTTPStatus.OK,
                        load_earlier_candles(symbol, interval, int(before), limit),
                    )
                if after:
                    limit = int(query.get("limit", ["1000"])[0])
                    cutoff = query.get("cutoff", [""])[0]
                    return self.send_json(
                        HTTPStatus.OK,
                        load_later_candles(
                            symbol,
                            interval,
                            int(after),
                            limit,
                            int(cutoff) if cutoff else None,
                        ),
                    )
                if replay_cursor:
                    limit = int(query.get("limit", ["1000"])[0])
                    return self.send_json(
                        HTTPStatus.OK,
                        load_replay_candles(symbol, interval, int(replay_cursor), limit),
                    )
                anchor = int(query.get("anchor", ["0"])[0])
                return self.send_json(HTTPStatus.OK, load_chart_candles(symbol, interval, anchor))
            except (ValueError, RuntimeError) as error:
                return self.send_json(HTTPStatus.BAD_GATEWAY, {"error": str(error)})
        if parsed.path == "/api/chart/drawings":
            try:
                query = parse_qs(parsed.query)
                drawings = list_drawings(
                    query.get("videoId", [""])[0],
                    query.get("symbol", [""])[0],
                    query.get("interval", [""])[0],
                )
                return self.send_json(HTTPStatus.OK, {"drawings": drawings})
            except ValueError as error:
                return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        return self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            payload = self.read_json_body()
            if parsed.path == "/api/symbols":
                return self.send_json(HTTPStatus.CREATED, add_custom_symbol(payload.get("symbol")))
            if parsed.path == "/api/paper-trades":
                return self.send_json(HTTPStatus.OK, save_paper_trade(payload))
            if parsed.path == "/api/chart/drawings":
                return self.send_json(HTTPStatus.OK, save_drawing(payload))
        except (ValueError, TypeError, OverflowError, AttributeError, json.JSONDecodeError) as error:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        return self.send_error(HTTPStatus.NOT_FOUND)

    def do_PUT(self):
        path = urlparse(self.path).path
        if path == "/api/chart/drawings":
            try:
                payload = self.read_json_body()
                return self.send_json(HTTPStatus.OK, {"drawings": replace_drawings(payload)})
            except (ValueError, json.JSONDecodeError, AttributeError) as error:
                return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        if path == "/api/chart/config":
            try:
                payload = self.read_json_body()
                if "offlineMode" in payload:
                    set_offline_mode(payload["offlineMode"])
                if "offlineMode" not in payload:
                    raise ValueError("没有可保存的图表配置")
                return self.send_json(
                    HTTPStatus.OK,
                    {"offlineMode": get_offline_mode()},
                )
            except (ValueError, json.JSONDecodeError, AttributeError) as error:
                return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        if not path.startswith("/api/state/"):
            return self.send_error(HTTPStatus.NOT_FOUND)
        video_id = unquote(path.removeprefix("/api/state/"))
        if not video_id or "/" in video_id:
            return self.send_error(HTTPStatus.BAD_REQUEST, "无效的视频 ID")
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8")) if length else None
            if payload is not None:
                payload = self.validate_record(payload)
            state = load_state()
            if payload is None:
                state["records"].pop(video_id, None)
            else:
                state["records"][video_id] = payload
            write_state(state)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        return self.send_json(HTTPStatus.OK, {"ok": True})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        try:
            query = parse_qs(parsed.query)
            if parsed.path == "/api/paper-trades":
                delete_paper_trades(query.get("id", [None])[0])
                return self.send_json(HTTPStatus.OK, {"ok": True})
            if parsed.path != "/api/chart/drawings":
                return self.send_error(HTTPStatus.NOT_FOUND)
            delete_drawings(query)
            return self.send_json(HTTPStatus.OK, {"ok": True})
        except ValueError as error:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length).decode("utf-8")) if length else {}

    def validate_record(self, value):
        if not isinstance(value, dict):
            raise ValueError("记录必须是对象")
        status = value.get("status", "unlearned")
        note = value.get("note", "")
        if status not in VALID_STATUSES or not isinstance(note, str) or len(note) > 20000:
            raise ValueError("学习记录格式无效")
        return {"bookmarked": bool(value.get("bookmarked")), "status": status, "note": note}

    def send_json(self, status, payload):
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, format, *args):
        print(f"{self.client_address[0]} - {format % args}")


if __name__ == "__main__":
    initialize_database()
    if not get_offline_mode():
        threading.Thread(
            target=warm_up_market_provider,
            name="ccxt-market-warmup",
            daemon=True,
        ).start()
    print(f"学习页已启动：http://{HOST}:{PORT}/")
    print("按 Ctrl+C 停止服务。")
    ThreadingHTTPServer((HOST, PORT), StudyHandler).serve_forever()
