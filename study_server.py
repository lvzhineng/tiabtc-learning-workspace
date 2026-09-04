import gzip
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

from cryptography.fernet import Fernet, InvalidToken

from bitget_position_provider import (
    BITGET_CANDLE_MAX_RANGE_MS,
    BitgetUtaPositionProvider,
    classify_fill_role,
)
from gate_position_provider import GateUsdtPositionProvider
from market_data_provider import CcxtBybitMarketDataProvider
import video_catalog
import workspace_config


ROOT = Path(__file__).resolve().parent
STATE_FILE = ROOT / "learning-state.json"
DEFAULT_DATABASE_FILE = ROOT / "tiabtc-review.sqlite"
DATABASE_FILE = DEFAULT_DATABASE_FILE
SEED_DATABASE_FILE = ROOT / "data" / "tiabtc-review-seed.sqlite"
HOST = "127.0.0.1"
PORT = 8765
API_VERSION = 12
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
MAX_INTERNAL_HOLE_BARS = 4
CANDLE_DISCONTINUITY_RATIO = 0.0005
RANGE_REPAIR_COOLDOWN_SECONDS = 600
DATABASE_LOCK = threading.RLock()
STATE_LOCK = threading.RLock()
CREDENTIAL_LOCK = threading.Lock()
POSITION_SYNC_LOCK = threading.Lock()
VIDEO_REFRESH_LOCK = threading.Lock()
MARKET_FETCH_LOCKS_GUARD = threading.Lock()
MARKET_FETCH_LOCKS = {}
MARKET_FETCH_FAILURES = {}
MARKET_TRAILING_REFRESH_AT = {}
MARKET_TRAILING_REFRESH_BOUNDARY = {}
MARKET_TRAILING_REFRESHING = set()
MARKET_RANGE_REPAIR_AT = {}
MARKET_DATA_PROVIDER = CcxtBybitMarketDataProvider()
FLOW_WARMUP_SYMBOL = "BTCUSDT"
FLOW_OI_HISTORY_START_MS = 1_577_836_800_000  # 2020-01-01 UTC
OI_15M_MS = 15 * 60 * 1000
FLOW_WARMUP_LOCK = threading.Lock()
FLOW_WARMUP_STATE = {"warming": False}
MARKET_REFRESHING = set()
RUN_DIR = ROOT / ".run"
CREDENTIAL_KEY_FILE = RUN_DIR / "credential-key"
POSITION_REVIEW_VENUE = "bitget"
POSITION_REVIEW_VENUES = ("bitget", "gate")
POSITION_REVIEW_BYBIT_CANDLE_SYMBOLS = frozenset({"BTCUSDT", "ETHUSDT"})
FILL_MATCH_PAD_MS = 2000
TAG_COLORS = ("#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6")
BITLANG_TRADE_ID_RE = re.compile(r"^[0-9a-f]{64}$")
MAX_CANDLES_PER_RESPONSE = 3000
CACHE_AUDIT_MAX_RANGES = 1000
CACHE_AUDIT_MAX_CANDLES_PER_RANGE = 20000


class SyncInProgressError(RuntimeError):
    """Rejected a concurrent long-running mutation such as position sync."""


VENUE_MARKET_FETCH_LOCKS = {}
VENUE_MARKET_FETCH_FAILURES = {}
VENUE_POSITION_PROVIDERS = {}
VENUE_POSITION_PROVIDERS_LOCK = threading.Lock()


def _load_state_unlocked():
    if not STATE_FILE.exists():
        return {"records": {}}
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        records = data.get("records", {})
        return {"records": records if isinstance(records, dict) else {}}
    except (OSError, json.JSONDecodeError):
        return {"records": {}}


def load_state():
    with STATE_LOCK:
        return _load_state_unlocked()


def _write_state_unlocked(state):
    temporary_file = STATE_FILE.with_suffix(".json.tmp")
    temporary_file.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary_file, STATE_FILE)


def write_state(state):
    with STATE_LOCK:
        _write_state_unlocked(state)


def validate_learning_record(value):
    if not isinstance(value, dict):
        raise ValueError("记录必须是对象")
    status = value.get("status", "unlearned")
    note = value.get("note", "")
    updated_at = value.get("updatedAt") or datetime.now().astimezone().isoformat()
    if status not in VALID_STATUSES or not isinstance(note, str) or len(note) > 20000:
        raise ValueError("学习记录格式无效")
    if not isinstance(updated_at, str):
        raise ValueError("学习记录更新时间格式无效")
    try:
        parsed_updated_at = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("学习记录更新时间格式无效") from error
    if parsed_updated_at.utcoffset() is None:
        raise ValueError("学习记录更新时间必须包含时区")
    return {
        "bookmarked": bool(value.get("bookmarked")),
        "status": status,
        "note": note,
        "updatedAt": updated_at,
    }


def update_learning_state(video_id, value):
    if not video_id or "/" in video_id or len(video_id) > 100:
        raise ValueError("无效的视频 ID")
    record = None if value is None else validate_learning_record(value)
    # ThreadingHTTPServer can process updates for different videos at the same
    # time. Keep the read-modify-replace sequence atomic so one request cannot
    # overwrite another request's freshly saved record.
    with STATE_LOCK:
        state = _load_state_unlocked()
        if record is None:
            state["records"].pop(video_id, None)
        else:
            state["records"][video_id] = record
        _write_state_unlocked(state)


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
            CREATE TABLE IF NOT EXISTS exchange_positions (
                venue TEXT NOT NULL,
                position_id TEXT NOT NULL,
                unified_symbol TEXT NOT NULL,
                chart_symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                status TEXT NOT NULL,
                entry_price REAL,
                exit_price REAL,
                contracts REAL,
                leverage REAL,
                margin_mode TEXT,
                hedged INTEGER NOT NULL DEFAULT 0,
                realized_pnl REAL,
                net_pnl REAL,
                funding REAL,
                open_fee REAL,
                close_fee REAL,
                entry_time_ms INTEGER NOT NULL,
                exit_time_ms INTEGER,
                synced_at TEXT NOT NULL,
                PRIMARY KEY (venue, position_id)
            );
            CREATE TABLE IF NOT EXISTS position_notes (
                venue TEXT NOT NULL,
                position_id TEXT NOT NULL,
                note TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (venue, position_id)
            );
            CREATE TABLE IF NOT EXISTS position_drawings (
                venue TEXT NOT NULL,
                position_id TEXT NOT NULL,
                id TEXT NOT NULL,
                symbol TEXT NOT NULL,
                interval TEXT NOT NULL,
                tool_type TEXT NOT NULL,
                tool_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (venue, position_id, id)
            );
            CREATE INDEX IF NOT EXISTS idx_position_drawings_scope
                ON position_drawings (venue, position_id, created_at);
            CREATE TABLE IF NOT EXISTS position_tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS position_tag_map (
                venue TEXT NOT NULL,
                position_id TEXT NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (venue, position_id, tag_id),
                FOREIGN KEY (tag_id) REFERENCES position_tags(id)
            );
            CREATE TABLE IF NOT EXISTS position_fills (
                venue TEXT NOT NULL,
                exec_id TEXT NOT NULL,
                order_id TEXT,
                chart_symbol TEXT NOT NULL,
                unified_symbol TEXT,
                side TEXT NOT NULL,
                trade_side TEXT,
                price REAL,
                quantity REAL,
                pnl REAL,
                fee REAL,
                time_ms INTEGER NOT NULL,
                synced_at TEXT NOT NULL,
                PRIMARY KEY (venue, exec_id)
            );
            CREATE INDEX IF NOT EXISTS idx_position_fills_symbol_time
                ON position_fills (venue, chart_symbol, time_ms);
            CREATE TABLE IF NOT EXISTS venue_market_candles (
                venue TEXT NOT NULL,
                symbol TEXT NOT NULL,
                interval TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                open REAL NOT NULL,
                high REAL NOT NULL,
                low REAL NOT NULL,
                close REAL NOT NULL,
                volume REAL NOT NULL,
                PRIMARY KEY (venue, symbol, interval, timestamp)
            );
            CREATE TABLE IF NOT EXISTS venue_market_cache_ranges (
                venue TEXT NOT NULL,
                symbol TEXT NOT NULL,
                interval TEXT NOT NULL,
                start_timestamp INTEGER NOT NULL,
                end_timestamp INTEGER NOT NULL,
                fetched_at TEXT NOT NULL,
                PRIMARY KEY (venue, symbol, interval, start_timestamp, end_timestamp)
            );
            CREATE TABLE IF NOT EXISTS market_oi_1h (
                symbol TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                open_interest REAL NOT NULL,
                PRIMARY KEY (symbol, timestamp)
            );
            CREATE TABLE IF NOT EXISTS market_oi_1h_cache_ranges (
                symbol TEXT NOT NULL,
                start_timestamp INTEGER NOT NULL,
                end_timestamp INTEGER NOT NULL,
                fetched_at TEXT NOT NULL,
                PRIMARY KEY (symbol, start_timestamp, end_timestamp)
            );
            CREATE TABLE IF NOT EXISTS market_oi_15m (
                symbol TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                open_interest REAL NOT NULL,
                PRIMARY KEY (symbol, timestamp)
            );
            CREATE TABLE IF NOT EXISTS market_oi_15m_cache_ranges (
                symbol TEXT NOT NULL,
                start_timestamp INTEGER NOT NULL,
                end_timestamp INTEGER NOT NULL,
                fetched_at TEXT NOT NULL,
                PRIMARY KEY (symbol, start_timestamp, end_timestamp)
            );
            CREATE TABLE IF NOT EXISTS market_oi_5m (
                symbol TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                open_interest REAL NOT NULL,
                PRIMARY KEY (symbol, timestamp)
            );
            CREATE TABLE IF NOT EXISTS market_oi_cache_ranges (
                symbol TEXT NOT NULL,
                start_timestamp INTEGER NOT NULL,
                end_timestamp INTEGER NOT NULL,
                fetched_at TEXT NOT NULL,
                PRIMARY KEY (symbol, start_timestamp, end_timestamp)
            );
            CREATE TABLE IF NOT EXISTS market_cvd_5m (
                symbol TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                buy_volume REAL NOT NULL,
                sell_volume REAL NOT NULL,
                delta REAL NOT NULL,
                PRIMARY KEY (symbol, timestamp)
            );
            CREATE TABLE IF NOT EXISTS market_cvd_days (
                symbol TEXT NOT NULL,
                day_utc TEXT NOT NULL,
                status TEXT NOT NULL,
                fetched_at TEXT NOT NULL,
                PRIMARY KEY (symbol, day_utc)
            );
            CREATE TABLE IF NOT EXISTS bitlang_trade_notes (
                trade_id TEXT NOT NULL PRIMARY KEY,
                note TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS bitlang_trade_tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS bitlang_trade_tag_map (
                trade_id TEXT NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (trade_id, tag_id),
                FOREIGN KEY (tag_id) REFERENCES bitlang_trade_tags(id)
            );
            CREATE TABLE IF NOT EXISTS bitlang_trade_drawings (
                trade_id TEXT NOT NULL,
                id TEXT NOT NULL,
                symbol TEXT NOT NULL,
                interval TEXT NOT NULL,
                tool_type TEXT NOT NULL,
                tool_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (trade_id, id)
            );
            CREATE INDEX IF NOT EXISTS idx_bitlang_trade_drawings_scope
                ON bitlang_trade_drawings (trade_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_exchange_positions_entry
                ON exchange_positions (entry_time_ms DESC);
            """
        )
        fill_columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(position_fills)").fetchall()
        }
        if "order_id" not in fill_columns:
            connection.execute("ALTER TABLE position_fills ADD COLUMN order_id TEXT")
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


def candle_row_timestamp(candle):
    if isinstance(candle, dict):
        return int(candle["timestamp"])
    return int(candle[2])


def merge_touching_ranges(ranges):
    if not ranges:
        return []
    ordered = sorted((int(start), int(end)) for start, end in ranges)
    merged = [list(ordered[0])]
    for start, end in ordered[1:]:
        if start <= merged[-1][1] + 1:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(start, end) for start, end in merged]


def market_cache_coverage_ranges(interval, start_timestamp, end_timestamp, candles):
    """Mark only closed, contiguous bars as cached.

    The current open bar is stored for display but must stay uncached so the
    next close can overwrite a partial snapshot. Internal holes stay uncached
    so a later request can fill them instead of treating empty space as data.
    """
    interval_ms = INTERVAL_MILLISECONDS[interval]
    last_closed = latest_closed_candle_timestamp(interval)
    start_timestamp = int(start_timestamp)
    coverage_end = min(int(end_timestamp), last_closed + interval_ms - 1)
    if coverage_end < start_timestamp:
        return []

    closed_timestamps = sorted(
        {
            timestamp
            for timestamp in (candle_row_timestamp(candle) for candle in candles)
            if start_timestamp <= timestamp <= last_closed
        }
    )
    if not closed_timestamps:
        return [(start_timestamp, coverage_end)]

    segments = []
    run_start = run_end = closed_timestamps[0]
    for timestamp in closed_timestamps[1:]:
        if timestamp == run_end + interval_ms:
            run_end = timestamp
        else:
            segments.append((run_start, run_end + interval_ms - 1))
            run_start = run_end = timestamp
    segments.append((run_start, run_end + interval_ms - 1))

    first_ts = closed_timestamps[0]
    prefix_ms = first_ts - start_timestamp
    if prefix_ms > MAX_INTERNAL_HOLE_BARS * interval_ms:
        segments.append((start_timestamp, first_ts - 1))
    return merge_touching_ranges(segments)


def closed_range_defects(interval, start_timestamp, end_timestamp, candles):
    """Find small cache holes and frozen partial bars inside a closed window."""
    interval_ms = INTERVAL_MILLISECONDS[interval]
    last_closed = latest_closed_candle_timestamp(interval)
    lo = int(start_timestamp)
    hi = min(int(end_timestamp), last_closed)
    closed = [
        candle
        for candle in candles
        if lo <= int(candle["timestamp"]) <= hi
    ]
    if len(closed) < 2:
        return []
    defects = []
    for previous, current in zip(closed, closed[1:]):
        prev_ts = int(previous["timestamp"])
        curr_ts = int(current["timestamp"])
        delta = curr_ts - prev_ts
        if delta <= 0:
            continue
        gap_bars = delta // interval_ms - 1
        if 1 <= gap_bars <= MAX_INTERNAL_HOLE_BARS:
            defects.append((prev_ts + interval_ms, curr_ts - 1))
            continue
        if gap_bars != 0:
            continue
        prev_close = float(previous["close"])
        curr_open = float(current["open"])
        if prev_close <= 0:
            continue
        if abs(curr_open - prev_close) / prev_close < CANDLE_DISCONTINUITY_RATIO:
            continue
        defects.append((prev_ts, curr_ts + interval_ms - 1))
    return merge_touching_ranges(defects)


def unrepaired_ranges(symbol, interval, ranges):
    now_monotonic = time.monotonic()
    pending = []
    for start, end in ranges:
        key = (symbol, interval, int(start), int(end))
        last_at = MARKET_RANGE_REPAIR_AT.get(key, 0)
        if now_monotonic - last_at < RANGE_REPAIR_COOLDOWN_SECONDS:
            continue
        pending.append((int(start), int(end)))
    return pending


def remember_repaired_ranges(symbol, interval, ranges):
    now_monotonic = time.monotonic()
    for start, end in ranges:
        MARKET_RANGE_REPAIR_AT[(symbol, interval, int(start), int(end))] = now_monotonic


def historical_missing_cached_ranges(symbol, interval, start_timestamp, end_timestamp):
    interval_ms = INTERVAL_MILLISECONDS[interval]
    last_closed = latest_closed_candle_timestamp(interval)
    hist_end = min(int(end_timestamp), last_closed + interval_ms - 1)
    if int(start_timestamp) > hist_end:
        return []
    return missing_cached_ranges(symbol, interval, start_timestamp, hist_end)


def fetch_and_save_candle_ranges(symbol, interval, ranges):
    fetched_count = 0
    chunk_count = 0
    for missing_start, missing_end in ranges:
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
    return fetched_count, chunk_count


def merge_market_cache_range(
    connection, symbol, interval, start_timestamp, end_timestamp, fetched_at
):
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


def save_candles(symbol, interval, start_timestamp, end_timestamp, candles):
    fetched_at = datetime.now().astimezone().isoformat()
    coverage_ranges = market_cache_coverage_ranges(
        interval,
        start_timestamp,
        end_timestamp,
        candles,
    )
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
        for range_start, range_end in coverage_ranges:
            merge_market_cache_range(
                connection,
                symbol,
                interval,
                range_start,
                range_end,
                fetched_at,
            )


def list_candles(symbol, interval, start_timestamp, end_timestamp):
    with database() as connection:
        rows = connection.execute(
            """SELECT timestamp, open, high, low, close, volume
               FROM market_candles
               WHERE symbol = ? AND interval = ? AND timestamp BETWEEN ? AND ?
               ORDER BY timestamp ASC""",
            (symbol, interval, start_timestamp, end_timestamp),
        ).fetchall()
    return [
        {
            "timestamp": row[0],
            "open": row[1],
            "high": row[2],
            "low": row[3],
            "close": row[4],
            "volume": row[5],
        }
        for row in rows
    ]


def missing_oi_cached_ranges(symbol, start_timestamp, end_timestamp):
    with DATABASE_LOCK, database() as connection:
        rows = connection.execute(
            """SELECT start_timestamp, end_timestamp FROM market_oi_15m_cache_ranges
               WHERE symbol = ?
                 AND end_timestamp >= ? AND start_timestamp <= ?
               ORDER BY start_timestamp ASC""",
            (symbol, start_timestamp, end_timestamp),
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


def save_open_interest(symbol, start_timestamp, end_timestamp, rows):
    fetched_at = datetime.now().astimezone().isoformat()
    with DATABASE_LOCK, database() as connection:
        connection.executemany(
            """INSERT INTO market_oi_15m (symbol, timestamp, open_interest)
               VALUES (?, ?, ?)
               ON CONFLICT(symbol, timestamp) DO UPDATE SET
                 open_interest = excluded.open_interest""",
            rows,
        )
        merged_start = start_timestamp
        merged_end = end_timestamp
        while True:
            overlapping_ranges = connection.execute(
                """SELECT start_timestamp, end_timestamp
                   FROM market_oi_15m_cache_ranges
                   WHERE symbol = ?
                     AND end_timestamp >= ? AND start_timestamp <= ?""",
                (symbol, merged_start - 1, merged_end + 1),
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
            """DELETE FROM market_oi_15m_cache_ranges
               WHERE symbol = ?
                 AND end_timestamp >= ? AND start_timestamp <= ?""",
            (symbol, merged_start - 1, merged_end + 1),
        )
        connection.execute(
            """INSERT INTO market_oi_15m_cache_ranges
               (symbol, start_timestamp, end_timestamp, fetched_at)
               VALUES (?, ?, ?, ?)""",
            (symbol, merged_start, merged_end, fetched_at),
        )


def list_open_interest(symbol, start_timestamp, end_timestamp):
    with DATABASE_LOCK, database() as connection:
        rows = connection.execute(
            """SELECT timestamp, open_interest
               FROM market_oi_15m
               WHERE symbol = ? AND timestamp BETWEEN ? AND ?
               ORDER BY timestamp ASC""",
            (symbol, start_timestamp, end_timestamp),
        ).fetchall()
    return {int(row[0]): float(row[1]) for row in rows}


def warmup_open_interest(symbol, start_timestamp, end_timestamp):
    for missing_start, missing_end in missing_oi_cached_ranges(
        symbol,
        start_timestamp,
        end_timestamp,
    ):
        chunks = list(
            market_range_chunks("15", missing_start, missing_end, limit=200)
        )
        saw_data = False
        for chunk_start, chunk_end in reversed(chunks):
            fetched = MARKET_DATA_PROVIDER.fetch_open_interest_15m(
                symbol,
                chunk_start,
                chunk_end,
            )
            save_open_interest(symbol, chunk_start, chunk_end, fetched)
            if fetched:
                saw_data = True
                continue
            older_end = chunk_start - 1
            if older_end >= missing_start:
                save_open_interest(symbol, missing_start, older_end, [])
            break
        else:
            if not saw_data:
                save_open_interest(symbol, missing_start, missing_end, [])


def warmup_flow_candles_15m(symbol, start_timestamp, end_timestamp):
    with market_fetch_lock(symbol, "15"):
        for missing_start, missing_end in missing_cached_ranges(
            symbol,
            "15",
            start_timestamp,
            end_timestamp,
        ):
            for chunk_start, chunk_end in market_range_chunks(
                "15",
                missing_start,
                missing_end,
            ):
                fetched = fetch_market_candles(
                    symbol,
                    "15",
                    chunk_start,
                    chunk_end,
                )
                save_candles(symbol, "15", chunk_start, chunk_end, fetched)


def flow_warmup_state():
    with FLOW_WARMUP_LOCK:
        return dict(FLOW_WARMUP_STATE)


def warm_up_flow_cache():
    with FLOW_WARMUP_LOCK:
        if FLOW_WARMUP_STATE["warming"]:
            return
        FLOW_WARMUP_STATE["warming"] = True
    try:
        symbol = FLOW_WARMUP_SYMBOL
        flow_end = current_open_candle_timestamp("15")
        flow_start = FLOW_OI_HISTORY_START_MS // OI_15M_MS * OI_15M_MS
        print(
            f"[flow] 开始预热 {symbol} 15m OI 与 15m K 线，自 2020-01-01 至当前，已缓存区间会跳过",
            flush=True,
        )
        try:
            warmup_flow_candles_15m(symbol, flow_start, flow_end)
            with DATABASE_LOCK, database() as connection:
                candle_count = connection.execute(
                    """SELECT COUNT(*) FROM market_candles
                       WHERE symbol = ? AND interval = '15'""",
                    (symbol,),
                ).fetchone()[0]
            print(f"[flow] 15m K 线预热完成 {symbol}，共 {candle_count} 行", flush=True)
        except Exception as error:
            print(f"[flow] 15m K 线预热失败 {symbol}：{error}", flush=True)
        try:
            warmup_open_interest(symbol, flow_start, flow_end)
            with DATABASE_LOCK, database() as connection:
                row_count = connection.execute(
                    "SELECT COUNT(*) FROM market_oi_15m WHERE symbol = ?",
                    (symbol,),
                ).fetchone()[0]
            print(f"[flow] 15m OI 预热完成 {symbol}，共 {row_count} 行", flush=True)
        except Exception as error:
            print(f"[flow] 15m OI 预热失败 {symbol}：{error}", flush=True)
    finally:
        with FLOW_WARMUP_LOCK:
            FLOW_WARMUP_STATE["warming"] = False


def candle_signed_cvd(candles):
    points = []
    cumulative = 0.0
    for candle in candles:
        volume = float(candle["volume"])
        delta = volume if candle["close"] >= candle["open"] else -volume
        cumulative += delta
        points.append(
            {
                "timestamp": candle["timestamp"],
                "delta": delta,
                "cvd": cumulative,
            }
        )
    return points


def resample_step_series(interval, start_timestamp, end_timestamp, value_by_ts, source_ms):
    interval_ms = INTERVAL_MILLISECONDS[interval]
    first = current_open_candle_timestamp(interval, start_timestamp)
    last = current_open_candle_timestamp(interval, end_timestamp)
    output = []
    timestamp = first
    while timestamp <= last:
        if interval_ms <= source_ms:
            source_ts = timestamp // source_ms * source_ms
            value = value_by_ts.get(source_ts)
            if value is not None:
                output.append({"timestamp": timestamp, "value": value})
        else:
            bucket_end = timestamp + interval_ms - 1
            last_value = None
            source_ts = timestamp // source_ms * source_ms
            if source_ts < timestamp:
                source_ts += source_ms
            while source_ts <= bucket_end:
                if source_ts in value_by_ts:
                    last_value = value_by_ts[source_ts]
                source_ts += source_ms
            if last_value is not None:
                output.append({"timestamp": timestamp, "value": last_value})
        timestamp += interval_ms
    return output


def resample_cvd_series(interval, start_timestamp, end_timestamp, cvd_points):
    cvd_by_ts = {int(point["timestamp"]): float(point["cvd"]) for point in cvd_points}
    delta_by_ts = {int(point["timestamp"]): float(point["delta"]) for point in cvd_points}
    stepped = resample_step_series(
        interval,
        start_timestamp,
        end_timestamp,
        cvd_by_ts,
        OI_15M_MS,
    )
    interval_ms = INTERVAL_MILLISECONDS[interval]
    output = []
    for point in stepped:
        timestamp = point["timestamp"]
        if interval_ms <= OI_15M_MS:
            source_ts = timestamp // OI_15M_MS * OI_15M_MS
            delta = delta_by_ts.get(source_ts, 0.0) if timestamp == source_ts else 0.0
        else:
            bucket_end = timestamp + interval_ms - 1
            delta = 0.0
            source_ts = timestamp // OI_15M_MS * OI_15M_MS
            if source_ts < timestamp:
                source_ts += OI_15M_MS
            while source_ts <= bucket_end:
                delta += delta_by_ts.get(source_ts, 0.0)
                source_ts += OI_15M_MS
        output.append(
            {
                "timestamp": timestamp,
                "delta": delta,
                "cvd": point["value"],
            }
        )
    return output


def load_chart_flow(symbol, interval, start_timestamp, end_timestamp):
    validate_market_scope(symbol, interval)
    start_timestamp = int(start_timestamp)
    end_timestamp = int(end_timestamp)
    if start_timestamp <= 0 or end_timestamp <= 0 or start_timestamp > end_timestamp:
        raise ValueError("OI/CVD 时间范围无效")
    bar_start = start_timestamp // OI_15M_MS * OI_15M_MS
    bar_end = end_timestamp // OI_15M_MS * OI_15M_MS
    oi_by_ts = list_open_interest(symbol, bar_start, bar_end)
    oi_out = resample_step_series(
        interval,
        start_timestamp,
        end_timestamp,
        oi_by_ts,
        OI_15M_MS,
    )
    cvd_out = resample_cvd_series(
        interval,
        start_timestamp,
        end_timestamp,
        candle_signed_cvd(list_candles(symbol, "15", bar_start, bar_end)),
    )
    warming = bool(flow_warmup_state().get("warming"))
    warning = ""
    if warming and symbol == FLOW_WARMUP_SYMBOL and not oi_out:
        warning = "正在预热 BTCUSDT 15m 持仓量"
    elif symbol != FLOW_WARMUP_SYMBOL:
        warning = "OI 仅预热 BTCUSDT；CVD 来自 15m K 线涨跌成交量近似"
    elif not oi_out:
        warning = "BTCUSDT 暂无 15m OI 缓存；CVD 来自 15m K 线涨跌成交量近似"
    return {
        "interval": interval,
        "oi": oi_out,
        "cvd": cvd_out,
        "warming": warming,
        "warning": warning,
    }


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
    warm_up_venue_market_providers()


def schedule_candle_refresh(symbol, interval, start_timestamp, end_timestamp):
    if not historical_missing_cached_ranges(
        symbol, interval, start_timestamp, end_timestamp
    ):
        return
    fetch_key = (symbol, interval)
    with MARKET_FETCH_LOCKS_GUARD:
        if fetch_key in MARKET_REFRESHING:
            return
        MARKET_REFRESHING.add(fetch_key)

    def refresh():
        try:
            with market_fetch_lock(symbol, interval):
                if not historical_missing_cached_ranges(
                    symbol, interval, start_timestamp, end_timestamp
                ):
                    return
                failed_at, failed_message = MARKET_FETCH_FAILURES.get(fetch_key, (0, ""))
                if failed_message and time.monotonic() - failed_at < FETCH_FAILURE_COOLDOWN_SECONDS:
                    return
                try:
                    for missing_start, missing_end in historical_missing_cached_ranges(
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
                    print(
                        f"[market] background-refresh {symbol} {interval} failed: {error}",
                        flush=True,
                    )
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
    # Any interval can be cached while its newest bar is still open. Refresh a
    # small tail after every newly closed boundary so replay never reuses that
    # partial snapshot as a final candle.
    if interval == "W":
        return 4
    if interval == "D":
        return 14
    if interval == "240":
        return 6
    return 3


def trailing_refresh_is_fresh(
    fetch_key,
    interval,
    now_monotonic=None,
    now_timestamp=None,
):
    now_monotonic = time.monotonic() if now_monotonic is None else now_monotonic
    latest_closed = latest_closed_candle_timestamp(interval, now_timestamp)
    return (
        MARKET_TRAILING_REFRESH_BOUNDARY.get(fetch_key) == latest_closed
        and now_monotonic - MARKET_TRAILING_REFRESH_AT.get(fetch_key, 0)
        < TRAILING_REFRESH_COOLDOWN_SECONDS
    )


def live_trailing_window(interval, now_timestamp=None):
    bar_count = trailing_refresh_bar_count(interval)
    if bar_count <= 0:
        return None
    now_timestamp = int(time.time() * 1000) if now_timestamp is None else now_timestamp
    interval_milliseconds = INTERVAL_MILLISECONDS[interval]
    open_ts = current_open_candle_timestamp(interval, now_timestamp)
    refresh_start = open_ts - interval_milliseconds * (bar_count - 1)
    refresh_end = open_ts + interval_milliseconds - 1
    return refresh_start, refresh_end


def request_needs_trailing_refresh(interval, start_timestamp, end_timestamp):
    window = live_trailing_window(interval)
    if window is None:
        return False
    refresh_start, refresh_end = window
    return end_timestamp >= refresh_start and start_timestamp <= refresh_end


def refresh_trailing_candles(
    symbol,
    interval,
    wait_for_lock=False,
    raise_on_error=False,
):
    """Force-upsert recent live candles even when the cache range looks covered."""
    fetch_key = (symbol, interval)
    now_timestamp = int(time.time() * 1000)
    now_monotonic = time.monotonic()
    if trailing_refresh_is_fresh(
        fetch_key,
        interval,
        now_monotonic,
        now_timestamp,
    ):
        return 0

    window = live_trailing_window(interval, now_timestamp)
    if window is None:
        return 0
    refresh_start, refresh_end = window
    if refresh_end < refresh_start:
        return 0

    lock = market_fetch_lock(symbol, interval)
    # Background refreshes stay non-blocking. Replay/live requests that require
    # the current tail wait for the in-flight fetch instead of returning stale data.
    if not lock.acquire(blocking=wait_for_lock):
        return 0
    try:
        if trailing_refresh_is_fresh(fetch_key, interval):
            return 0
        failed_at, failed_message = MARKET_FETCH_FAILURES.get(fetch_key, (0, ""))
        if failed_message and time.monotonic() - failed_at < FETCH_FAILURE_COOLDOWN_SECONDS:
            if raise_on_error:
                raise RuntimeError(f"{failed_message}（稍后再试，避免重复等待）")
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
            MARKET_TRAILING_REFRESH_BOUNDARY[fetch_key] = (
                latest_closed_candle_timestamp(interval, now_timestamp)
            )
            print(
                f"[market] trailing-refresh {symbol} {interval} "
                f"bars={len(fetched)} window={trailing_refresh_bar_count(interval)}",
                flush=True,
            )
            return len(fetched)
        except RuntimeError as error:
            MARKET_FETCH_FAILURES[fetch_key] = (time.monotonic(), str(error))
            print(
                f"[market] trailing-refresh {symbol} {interval} failed: {error}",
                flush=True,
            )
            if raise_on_error:
                raise
            return 0
    finally:
        lock.release()


def schedule_trailing_refresh(symbol, interval, start_timestamp, end_timestamp):
    """Refresh live trailing bars in the background so chart requests stay snappy."""
    if not request_needs_trailing_refresh(interval, start_timestamp, end_timestamp):
        return
    fetch_key = (symbol, interval)
    now_monotonic = time.monotonic()
    if trailing_refresh_is_fresh(fetch_key, interval, now_monotonic):
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


def load_candle_range(
    symbol,
    interval,
    start_timestamp,
    end_timestamp,
    offline=None,
    wait_for_refresh=False,
    require_complete=False,
):
    source = "sqlite"
    warning = ""
    offline = get_offline_mode() if offline is None else offline
    covered = cached_range_contains(symbol, interval, start_timestamp, end_timestamp)
    candles = list_candles(symbol, interval, start_timestamp, end_timestamp)
    defects = (
        []
        if offline
        else closed_range_defects(
            interval,
            start_timestamp,
            end_timestamp,
            candles,
        )
    )
    if (
        not covered
        and not defects
        and not offline
        and candles
        and not wait_for_refresh
        and not require_complete
    ):
        schedule_candle_refresh(symbol, interval, start_timestamp, end_timestamp)
        schedule_trailing_refresh(symbol, interval, start_timestamp, end_timestamp)
        return candles, source, warning
    if (not covered or defects) and not offline:
        fetch_key = (symbol, interval)
        with market_fetch_lock(symbol, interval):
            missing_ranges = (
                []
                if covered
                else historical_missing_cached_ranges(
                    symbol,
                    interval,
                    start_timestamp,
                    end_timestamp,
                )
            )
            if defects:
                candles = list_candles(
                    symbol,
                    interval,
                    start_timestamp,
                    end_timestamp,
                )
                defects = closed_range_defects(
                    interval,
                    start_timestamp,
                    end_timestamp,
                    candles,
                )
            repair_ranges = unrepaired_ranges(symbol, interval, defects)
            fetch_ranges = merge_touching_ranges(missing_ranges + repair_ranges)
            if fetch_ranges:
                failed_at, failed_message = MARKET_FETCH_FAILURES.get(fetch_key, (0, ""))
                cooldown_remaining = FETCH_FAILURE_COOLDOWN_SECONDS - (time.monotonic() - failed_at)
                if failed_message and cooldown_remaining > 0:
                    warning = f"{failed_message}（稍后再试，避免重复等待）"
                else:
                    fetch_started = time.perf_counter()
                    fetched_count = 0
                    chunk_count = 0
                    try:
                        fetched_count, chunk_count = fetch_and_save_candle_ranges(
                            symbol,
                            interval,
                            fetch_ranges,
                        )
                        remember_repaired_ranges(symbol, interval, repair_ranges)
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
                            f"missing={len(missing_ranges)} defects={len(defects)} "
                            f"chunks={chunk_count} candles={fetched_count} "
                            f"elapsed={elapsed_milliseconds}ms",
                            flush=True,
                        )
            covered = not missing_cached_ranges(
                symbol,
                interval,
                start_timestamp,
                end_timestamp,
            )
    if (
        not offline
        and not warning
        and request_needs_trailing_refresh(
            interval,
            start_timestamp,
            end_timestamp,
        )
    ):
        if wait_for_refresh or require_complete:
            refreshed_count = refresh_trailing_candles(
                symbol,
                interval,
                wait_for_lock=True,
                raise_on_error=require_complete,
            )
            if refreshed_count > 0:
                source = "bybit"
            failed_message = MARKET_FETCH_FAILURES.get((symbol, interval), (0, ""))[1]
            if failed_message and not require_complete:
                warning = failed_message
        else:
            schedule_trailing_refresh(
                symbol,
                interval,
                start_timestamp,
                end_timestamp,
            )
    candles = list_candles(symbol, interval, start_timestamp, end_timestamp)
    if offline and not covered:
        warning = "仅本地模式：该时间范围的缓存不完整"
    if warning and (require_complete or not candles):
        raise RuntimeError(warning)
    return candles, source, warning


def load_chart_candles(symbol, interval, anchor_timestamp):
    validate_market_scope(symbol, interval)
    now_timestamp = int(time.time() * 1000)
    if anchor_timestamp < 1_500_000_000_000 or anchor_timestamp > now_timestamp + 31 * 86_400_000:
        raise ValueError("视频时间无效")
    interval_ms = INTERVAL_MILLISECONDS[interval]
    effective_cutoff = anchor_timestamp
    start_timestamp = anchor_timestamp - interval_ms * 500
    loaded_cutoff = effective_cutoff
    candles, source, warning = load_candle_range(
        symbol,
        interval,
        start_timestamp,
        loaded_cutoff,
        wait_for_refresh=True,
    )
    # Newly listed (or newly added) symbols often inherit the previous chart's
    # historical cursor. An empty window is cached as covered, so retry around
    # now instead of leaving the chart blank.
    if not candles and not warning and anchor_timestamp < now_timestamp - interval_ms:
        live_cutoff = now_timestamp
        live_start = live_cutoff - interval_ms * 500
        live_candles, live_source, live_warning = load_candle_range(
            symbol,
            interval,
            live_start,
            live_cutoff,
            wait_for_refresh=True,
        )
        if live_candles:
            candles = live_candles
            source = live_source
            warning = live_warning
            effective_cutoff = live_cutoff
            loaded_cutoff = live_cutoff
        elif live_warning:
            warning = live_warning
    return {
        "candles": candles,
        "anchor": anchor_timestamp,
        "requestedCutoff": anchor_timestamp,
        "effectiveCutoff": effective_cutoff,
        "loadedCutoff": loaded_cutoff,
        "hasMoreLater": loaded_cutoff < effective_cutoff,
        "source": source,
        "warning": warning,
    }


def trade_candle_window(entry_timestamp, exit_timestamp, interval, now_timestamp=None):
    if now_timestamp is None:
        now_timestamp = int(time.time() * 1000)
    interval_ms = INTERVAL_MILLISECONDS[interval]
    exit_timestamp = min(exit_timestamp, now_timestamp)
    holding_bars = max(
        1,
        math.ceil((exit_timestamp - entry_timestamp) / interval_ms),
    )
    padding_bars = 200 if holding_bars < 400 else 50
    start_timestamp = entry_timestamp - interval_ms * padding_bars
    end_timestamp = min(now_timestamp, exit_timestamp + interval_ms * padding_bars)
    span_bars = max(1, math.ceil((end_timestamp - start_timestamp) / interval_ms) + 1)
    if span_bars <= MAX_CANDLES_PER_RESPONSE:
        return start_timestamp, end_timestamp, False
    pad = min(padding_bars, 40)
    start_timestamp = entry_timestamp - interval_ms * pad
    end_timestamp = min(
        now_timestamp,
        start_timestamp + interval_ms * (MAX_CANDLES_PER_RESPONSE - 1),
    )
    return start_timestamp, end_timestamp, True


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

    start_timestamp, end_timestamp, truncated = trade_candle_window(
        entry_timestamp, exit_timestamp, interval, now_timestamp
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
        "truncated": truncated,
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
    candles, source, warning = load_candle_range(
        symbol,
        interval,
        start_timestamp,
        end_timestamp,
        require_complete=True,
    )
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
    candles, source, warning = load_candle_range(
        symbol,
        interval,
        start_timestamp,
        end_timestamp,
        require_complete=True,
    )
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


def _validate_drawing_content(payload):
    if not isinstance(payload, dict):
        raise ValueError("画图记录必须是对象")
    drawing_id = str(payload.get("id", "")).strip()
    tool_type = str(payload.get("toolType", ""))
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
    return drawing, encoded


def validate_drawing(payload):
    if not isinstance(payload, dict):
        raise ValueError("画图记录必须是对象")
    video_id = str(payload.get("videoId", "")).strip()
    symbol = str(payload.get("symbol", ""))
    interval = str(payload.get("interval", ""))
    validate_market_scope(symbol, interval)
    if not video_id or "/" in video_id or len(video_id) > 100:
        raise ValueError("视频 ID 无效")
    drawing, encoded = _validate_drawing_content(payload)
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


def _symbol_search_match_key(symbol, base, query):
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


def search_perpetual_symbols(query_value, limit=20):
    raw_query = str(query_value or "").strip()
    if len(raw_query) > 50:
        raise ValueError("搜索内容过长")
    if not isinstance(limit, int) or limit < 1 or limit > 50:
        raise ValueError("搜索结果数量必须在 1 到 50 之间")

    query = re.sub(r"[^A-Z0-9]", "", raw_query.upper())
    if not query:
        return {"symbols": [], "offlineMode": get_offline_mode()}

    saved_symbols = get_all_symbols()
    saved_by_symbol = {item["symbol"]: item for item in saved_symbols}
    matches_by_symbol = {}
    warning = None
    offline_mode = get_offline_mode()

    if not offline_mode:
        try:
            for market in MARKET_DATA_PROVIDER.search_usdt_perpetual_markets(query, limit):
                symbol = market["symbol"]
                matches_by_symbol[symbol] = {
                    **market,
                    "added": symbol in saved_by_symbol,
                }
        except RuntimeError as error:
            warning = str(error)

    for item in saved_symbols:
        symbol = item["symbol"]
        base = symbol[:-4]
        if _symbol_search_match_key(symbol, base, query) is None:
            continue
        matches_by_symbol[symbol] = {
            "symbol": symbol,
            "base": base,
            "quote": "USDT",
            "name": item["name"],
            "added": True,
        }

    matches = list(matches_by_symbol.values())
    matches.sort(
        key=lambda item: _symbol_search_match_key(
            item["symbol"], item["base"], query
        )
    )
    payload = {
        "symbols": matches[:limit],
        "offlineMode": offline_mode,
    }
    if warning:
        payload["warning"] = warning
    return payload


def add_custom_symbol(symbol_str):
    symbol = str(symbol_str or "").strip().upper()
    if not re.match(r"^[A-Z0-9]{3,15}USDT$", symbol):
        raise ValueError("合约代码格式无效，需为 USDT 永续合约")
    now_ts = int(time.time() * 1000)
    start_ts = now_ts - 86_400_000 * 2
    try:
        candles = fetch_market_candles(symbol, "60", start_ts, now_ts)
    except RuntimeError as err:
        raise ValueError(f"校验该合约失败：{err}")
    if not candles:
        raise ValueError("交易所未返回该合约的 K 线，请检查合约代码")
    save_candles(symbol, "60", start_ts, now_ts, candles)

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
        created_datetime = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        if created_datetime.utcoffset() is None:
            raise ValueError("模拟订单时间必须包含时区")
        if closed_at:
            closed_at = str(closed_at)
            closed_datetime = datetime.fromisoformat(closed_at.replace("Z", "+00:00"))
            if closed_datetime.utcoffset() is None:
                raise ValueError("模拟订单时间必须包含时区")
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


def _validate_position_drawing_scope(venue, position_id, symbol, interval):
    cleaned_venue = str(venue or POSITION_REVIEW_VENUE).strip().lower()
    cleaned_position_id = str(position_id or "").strip()
    cleaned_symbol = str(symbol or "").strip().upper()
    cleaned_interval = str(interval or "").strip()
    if not cleaned_venue or len(cleaned_venue) > 30:
        raise ValueError("交易所无效")
    if not cleaned_position_id or len(cleaned_position_id) > 80:
        raise ValueError("仓位 ID 无效")
    if not re.match(r"^[A-Z0-9]{3,20}USDT$", cleaned_symbol):
        raise ValueError("仓位合约格式无效")
    if cleaned_interval not in VALID_INTERVALS:
        raise ValueError("不支持该 K 线周期")
    return cleaned_venue, cleaned_position_id, cleaned_symbol, cleaned_interval


def _ensure_position_drawing_scope_exists(connection, venue, position_id, symbol):
    row = connection.execute(
        """SELECT chart_symbol FROM exchange_positions
           WHERE venue = ? AND position_id = ?""",
        (venue, position_id),
    ).fetchone()
    if row is None:
        raise ValueError("仓位不存在")
    if row["chart_symbol"] != symbol:
        raise ValueError("仓位合约不匹配")


def save_position_drawing(payload):
    if not isinstance(payload, dict):
        raise ValueError("画图记录必须是对象")
    venue, position_id, symbol, interval = _validate_position_drawing_scope(
        payload.get("venue"),
        payload.get("positionId"),
        payload.get("symbol"),
        payload.get("interval"),
    )
    drawing, encoded = _validate_drawing_content(payload)
    now = datetime.now().astimezone().isoformat()
    with DATABASE_LOCK, database() as connection:
        _ensure_position_drawing_scope_exists(connection, venue, position_id, symbol)
        existing = connection.execute(
            """SELECT created_at FROM position_drawings
               WHERE venue = ? AND position_id = ? AND id = ?""",
            (venue, position_id, drawing["id"]),
        ).fetchone()
        created_at = existing["created_at"] if existing else now
        connection.execute(
            """INSERT INTO position_drawings
               (venue, position_id, id, symbol, interval, tool_type, tool_json,
                created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(venue, position_id, id) DO UPDATE SET
                 symbol = excluded.symbol, interval = excluded.interval,
                 tool_type = excluded.tool_type, tool_json = excluded.tool_json,
                 updated_at = excluded.updated_at""",
            (
                venue,
                position_id,
                drawing["id"],
                symbol,
                interval,
                drawing["toolType"],
                encoded,
                created_at,
                now,
            ),
        )
    return {**drawing, "interval": interval}


def list_position_drawings(venue, position_id, symbol, interval):
    venue, position_id, symbol, _interval = _validate_position_drawing_scope(
        venue, position_id, symbol, interval
    )
    with DATABASE_LOCK, database() as connection:
        _ensure_position_drawing_scope_exists(connection, venue, position_id, symbol)
        rows = connection.execute(
            """SELECT interval, tool_json FROM position_drawings
               WHERE venue = ? AND position_id = ? AND symbol = ?
               ORDER BY created_at ASC""",
            (venue, position_id, symbol),
        ).fetchall()
    return [
        {**json.loads(row["tool_json"]), "interval": row["interval"]}
        for row in rows
    ]


def replace_position_drawings(payload):
    if not isinstance(payload, dict):
        raise ValueError("画图批量记录必须是对象")
    venue, position_id, symbol, interval = _validate_position_drawing_scope(
        payload.get("venue"),
        payload.get("positionId"),
        payload.get("symbol"),
        payload.get("interval"),
    )
    drawings = payload.get("drawings")
    if not isinstance(drawings, list) or len(drawings) > 500:
        raise ValueError("画图批量记录无效")
    validated = []
    seen_ids = set()
    for item in drawings:
        if not isinstance(item, dict):
            raise ValueError("画图记录必须是对象")
        item_interval = str(item.get("interval", interval))
        if item_interval not in VALID_INTERVALS:
            raise ValueError("不支持该 K 线周期")
        drawing, encoded = _validate_drawing_content(item)
        if drawing["id"] in seen_ids:
            raise ValueError("画图 ID 重复")
        seen_ids.add(drawing["id"])
        validated.append((item_interval, drawing, encoded))

    now = datetime.now().astimezone().isoformat()
    with DATABASE_LOCK, database() as connection:
        _ensure_position_drawing_scope_exists(connection, venue, position_id, symbol)
        created_times = {
            row["id"]: row["created_at"]
            for row in connection.execute(
                """SELECT id, created_at FROM position_drawings
                   WHERE venue = ? AND position_id = ?""",
                (venue, position_id),
            ).fetchall()
        }
        connection.execute(
            "DELETE FROM position_drawings WHERE venue = ? AND position_id = ?",
            (venue, position_id),
        )
        connection.executemany(
            """INSERT INTO position_drawings
               (venue, position_id, id, symbol, interval, tool_type, tool_json,
                created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    venue,
                    position_id,
                    drawing["id"],
                    symbol,
                    item_interval,
                    drawing["toolType"],
                    encoded,
                    created_times.get(drawing["id"], now),
                    now,
                )
                for item_interval, drawing, encoded in validated
            ],
        )
    return [
        {**drawing, "interval": item_interval}
        for item_interval, drawing, _encoded in validated
    ]


def delete_position_drawings(query):
    drawing_id = str(query.get("id", [""])[0]).strip()
    venue, position_id, symbol, interval = _validate_position_drawing_scope(
        query.get("venue", [POSITION_REVIEW_VENUE])[0],
        query.get("positionId", [""])[0],
        query.get("symbol", [""])[0],
        query.get("interval", [""])[0],
    )
    if drawing_id and (
        len(drawing_id) > 100 or drawing_id.startswith(SYSTEM_DRAWING_PREFIX)
    ):
        raise ValueError("画图 ID 无效")
    with DATABASE_LOCK, database() as connection:
        _ensure_position_drawing_scope_exists(connection, venue, position_id, symbol)
        if drawing_id:
            connection.execute(
                """DELETE FROM position_drawings
                   WHERE venue = ? AND position_id = ? AND id = ?""",
                (venue, position_id, drawing_id),
            )
            return
        connection.execute(
            "DELETE FROM position_drawings WHERE venue = ? AND position_id = ?",
            (venue, position_id),
        )


def _fernet():
    with CREDENTIAL_LOCK:
        RUN_DIR.mkdir(parents=True, exist_ok=True)
        if CREDENTIAL_KEY_FILE.exists():
            key = CREDENTIAL_KEY_FILE.read_bytes().strip()
        else:
            key = Fernet.generate_key()
            CREDENTIAL_KEY_FILE.write_bytes(key)
            try:
                os.chmod(CREDENTIAL_KEY_FILE, 0o600)
            except OSError:
                pass
    return Fernet(key)


def _encrypt_secret(value):
    return _fernet().encrypt(str(value).encode("utf-8")).decode("ascii")


def _decrypt_secret(value):
    try:
        return _fernet().decrypt(str(value).encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError) as error:
        raise RuntimeError("本地密钥无法解密，请重新保存 Bitget API") from error


def _app_setting(key, default=None):
    with DATABASE_LOCK, database() as connection:
        row = connection.execute(
            "SELECT value FROM app_settings WHERE key = ?",
            (key,),
        ).fetchone()
    if row is None:
        return default
    return row["value"]


def _set_app_setting(key, value):
    with DATABASE_LOCK, database() as connection:
        connection.execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


def bitget_credentials_configured():
    return bool(
        _app_setting("bitget_api_key_enc")
        and _app_setting("bitget_api_secret_enc")
        and _app_setting("bitget_api_passphrase_enc")
    )


def save_bitget_credentials(payload):
    if not isinstance(payload, dict):
        raise ValueError("密钥格式无效")
    api_key = str(payload.get("apiKey") or "").strip()
    secret = str(payload.get("secret") or "").strip()
    passphrase = str(payload.get("passphrase") or "").strip()
    if not api_key or not secret or not passphrase:
        raise ValueError("需要 API Key、Secret 和 Passphrase")
    if len(api_key) > 200 or len(secret) > 200 or len(passphrase) > 200:
        raise ValueError("密钥长度超出限制")
    encrypted = (
        ("bitget_api_key_enc", _encrypt_secret(api_key)),
        ("bitget_api_secret_enc", _encrypt_secret(secret)),
        ("bitget_api_passphrase_enc", _encrypt_secret(passphrase)),
    )
    with CREDENTIAL_LOCK, DATABASE_LOCK, database() as connection:
        connection.executemany(
            "INSERT INTO app_settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            encrypted,
        )
    _invalidate_venue_provider("bitget")
    return {"configured": True}


def load_bitget_credentials():
    with DATABASE_LOCK, database() as connection:
        rows = connection.execute(
            "SELECT key, value FROM app_settings WHERE key IN (?, ?, ?)",
            (
                "bitget_api_key_enc",
                "bitget_api_secret_enc",
                "bitget_api_passphrase_enc",
            ),
        ).fetchall()
    values = {row["key"]: row["value"] for row in rows}
    api_key = values.get("bitget_api_key_enc")
    secret = values.get("bitget_api_secret_enc")
    passphrase = values.get("bitget_api_passphrase_enc")
    if not api_key or not secret or not passphrase:
        raise ValueError("尚未配置 Bitget 只读 API")
    return {
        "apiKey": _decrypt_secret(api_key),
        "secret": _decrypt_secret(secret),
        "password": _decrypt_secret(passphrase),
    }


def gate_credentials_configured():
    return bool(
        _app_setting("gate_api_key_enc") and _app_setting("gate_api_secret_enc")
    )


def save_gate_credentials(payload):
    if not isinstance(payload, dict):
        raise ValueError("密钥格式无效")
    api_key = str(payload.get("apiKey") or "").strip()
    secret = str(payload.get("secret") or "").strip()
    if not api_key or not secret:
        raise ValueError("需要 API Key 和 Secret")
    if len(api_key) > 200 or len(secret) > 200:
        raise ValueError("密钥长度超出限制")
    encrypted = (
        ("gate_api_key_enc", _encrypt_secret(api_key)),
        ("gate_api_secret_enc", _encrypt_secret(secret)),
    )
    with CREDENTIAL_LOCK, DATABASE_LOCK, database() as connection:
        connection.executemany(
            "INSERT INTO app_settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            encrypted,
        )
    _invalidate_venue_provider("gate")
    return {"configured": True, "venue": "gate"}


def load_gate_credentials():
    with DATABASE_LOCK, database() as connection:
        rows = connection.execute(
            "SELECT key, value FROM app_settings WHERE key IN (?, ?)",
            ("gate_api_key_enc", "gate_api_secret_enc"),
        ).fetchall()
    values = {row["key"]: row["value"] for row in rows}
    api_key = values.get("gate_api_key_enc")
    secret = values.get("gate_api_secret_enc")
    if not api_key or not secret:
        raise ValueError("尚未配置 Gate 只读 API")
    return {
        "apiKey": _decrypt_secret(api_key),
        "secret": _decrypt_secret(secret),
    }


def save_position_review_credentials(payload):
    if not isinstance(payload, dict):
        raise ValueError("密钥格式无效")
    venue = str(payload.get("venue") or POSITION_REVIEW_VENUE).strip().lower()
    if venue == "bitget":
        result = save_bitget_credentials(payload)
        result["venue"] = "bitget"
        return result
    if venue == "gate":
        return save_gate_credentials(payload)
    raise ValueError("不支持的交易所")


def position_review_configured():
    return bitget_credentials_configured() or gate_credentials_configured()


def _later_timestamp(*values):
    latest = None
    for value in values:
        if not value:
            continue
        if latest is None or str(value) > str(latest):
            latest = value
    return latest


def _upsert_exchange_position(connection, position, synced_at):
    connection.execute(
        """INSERT INTO exchange_positions (
               venue, position_id, unified_symbol, chart_symbol, side, status,
               entry_price, exit_price, contracts, leverage, margin_mode, hedged,
               realized_pnl, net_pnl, funding, open_fee, close_fee,
               entry_time_ms, exit_time_ms, synced_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(venue, position_id) DO UPDATE SET
             unified_symbol = excluded.unified_symbol,
             chart_symbol = excluded.chart_symbol,
             side = excluded.side,
             status = excluded.status,
             entry_price = excluded.entry_price,
             exit_price = excluded.exit_price,
             contracts = excluded.contracts,
             leverage = COALESCE(excluded.leverage, leverage),
             margin_mode = excluded.margin_mode,
             hedged = excluded.hedged,
             realized_pnl = excluded.realized_pnl,
             net_pnl = excluded.net_pnl,
             funding = excluded.funding,
             open_fee = excluded.open_fee,
             close_fee = excluded.close_fee,
             entry_time_ms = excluded.entry_time_ms,
             exit_time_ms = excluded.exit_time_ms,
             synced_at = excluded.synced_at""",
        (
            position["venue"],
            position["positionId"],
            position["unifiedSymbol"],
            position["chartSymbol"],
            position["side"],
            position["status"],
            position.get("entryPrice"),
            position.get("exitPrice"),
            position.get("contracts"),
            position.get("leverage"),
            position.get("marginMode"),
            1 if position.get("hedged") else 0,
            position.get("realizedPnl"),
            position.get("netPnl"),
            position.get("funding"),
            position.get("openFee"),
            position.get("closeFee"),
            position["entryTimeMs"],
            position.get("exitTimeMs"),
            synced_at,
        ),
    )


def _migrate_open_annotations(connection, closed_position, closed_positions=None):
    rows = connection.execute(
        """SELECT position_id, leverage, entry_time_ms FROM exchange_positions
           WHERE venue = ? AND status IN ('open', 'stale') AND chart_symbol = ? AND side = ?
             AND ABS(entry_time_ms - ?) < 2000 AND position_id <> ?""",
        (
            closed_position["venue"],
            closed_position["chartSymbol"],
            closed_position["side"],
            closed_position["entryTimeMs"],
            closed_position["positionId"],
        ),
    ).fetchall()
    if len(rows) != 1:
        return False
    if closed_positions is not None:
        open_entry_time_ms = rows[0]["entry_time_ms"]
        matching_closed = [
            candidate
            for candidate in closed_positions
            if candidate.get("venue") == closed_position["venue"]
            and candidate.get("chartSymbol") == closed_position["chartSymbol"]
            and candidate.get("side") == closed_position["side"]
            and abs(
                (candidate.get("entryTimeMs") or 0)
                - open_entry_time_ms
            )
            < 2000
        ]
        if (
            len(matching_closed) != 1
            or matching_closed[0].get("positionId") != closed_position["positionId"]
        ):
            return False

    row = rows[0]
    old_id = row["position_id"]
    if closed_position.get("leverage") is None and row["leverage"] is not None:
        closed_position["leverage"] = row["leverage"]
    connection.execute(
        """INSERT INTO position_notes (venue, position_id, note, updated_at)
           SELECT venue, ?, note, updated_at FROM position_notes
           WHERE venue = ? AND position_id = ?
           ON CONFLICT(venue, position_id) DO NOTHING""",
        (closed_position["positionId"], closed_position["venue"], old_id),
    )
    connection.execute(
        """INSERT INTO position_tag_map (venue, position_id, tag_id)
           SELECT venue, ?, tag_id FROM position_tag_map
           WHERE venue = ? AND position_id = ?
           ON CONFLICT(venue, position_id, tag_id) DO NOTHING""",
        (closed_position["positionId"], closed_position["venue"], old_id),
    )
    connection.execute(
        """INSERT INTO position_drawings (
               venue, position_id, id, symbol, interval, tool_type,
               tool_json, created_at, updated_at
           )
           SELECT venue, ?, id, symbol, interval, tool_type,
                  tool_json, created_at, updated_at
           FROM position_drawings
           WHERE venue = ? AND position_id = ?
           ON CONFLICT(venue, position_id, id) DO NOTHING""",
        (closed_position["positionId"], closed_position["venue"], old_id),
    )
    connection.execute(
        "DELETE FROM position_notes WHERE venue = ? AND position_id = ?",
        (closed_position["venue"], old_id),
    )
    connection.execute(
        "DELETE FROM position_tag_map WHERE venue = ? AND position_id = ?",
        (closed_position["venue"], old_id),
    )
    connection.execute(
        "DELETE FROM position_drawings WHERE venue = ? AND position_id = ?",
        (closed_position["venue"], old_id),
    )
    connection.execute(
        "DELETE FROM exchange_positions WHERE venue = ? AND position_id = ?",
        (closed_position["venue"], old_id),
    )
    return True


def _upsert_position_fill(connection, fill, synced_at):
    connection.execute(
        """INSERT INTO position_fills (
               venue, exec_id, order_id, chart_symbol, unified_symbol, side,
               trade_side, price, quantity, pnl, fee, time_ms, synced_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(venue, exec_id) DO UPDATE SET
             order_id = excluded.order_id,
             chart_symbol = excluded.chart_symbol,
             unified_symbol = excluded.unified_symbol,
             side = excluded.side,
             trade_side = excluded.trade_side,
             price = excluded.price,
             quantity = excluded.quantity,
             pnl = excluded.pnl,
             fee = excluded.fee,
             time_ms = excluded.time_ms,
             synced_at = excluded.synced_at""",
        (
            fill.get("venue") or POSITION_REVIEW_VENUE,
            fill["execId"],
            fill.get("orderId"),
            fill["chartSymbol"],
            fill.get("unifiedSymbol"),
            fill["side"],
            fill.get("tradeSide"),
            fill.get("price"),
            fill.get("quantity"),
            fill.get("pnl"),
            fill.get("fee"),
            fill["timeMs"],
            synced_at,
        ),
    )


def _fill_from_row(row):
    return {
        "venue": row["venue"] if "venue" in row.keys() else None,
        "execId": row["exec_id"],
        "orderId": row["order_id"],
        "chartSymbol": row["chart_symbol"],
        "unifiedSymbol": row["unified_symbol"],
        "side": row["side"],
        "tradeSide": row["trade_side"],
        "price": row["price"],
        "quantity": row["quantity"],
        "pnl": row["pnl"],
        "fee": row["fee"],
        "timeMs": row["time_ms"],
    }


def _aggregate_fill_operations(items):
    groups = {}
    for index, item in enumerate(items):
        order_id = item.get("orderId")
        key = (
            ("order", order_id, item.get("role"))
            if order_id
            else ("exec", item.get("execId") or str(index))
        )
        groups.setdefault(key, []).append(item)

    operations = []
    for group in groups.values():
        first = min(
            group,
            key=lambda item: (item.get("timeMs") or 0, item.get("execId") or ""),
        )
        last = max(
            group,
            key=lambda item: (item.get("timeMs") or 0, item.get("execId") or ""),
        )
        quantities = [
            item.get("quantity") for item in group if item.get("quantity") is not None
        ]
        weighted_prices = [
            (item.get("price"), item.get("quantity"))
            for item in group
            if item.get("price") is not None
            and item.get("quantity") is not None
            and item.get("quantity") > 0
        ]
        total_weight = sum(quantity for _, quantity in weighted_prices)
        if total_weight > 0:
            price = sum(price * quantity for price, quantity in weighted_prices) / total_weight
        else:
            price = next(
                (item.get("price") for item in group if item.get("price") is not None),
                None,
            )
        pnl_values = [item.get("pnl") for item in group if item.get("pnl") is not None]
        fee_values = [item.get("fee") for item in group if item.get("fee") is not None]
        operations.append(
            {
                **first,
                "quantity": sum(quantities) if quantities else None,
                "price": price,
                "pnl": sum(pnl_values) if pnl_values else None,
                "fee": sum(fee_values) if fee_values else None,
                "_lastTimeMs": last.get("timeMs") or first.get("timeMs"),
            }
        )
    return sorted(
        operations,
        key=lambda item: (item.get("timeMs") or 0, item.get("execId") or ""),
    )


def assign_fills_to_positions(positions, fills):
    now_ms = int(time.time() * 1000)
    grouped = {
        (position.get("venue"), position["positionId"]): [] for position in positions
    }
    positions_by_symbol = {}
    for position in positions:
        positions_by_symbol.setdefault(position.get("chartSymbol"), []).append(position)
    for fill in fills or []:
        candidates = []
        fill_time = fill.get("timeMs")
        if fill_time is None:
            continue
        for position in positions_by_symbol.get(fill.get("chartSymbol"), []):
            fill_venue = fill.get("venue")
            position_venue = position.get("venue")
            if fill_venue and position_venue and fill_venue != position_venue:
                continue
            entry_ms = position.get("entryTimeMs")
            if entry_ms is None:
                continue
            exit_ms = position.get("exitTimeMs") or now_ms
            if fill_time < entry_ms - FILL_MATCH_PAD_MS:
                continue
            if fill_time > exit_ms + FILL_MATCH_PAD_MS:
                continue
            role = classify_fill_role(fill, position)
            if not role:
                continue
            strictly_inside = entry_ms <= fill_time <= exit_ms
            candidates.append((position, role, strictly_inside))
        strict_candidates = [item for item in candidates if item[2]]
        eligible = strict_candidates or candidates
        if not eligible:
            continue
        chosen, role, _ = max(eligible, key=lambda item: item[0]["entryTimeMs"])
        chosen_key = (chosen.get("venue"), chosen["positionId"])
        if chosen_key in grouped:
            grouped[chosen_key].append({**fill, "role": role})

    assigned = {}
    for position in positions:
        pos_key = (position.get("venue"), position["positionId"])
        items = sorted(
            grouped.get(pos_key, []),
            key=lambda item: (item.get("timeMs") or 0, item.get("execId") or ""),
        )
        items = _aggregate_fill_operations(items)
        close_items = [item for item in items if item.get("role") == "close"]
        last_close_id = None
        if position.get("status") == "closed" and close_items:
            last_close_id = max(
                close_items,
                key=lambda item: (
                    item.get("_lastTimeMs") or item.get("timeMs") or 0,
                    item.get("execId") or "",
                ),
            ).get("execId")
        seen_open = False
        annotated = []
        for item in items:
            role = item.get("role")
            if role == "open":
                kind = "open" if not seen_open else "scaleIn"
                seen_open = True
            elif position.get("status") == "closed" and item.get("execId") == last_close_id:
                kind = "close"
            else:
                kind = "reduce"
            operation_time_ms = (
                item.get("_lastTimeMs")
                if kind == "close"
                else item.get("timeMs")
            )
            annotated.append(
                {
                    "execId": item.get("execId"),
                    "timeMs": operation_time_ms,
                    "side": item.get("side"),
                    "tradeSide": item.get("tradeSide"),
                    "kind": kind,
                    "price": item.get("price"),
                    "quantity": item.get("quantity"),
                    "pnl": item.get("pnl"),
                }
            )
        sorted_annotated = sorted(
            annotated,
            key=lambda item: (item.get("timeMs") or 0, item.get("execId") or ""),
        )
        assigned[pos_key] = sorted_annotated
        assigned[position["positionId"]] = sorted_annotated
    return assigned


def _delete_unannotated_stale_open_positions(connection, venue, active_position_ids):
    stale_open = connection.execute(
        """SELECT position_id FROM exchange_positions
           WHERE venue = ? AND status = 'open'""",
        (venue,),
    ).fetchall()
    for row in stale_open:
        position_id = row["position_id"]
        if position_id in active_position_ids:
            continue
        has_annotations = connection.execute(
            """SELECT
                 EXISTS(
                   SELECT 1 FROM position_notes
                   WHERE venue = ? AND position_id = ?
                 )
                 OR EXISTS(
                   SELECT 1 FROM position_tag_map
                   WHERE venue = ? AND position_id = ?
                 )
                 OR EXISTS(
                   SELECT 1 FROM position_drawings
                   WHERE venue = ? AND position_id = ?
                 )""",
            (
                venue,
                position_id,
                venue,
                position_id,
                venue,
                position_id,
            ),
        ).fetchone()[0]
        if has_annotations:
            connection.execute(
                """UPDATE exchange_positions SET status = 'stale'
                   WHERE venue = ? AND position_id = ?""",
                (venue, position_id),
            )
            continue
        connection.execute(
            "DELETE FROM exchange_positions WHERE venue = ? AND position_id = ?",
            (venue, position_id),
        )


def sync_position_review():
    if not POSITION_SYNC_LOCK.acquire(blocking=False):
        raise SyncInProgressError("仓位同步正在进行，请稍后再试")
    try:
        return _sync_position_review()
    finally:
        POSITION_SYNC_LOCK.release()


def refresh_learning_videos(payload=None):
    payload = payload if isinstance(payload, dict) else {}
    source_url = str(payload.get("sourceUrl") or "").strip() or None
    template = str(payload.get("template") or "").strip().lower() or None
    if template and template != "tia":
        raise ValueError("未知的示例模板")
    if not VIDEO_REFRESH_LOCK.acquire(blocking=False):
        raise SyncInProgressError("视频清单正在刷新，请稍后再试")
    try:
        result = video_catalog.refresh_video_catalog(
            ROOT,
            source_url=source_url,
            template=template,
        )
        response = {
            "ok": True,
            "total": result["total"],
            "added": result["added"],
            "removed": result.get("removed", 0),
            "replaced": bool(result.get("replaced")),
            "latestDate": result["latestDate"],
            "source": result.get("source"),
        }
        if result.get("warning"):
            response["warning"] = result["warning"]
        return response
    finally:
        VIDEO_REFRESH_LOCK.release()


def get_workspace_settings():
    invites = workspace_config.resolve_invite_urls(
        ROOT,
        stored_gate=_app_setting("invite_gate_url", "") or "",
        stored_bitget=_app_setting("invite_bitget_url", "") or "",
    )
    return {
        "invites": invites,
        "videoSource": video_catalog.describe_catalog_source(ROOT),
    }


def save_invite_urls(payload):
    if not isinstance(payload, dict):
        raise ValueError("邀请链接格式无效")
    gate = workspace_config.normalize_invite_url(payload.get("gate"), "Gate")
    bitget = workspace_config.normalize_invite_url(payload.get("bitget"), "Bitget")
    _set_app_setting("invite_gate_url", gate)
    _set_app_setting("invite_bitget_url", bitget)
    return get_workspace_settings()


def sync_bitget_positions():
    return sync_position_review()


def _fetch_closed_and_fills(fetch_closed, fetch_fills, now_ms):
    window_ms = 30 * 24 * 60 * 60 * 1000
    closed = []
    seen_ids = set()
    for index in range(3):
        until_ms = now_ms - index * window_ms
        since_ms = until_ms - window_ms
        for position in fetch_closed(since_ms, until_ms):
            if position["positionId"] in seen_ids:
                continue
            seen_ids.add(position["positionId"])
            closed.append(position)
    fills = []
    fills_ok = True
    try:
        for index in range(3):
            until_ms = now_ms - index * window_ms
            since_ms = until_ms - window_ms
            fills.extend(fetch_fills(since_ms, until_ms))
    except RuntimeError as error:
        fills_ok = False
        print(f"[position-review] 成交明细同步失败，保留已有成交：{error}", flush=True)
    return closed, fills, fills_ok


def _persist_venue_sync(connection, venue, closed, opened, fills, fills_ok, synced_at, balance_key, balance_total):
    open_ids = {item["positionId"] for item in opened}
    for position in closed:
        _migrate_open_annotations(connection, position, closed)
        _upsert_exchange_position(connection, position, synced_at)
    _delete_unannotated_stale_open_positions(connection, venue, open_ids)
    for position in opened:
        _upsert_exchange_position(connection, position, synced_at)
    if fills_ok:
        for fill in fills:
            _upsert_position_fill(connection, fill, synced_at)
    connection.execute(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (f"{venue}_last_synced_at", synced_at),
    )
    connection.execute(
        "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (balance_key, json.dumps(balance_total)),
    )


def _sync_bitget_snapshot(now_ms):
    provider = venue_position_provider("bitget")
    closed, fills, fills_ok = _fetch_closed_and_fills(
        provider.fetch_closed_positions,
        provider.fetch_fills,
        now_ms,
    )
    opened = provider.fetch_open_positions()
    balance = provider.fetch_balance_usdt()
    return closed, opened, fills, fills_ok, balance


def _sync_gate_snapshot(now_ms):
    provider = venue_position_provider("gate")
    closed, fills, fills_ok = _fetch_closed_and_fills(
        provider.fetch_closed_positions,
        provider.fetch_fills,
        now_ms,
    )
    opened = provider.fetch_open_positions()
    balance = provider.fetch_balance_usdt()
    return closed, opened, fills, fills_ok, balance


def _sync_position_review():
    bitget_ready = bitget_credentials_configured()
    gate_ready = gate_credentials_configured()
    if not bitget_ready and not gate_ready:
        raise ValueError("尚未配置只读 API")
    now_ms = int(time.time() * 1000)
    snapshots = []
    sync_errors = []
    if bitget_ready:
        try:
            closed, opened, fills, fills_ok, balance = _sync_bitget_snapshot(now_ms)
            snapshots.append(
                {
                    "venue": "bitget",
                    "closed": closed,
                    "opened": opened,
                    "fills": fills,
                    "fillsOk": fills_ok,
                    "balance": balance,
                    "balanceKey": "bitget_usdt_total",
                }
            )
        except RuntimeError as error:
            sync_errors.append(f"Bitget: {error}")
            print(f"[position-review] Bitget 同步失败：{error}", flush=True)
    if gate_ready:
        try:
            closed, opened, fills, fills_ok, balance = _sync_gate_snapshot(now_ms)
            snapshots.append(
                {
                    "venue": "gate",
                    "closed": closed,
                    "opened": opened,
                    "fills": fills,
                    "fillsOk": fills_ok,
                    "balance": balance,
                    "balanceKey": "gate_usdt_total",
                }
            )
        except RuntimeError as error:
            sync_errors.append(f"Gate: {error}")
            print(f"[position-review] Gate 同步失败：{error}", flush=True)
    if not snapshots and sync_errors:
        raise RuntimeError("；".join(sync_errors))
    synced_at = datetime.now().astimezone().isoformat()
    closed_count = 0
    open_count = 0
    with DATABASE_LOCK, database() as connection:
        for snapshot in snapshots:
            _persist_venue_sync(
                connection,
                snapshot["venue"],
                snapshot["closed"],
                snapshot["opened"],
                snapshot["fills"],
                snapshot["fillsOk"],
                synced_at,
                snapshot["balanceKey"],
                snapshot["balance"].get("total"),
            )
            closed_count += len(snapshot["closed"])
            open_count += len(snapshot["opened"])
        connection.execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            ("position_review_last_synced_at", synced_at),
        )
    warning = "；".join(sync_errors) if sync_errors else None
    return {
        "configured": True,
        "syncedAt": synced_at,
        "closedCount": closed_count,
        "openCount": open_count,
        "balance": _combined_balance([item["balance"] for item in snapshots]),
        "venues": {
            "bitget": bitget_ready,
            "gate": gate_ready,
        },
        "warning": warning,
        "positions": list_position_review(),
        "tags": list_position_tags(),
    }


def _combined_balance(balances):
    totals = [
        item.get("total")
        for item in balances or []
        if isinstance(item, dict) and item.get("total") is not None
    ]
    if not totals:
        return None
    return {"total": sum(totals)}


def _read_position_tags(connection):
    rows = connection.execute(
        "SELECT id, name, color FROM position_tags ORDER BY name COLLATE NOCASE"
    ).fetchall()
    return [{"id": row["id"], "name": row["name"], "color": row["color"]} for row in rows]


def list_position_tags():
    with DATABASE_LOCK, database() as connection:
        return _read_position_tags(connection)


def create_position_tag(name):
    cleaned = str(name or "").strip()
    if not cleaned or len(cleaned) > 32:
        raise ValueError("标签名称为 1–32 个字符")
    color = TAG_COLORS[sum(ord(char) for char in cleaned) % len(TAG_COLORS)]
    with DATABASE_LOCK, database() as connection:
        try:
            connection.execute(
                "INSERT INTO position_tags (name, color) VALUES (?, ?)",
                (cleaned, color),
            )
        except sqlite3.IntegrityError as error:
            raise ValueError("标签已存在") from error
        row = connection.execute(
            "SELECT id, name, color FROM position_tags WHERE name = ?",
            (cleaned,),
        ).fetchone()
    return {"id": row["id"], "name": row["name"], "color": row["color"]}


def delete_position_tag(tag_id):
    try:
        cleaned_id = int(tag_id)
    except (TypeError, ValueError):
        raise ValueError("标签 ID 无效")
    if cleaned_id <= 0:
        raise ValueError("标签 ID 无效")
    with DATABASE_LOCK, database() as connection:
        connection.execute(
            "DELETE FROM position_tag_map WHERE tag_id = ?",
            (cleaned_id,),
        )
        connection.execute(
            "DELETE FROM position_tags WHERE id = ?",
            (cleaned_id,),
        )
    return {"ok": True}


def save_position_note(payload):
    venue = str(payload.get("venue") or POSITION_REVIEW_VENUE)
    position_id = str(payload.get("positionId") or "").strip()
    note = payload.get("note") or ""
    if not position_id or len(position_id) > 80:
        raise ValueError("仓位 ID 无效")
    if not isinstance(note, str) or len(note) > 20000:
        raise ValueError("备注过长")
    updated_at = datetime.now().astimezone().isoformat()
    with DATABASE_LOCK, database() as connection:
        exists = connection.execute(
            "SELECT 1 FROM exchange_positions WHERE venue = ? AND position_id = ?",
            (venue, position_id),
        ).fetchone()
        if exists is None:
            raise ValueError("仓位不存在")
        if note.strip():
            connection.execute(
                """INSERT INTO position_notes (venue, position_id, note, updated_at)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(venue, position_id) DO UPDATE SET
                     note = excluded.note, updated_at = excluded.updated_at""",
                (venue, position_id, note, updated_at),
            )
        else:
            connection.execute(
                "DELETE FROM position_notes WHERE venue = ? AND position_id = ?",
                (venue, position_id),
            )
    return {"ok": True, "updatedAt": updated_at}


def save_position_tag_map(payload):
    venue = str(payload.get("venue") or POSITION_REVIEW_VENUE)
    position_id = str(payload.get("positionId") or "").strip()
    tag_ids = payload.get("tagIds") or []
    if not position_id:
        raise ValueError("仓位 ID 无效")
    if not isinstance(tag_ids, list) or len(tag_ids) > 20:
        raise ValueError("标签数量无效")
    cleaned_ids = []
    seen_ids = set()
    for item in tag_ids:
        tag_id = int(item)
        if tag_id <= 0:
            raise ValueError("标签无效")
        if tag_id in seen_ids:
            continue
        seen_ids.add(tag_id)
        cleaned_ids.append(tag_id)
    with DATABASE_LOCK, database() as connection:
        exists = connection.execute(
            "SELECT 1 FROM exchange_positions WHERE venue = ? AND position_id = ?",
            (venue, position_id),
        ).fetchone()
        if exists is None:
            raise ValueError("仓位不存在")
        connection.execute(
            "DELETE FROM position_tag_map WHERE venue = ? AND position_id = ?",
            (venue, position_id),
        )
        for tag_id in cleaned_ids:
            tag_exists = connection.execute(
                "SELECT 1 FROM position_tags WHERE id = ?",
                (tag_id,),
            ).fetchone()
            if tag_exists is None:
                raise ValueError("标签不存在")
            connection.execute(
                "INSERT INTO position_tag_map (venue, position_id, tag_id) VALUES (?, ?, ?)",
                (venue, position_id, tag_id),
            )
    return {"ok": True, "tagIds": cleaned_ids}


def _clean_bitlang_trade_id(value):
    cleaned = str(value or "").strip().lower()
    if not BITLANG_TRADE_ID_RE.fullmatch(cleaned):
        raise ValueError("交易 ID 无效")
    return cleaned


def _read_bitlang_tags(connection):
    rows = connection.execute(
        "SELECT id, name, color FROM bitlang_trade_tags ORDER BY name COLLATE NOCASE"
    ).fetchall()
    return [{"id": row["id"], "name": row["name"], "color": row["color"]} for row in rows]


def get_bitlang_review_state():
    with DATABASE_LOCK, database() as connection:
        notes_rows = connection.execute(
            "SELECT trade_id, note FROM bitlang_trade_notes"
        ).fetchall()
        tags = _read_bitlang_tags(connection)
        map_rows = connection.execute(
            "SELECT trade_id, tag_id FROM bitlang_trade_tag_map ORDER BY tag_id"
        ).fetchall()
    notes = {row["trade_id"]: row["note"] for row in notes_rows}
    tag_map = {}
    for row in map_rows:
        tag_map.setdefault(row["trade_id"], []).append(row["tag_id"])
    return {"notes": notes, "tags": tags, "tagMap": tag_map}


def save_bitlang_note(payload):
    trade_id = _clean_bitlang_trade_id(payload.get("tradeId"))
    note = payload.get("note") or ""
    if not isinstance(note, str) or len(note) > 20000:
        raise ValueError("备注过长")
    updated_at = datetime.now().astimezone().isoformat()
    with DATABASE_LOCK, database() as connection:
        if note.strip():
            connection.execute(
                """INSERT INTO bitlang_trade_notes (trade_id, note, updated_at)
                   VALUES (?, ?, ?)
                   ON CONFLICT(trade_id) DO UPDATE SET
                     note = excluded.note, updated_at = excluded.updated_at""",
                (trade_id, note, updated_at),
            )
        else:
            connection.execute(
                "DELETE FROM bitlang_trade_notes WHERE trade_id = ?",
                (trade_id,),
            )
    return {"ok": True, "updatedAt": updated_at}


def create_bitlang_tag(name):
    cleaned = str(name or "").strip()
    if not cleaned or len(cleaned) > 32:
        raise ValueError("标签名称为 1–32 个字符")
    color = TAG_COLORS[sum(ord(char) for char in cleaned) % len(TAG_COLORS)]
    with DATABASE_LOCK, database() as connection:
        try:
            connection.execute(
                "INSERT INTO bitlang_trade_tags (name, color) VALUES (?, ?)",
                (cleaned, color),
            )
        except sqlite3.IntegrityError as error:
            raise ValueError("标签已存在") from error
        row = connection.execute(
            "SELECT id, name, color FROM bitlang_trade_tags WHERE name = ?",
            (cleaned,),
        ).fetchone()
    return {"id": row["id"], "name": row["name"], "color": row["color"]}


def delete_bitlang_tag(tag_id):
    try:
        cleaned_id = int(tag_id)
    except (TypeError, ValueError):
        raise ValueError("标签 ID 无效")
    if cleaned_id <= 0:
        raise ValueError("标签 ID 无效")
    with DATABASE_LOCK, database() as connection:
        connection.execute(
            "DELETE FROM bitlang_trade_tag_map WHERE tag_id = ?",
            (cleaned_id,),
        )
        connection.execute(
            "DELETE FROM bitlang_trade_tags WHERE id = ?",
            (cleaned_id,),
        )
    return {"ok": True}


def save_bitlang_tag_map(payload):
    trade_id = _clean_bitlang_trade_id(payload.get("tradeId"))
    tag_ids = payload.get("tagIds") or []
    if not isinstance(tag_ids, list) or len(tag_ids) > 20:
        raise ValueError("标签数量无效")
    cleaned_ids = []
    seen_ids = set()
    for item in tag_ids:
        tag_id = int(item)
        if tag_id <= 0:
            raise ValueError("标签无效")
        if tag_id in seen_ids:
            continue
        seen_ids.add(tag_id)
        cleaned_ids.append(tag_id)
    with DATABASE_LOCK, database() as connection:
        connection.execute(
            "DELETE FROM bitlang_trade_tag_map WHERE trade_id = ?",
            (trade_id,),
        )
        for tag_id in cleaned_ids:
            tag_exists = connection.execute(
                "SELECT 1 FROM bitlang_trade_tags WHERE id = ?",
                (tag_id,),
            ).fetchone()
            if tag_exists is None:
                raise ValueError("标签不存在")
            connection.execute(
                "INSERT INTO bitlang_trade_tag_map (trade_id, tag_id) VALUES (?, ?)",
                (trade_id, tag_id),
            )
    return {"ok": True, "tagIds": cleaned_ids}


def _validate_bitlang_drawing_scope(trade_id, symbol, interval):
    cleaned_trade_id = _clean_bitlang_trade_id(trade_id)
    cleaned_symbol = str(symbol or "").strip().upper()
    cleaned_interval = str(interval or "").strip()
    if not re.match(r"^[A-Z0-9]{3,20}USDT$", cleaned_symbol):
        raise ValueError("交易合约格式无效")
    if cleaned_interval not in VALID_INTERVALS:
        raise ValueError("不支持该 K 线周期")
    return cleaned_trade_id, cleaned_symbol, cleaned_interval


def save_bitlang_drawing(payload):
    if not isinstance(payload, dict):
        raise ValueError("画图记录必须是对象")
    trade_id, symbol, interval = _validate_bitlang_drawing_scope(
        payload.get("tradeId"),
        payload.get("symbol"),
        payload.get("interval"),
    )
    drawing, encoded = _validate_drawing_content(payload)
    now = datetime.now().astimezone().isoformat()
    with DATABASE_LOCK, database() as connection:
        existing = connection.execute(
            """SELECT created_at FROM bitlang_trade_drawings
               WHERE trade_id = ? AND id = ?""",
            (trade_id, drawing["id"]),
        ).fetchone()
        created_at = existing["created_at"] if existing else now
        connection.execute(
            """INSERT INTO bitlang_trade_drawings
               (trade_id, id, symbol, interval, tool_type, tool_json,
                created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(trade_id, id) DO UPDATE SET
                 symbol = excluded.symbol, interval = excluded.interval,
                 tool_type = excluded.tool_type, tool_json = excluded.tool_json,
                 updated_at = excluded.updated_at""",
            (
                trade_id,
                drawing["id"],
                symbol,
                interval,
                drawing["toolType"],
                encoded,
                created_at,
                now,
            ),
        )
    return {**drawing, "interval": interval}


def list_bitlang_drawings(trade_id, symbol, interval):
    trade_id, symbol, _interval = _validate_bitlang_drawing_scope(
        trade_id, symbol, interval
    )
    with DATABASE_LOCK, database() as connection:
        rows = connection.execute(
            """SELECT interval, tool_json FROM bitlang_trade_drawings
               WHERE trade_id = ? AND symbol = ?
               ORDER BY created_at ASC""",
            (trade_id, symbol),
        ).fetchall()
    return [
        {**json.loads(row["tool_json"]), "interval": row["interval"]}
        for row in rows
    ]


def replace_bitlang_drawings(payload):
    if not isinstance(payload, dict):
        raise ValueError("画图批量记录必须是对象")
    trade_id, symbol, interval = _validate_bitlang_drawing_scope(
        payload.get("tradeId"),
        payload.get("symbol"),
        payload.get("interval"),
    )
    drawings = payload.get("drawings")
    if not isinstance(drawings, list) or len(drawings) > 500:
        raise ValueError("画图批量记录无效")
    validated = []
    seen_ids = set()
    for item in drawings:
        if not isinstance(item, dict):
            raise ValueError("画图记录必须是对象")
        item_interval = str(item.get("interval", interval))
        if item_interval not in VALID_INTERVALS:
            raise ValueError("不支持该 K 线周期")
        drawing, encoded = _validate_drawing_content(item)
        if drawing["id"] in seen_ids:
            raise ValueError("画图 ID 重复")
        seen_ids.add(drawing["id"])
        validated.append((item_interval, drawing, encoded))

    now = datetime.now().astimezone().isoformat()
    with DATABASE_LOCK, database() as connection:
        created_times = {
            row["id"]: row["created_at"]
            for row in connection.execute(
                """SELECT id, created_at FROM bitlang_trade_drawings
                   WHERE trade_id = ?""",
                (trade_id,),
            ).fetchall()
        }
        connection.execute(
            "DELETE FROM bitlang_trade_drawings WHERE trade_id = ?",
            (trade_id,),
        )
        connection.executemany(
            """INSERT INTO bitlang_trade_drawings
               (trade_id, id, symbol, interval, tool_type, tool_json,
                created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    trade_id,
                    drawing["id"],
                    symbol,
                    item_interval,
                    drawing["toolType"],
                    encoded,
                    created_times.get(drawing["id"], now),
                    now,
                )
                for item_interval, drawing, encoded in validated
            ],
        )
    return [
        {**drawing, "interval": item_interval}
        for item_interval, drawing, _encoded in validated
    ]


def delete_bitlang_drawings(query):
    drawing_id = str(query.get("id", [""])[0]).strip()
    trade_id, symbol, interval = _validate_bitlang_drawing_scope(
        query.get("tradeId", [""])[0],
        query.get("symbol", [""])[0],
        query.get("interval", [""])[0],
    )
    if drawing_id and (
        len(drawing_id) > 100 or drawing_id.startswith(SYSTEM_DRAWING_PREFIX)
    ):
        raise ValueError("画图 ID 无效")
    with DATABASE_LOCK, database() as connection:
        if drawing_id:
            connection.execute(
                """DELETE FROM bitlang_trade_drawings
                   WHERE trade_id = ? AND id = ?""",
                (trade_id, drawing_id),
            )
            return
        connection.execute(
            "DELETE FROM bitlang_trade_drawings WHERE trade_id = ?",
            (trade_id,),
        )


def _read_position_review(connection):
    rows = connection.execute(
        """SELECT p.*, n.note,
                  GROUP_CONCAT(m.tag_id) AS tag_ids
           FROM exchange_positions p
           LEFT JOIN position_notes n
             ON n.venue = p.venue AND n.position_id = p.position_id
           LEFT JOIN position_tag_map m
             ON m.venue = p.venue AND m.position_id = p.position_id
           WHERE p.status <> 'stale'
           GROUP BY p.venue, p.position_id
           ORDER BY COALESCE(p.exit_time_ms, p.entry_time_ms) DESC"""
    ).fetchall()
    fill_rows = connection.execute(
        """SELECT venue, exec_id, order_id, chart_symbol, unified_symbol, side, trade_side,
                  price, quantity, pnl, fee, time_ms
           FROM position_fills
           ORDER BY time_ms ASC"""
    ).fetchall()
    positions = []
    for row in rows:
        tag_ids = []
        if row["tag_ids"]:
            tag_ids = [int(item) for item in str(row["tag_ids"]).split(",") if item]
        positions.append(
            {
                "venue": row["venue"],
                "positionId": row["position_id"],
                "unifiedSymbol": row["unified_symbol"],
                "chartSymbol": row["chart_symbol"],
                "side": row["side"],
                "status": row["status"],
                "entryPrice": row["entry_price"],
                "exitPrice": row["exit_price"],
                "contracts": row["contracts"],
                "leverage": row["leverage"],
                "marginMode": row["margin_mode"],
                "hedged": bool(row["hedged"]),
                "realizedPnl": row["realized_pnl"],
                "netPnl": row["net_pnl"],
                "funding": row["funding"],
                "openFee": row["open_fee"],
                "closeFee": row["close_fee"],
                "entryTimeMs": row["entry_time_ms"],
                "exitTimeMs": row["exit_time_ms"],
                "note": row["note"] or "",
                "tagIds": tag_ids,
            }
        )
    grouped = assign_fills_to_positions(
        positions, [_fill_from_row(row) for row in fill_rows]
    )
    for position in positions:
        pos_key = (position.get("venue"), position["positionId"])
        position["fills"] = grouped.get(pos_key) or grouped.get(position["positionId"], [])
    return positions


def list_position_review():
    with DATABASE_LOCK, database() as connection:
        return _read_position_review(connection)


def get_position_review_state():
    with DATABASE_LOCK, database() as connection:
        settings = {
            row["key"]: row["value"]
            for row in connection.execute(
                """SELECT key, value FROM app_settings
                   WHERE key IN (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    "bitget_api_key_enc",
                    "bitget_api_secret_enc",
                    "bitget_api_passphrase_enc",
                    "bitget_last_synced_at",
                    "bitget_usdt_total",
                    "gate_api_key_enc",
                    "gate_api_secret_enc",
                    "gate_last_synced_at",
                    "gate_usdt_total",
                    "position_review_last_synced_at",
                ),
            ).fetchall()
        }
        positions = _read_position_review(connection)
        tags = _read_position_tags(connection)

    def _parse_usdt(raw):
        if raw in (None, ""):
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    bitget_configured = bool(
        settings.get("bitget_api_key_enc")
        and settings.get("bitget_api_secret_enc")
        and settings.get("bitget_api_passphrase_enc")
    )
    gate_configured = bool(
        settings.get("gate_api_key_enc") and settings.get("gate_api_secret_enc")
    )
    bitget_total = _parse_usdt(settings.get("bitget_usdt_total"))
    gate_total = _parse_usdt(settings.get("gate_usdt_total"))
    combined = _combined_balance(
        [
            {"total": bitget_total} if bitget_total is not None else {},
            {"total": gate_total} if gate_total is not None else {},
        ]
    )
    return {
        "configured": bitget_configured or gate_configured,
        "venues": {
            "bitget": bitget_configured,
            "gate": gate_configured,
        },
        "syncedAt": _later_timestamp(
            settings.get("position_review_last_synced_at"),
            settings.get("bitget_last_synced_at"),
            settings.get("gate_last_synced_at"),
        ),
        "balance": combined,
        "balances": {
            "bitget": {"total": bitget_total} if bitget_total is not None else None,
            "gate": {"total": gate_total} if gate_total is not None else None,
        },
        "positions": positions,
        "tags": tags,
    }


def resolve_position_candle_venue(symbol, preferred_venue=None):
    # 仓位复盘：BTCUSDT / ETHUSDT 固定走 Bybit；其余走该仓位所属交易所。
    # 未带 venue 时仍按 Bybit 目录决定，避免把主流合约误送到本所。
    compact = str(symbol or "").strip().upper()
    preferred = str(preferred_venue or "").strip().lower()
    if compact in POSITION_REVIEW_BYBIT_CANDLE_SYMBOLS:
        return "bybit"
    if preferred in POSITION_REVIEW_VENUES:
        return preferred
    presence = MARKET_DATA_PROVIDER.usdt_perpetual_presence(compact)
    if presence == "absent":
        return "bitget"
    return "bybit"


def venue_market_fetch_lock(venue, symbol, interval):
    key = (venue, symbol, interval)
    with MARKET_FETCH_LOCKS_GUARD:
        return VENUE_MARKET_FETCH_LOCKS.setdefault(key, threading.Lock())


def missing_venue_cached_ranges(venue, symbol, interval, start_timestamp, end_timestamp):
    with DATABASE_LOCK, database() as connection:
        rows = connection.execute(
            """SELECT start_timestamp, end_timestamp
               FROM venue_market_cache_ranges
               WHERE venue = ? AND symbol = ? AND interval = ?
               ORDER BY start_timestamp ASC""",
            (venue, symbol, interval),
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


def merge_venue_market_cache_range(
    connection,
    venue,
    symbol,
    interval,
    start_timestamp,
    end_timestamp,
    fetched_at,
):
    merged_start = start_timestamp
    merged_end = end_timestamp
    while True:
        overlapping_ranges = connection.execute(
            """SELECT start_timestamp, end_timestamp
               FROM venue_market_cache_ranges
               WHERE venue = ? AND symbol = ? AND interval = ?
                 AND end_timestamp >= ? AND start_timestamp <= ?""",
            (venue, symbol, interval, merged_start - 1, merged_end + 1),
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
        """DELETE FROM venue_market_cache_ranges
           WHERE venue = ? AND symbol = ? AND interval = ?
             AND end_timestamp >= ? AND start_timestamp <= ?""",
        (venue, symbol, interval, merged_start - 1, merged_end + 1),
    )
    connection.execute(
        """INSERT INTO venue_market_cache_ranges
           (venue, symbol, interval, start_timestamp, end_timestamp, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (venue, symbol, interval, merged_start, merged_end, fetched_at),
    )


def save_venue_candles(venue, symbol, interval, start_timestamp, end_timestamp, candles):
    fetched_at = datetime.now().astimezone().isoformat()
    coverage_ranges = market_cache_coverage_ranges(
        interval,
        start_timestamp,
        end_timestamp,
        candles,
    )
    with DATABASE_LOCK, database() as connection:
        connection.executemany(
            """INSERT INTO venue_market_candles
               (venue, symbol, interval, timestamp, open, high, low, close, volume)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(venue, symbol, interval, timestamp) DO UPDATE SET
                 open = excluded.open, high = excluded.high, low = excluded.low,
                 close = excluded.close, volume = excluded.volume""",
            [(venue, *candle) for candle in candles],
        )
        for range_start, range_end in coverage_ranges:
            merge_venue_market_cache_range(
                connection,
                venue,
                symbol,
                interval,
                range_start,
                range_end,
                fetched_at,
            )


def list_venue_candles(venue, symbol, interval, start_timestamp, end_timestamp):
    with database() as connection:
        rows = connection.execute(
            """SELECT timestamp, open, high, low, close, volume
               FROM venue_market_candles
               WHERE venue = ? AND symbol = ? AND interval = ?
                 AND timestamp BETWEEN ? AND ?
               ORDER BY timestamp ASC""",
            (venue, symbol, interval, start_timestamp, end_timestamp),
        ).fetchall()
    return [
        {
            "timestamp": row[0],
            "open": row[1],
            "high": row[2],
            "low": row[3],
            "close": row[4],
            "volume": row[5],
        }
        for row in rows
    ]


def _invalidate_venue_provider(venue):
    with VENUE_POSITION_PROVIDERS_LOCK:
        VENUE_POSITION_PROVIDERS.pop(venue, None)


def venue_position_provider(venue):
    if venue not in POSITION_REVIEW_VENUES:
        venue = "bitget"
    with VENUE_POSITION_PROVIDERS_LOCK:
        cached = VENUE_POSITION_PROVIDERS.get(venue)
        if cached is not None:
            return cached
        if venue == "gate":
            credentials = load_gate_credentials()
            provider = GateUsdtPositionProvider(
                credentials["apiKey"],
                credentials["secret"],
            )
        else:
            credentials = load_bitget_credentials()
            provider = BitgetUtaPositionProvider(
                credentials["apiKey"],
                credentials["secret"],
                credentials["password"],
            )
        VENUE_POSITION_PROVIDERS[venue] = provider
        return provider


def warm_up_venue_market_providers():
    if gate_credentials_configured():
        try:
            venue_position_provider("gate").warm_up_markets()
            print("[market] CCXT Gate 市场信息预热完成", flush=True)
        except (ValueError, RuntimeError) as error:
            print(f"[market] Gate 市场信息预热失败：{error}", flush=True)
    if bitget_credentials_configured():
        try:
            venue_position_provider("bitget").warm_up_markets()
            print("[market] CCXT Bitget 市场信息预热完成", flush=True)
        except (ValueError, RuntimeError) as error:
            print(f"[market] Bitget 市场信息预热失败：{error}", flush=True)


def _fallback_candle_provider(venue):
    return venue_position_provider(venue)


def load_venue_candle_range(venue, symbol, interval, start_timestamp, end_timestamp):
    if venue not in POSITION_REVIEW_VENUES:
        venue = "bitget"
    fetch_key = (venue, symbol, interval)
    missing_ranges = missing_venue_cached_ranges(
        venue, symbol, interval, start_timestamp, end_timestamp
    )
    warning = ""
    source = "sqlite"
    if missing_ranges:
        with venue_market_fetch_lock(venue, symbol, interval):
            missing_ranges = missing_venue_cached_ranges(
                venue, symbol, interval, start_timestamp, end_timestamp
            )
            if missing_ranges:
                failed_at, failed_message = VENUE_MARKET_FETCH_FAILURES.get(
                    fetch_key, (0, "")
                )
                if failed_message and time.monotonic() - failed_at < FETCH_FAILURE_COOLDOWN_SECONDS:
                    warning = f"{failed_message}（稍后再试，避免重复等待）"
                else:
                    try:
                        provider = _fallback_candle_provider(venue)
                        interval_milliseconds = INTERVAL_MILLISECONDS[interval]
                        if venue == "gate":
                            chunk_limit = 1000
                        else:
                            max_bars = max(
                                1,
                                BITGET_CANDLE_MAX_RANGE_MS // interval_milliseconds,
                            )
                            chunk_limit = min(200, max_bars)
                        for missing_start, missing_end in missing_ranges:
                            for chunk_start, chunk_end in market_range_chunks(
                                interval, missing_start, missing_end, limit=chunk_limit
                            ):
                                fetched = provider.fetch_candles(
                                    symbol,
                                    interval,
                                    interval_milliseconds,
                                    chunk_start,
                                    chunk_end,
                                )
                                save_venue_candles(
                                    venue,
                                    symbol,
                                    interval,
                                    chunk_start,
                                    chunk_end,
                                    fetched,
                                )
                        VENUE_MARKET_FETCH_FAILURES.pop(fetch_key, None)
                        source = venue
                    except (ValueError, RuntimeError) as error:
                        VENUE_MARKET_FETCH_FAILURES[fetch_key] = (
                            time.monotonic(),
                            str(error),
                        )
                        warning = str(error)
    candles = list_venue_candles(venue, symbol, interval, start_timestamp, end_timestamp)
    return candles, source, warning


def load_bitget_candle_range(symbol, interval, start_timestamp, end_timestamp):
    return load_venue_candle_range(
        "bitget", symbol, interval, start_timestamp, end_timestamp
    )


def load_position_review_candles(
    symbol, interval, entry_timestamp, exit_timestamp, preferred_venue=None
):
    if not isinstance(symbol, str) or not re.fullmatch(r"[A-Z0-9]{3,20}USDT", symbol):
        raise ValueError("仓位交易对无法映射为 USDT 永续合约")
    if interval not in VALID_INTERVALS:
        raise ValueError("不支持该 K 线周期")
    now_timestamp = int(time.time() * 1000)
    if entry_timestamp < 1_230_768_000_000:
        raise ValueError("仓位开仓时间无效")
    if exit_timestamp is None or exit_timestamp <= 0:
        exit_timestamp = now_timestamp
    if exit_timestamp < entry_timestamp:
        raise ValueError("仓位平仓时间无效")
    exit_timestamp = min(exit_timestamp, now_timestamp)
    start_timestamp, end_timestamp, truncated = trade_candle_window(
        entry_timestamp, exit_timestamp, interval, now_timestamp
    )
    candle_venue = resolve_position_candle_venue(symbol, preferred_venue)
    print(
        f"[market] position-review {symbol} {interval} venue={candle_venue}",
        flush=True,
    )
    if candle_venue == "bybit":
        candles, source, warning = load_candle_range(
            symbol, interval, start_timestamp, end_timestamp
        )
        return {
            "candles": candles,
            "source": source,
            "candleVenue": "bybit",
            "warning": warning,
            "truncated": truncated,
            "entry": entry_timestamp,
            "exit": exit_timestamp,
        }
    candles, source, warning = load_venue_candle_range(
        candle_venue, symbol, interval, start_timestamp, end_timestamp
    )
    if warning and not candles:
        presence = MARKET_DATA_PROVIDER.usdt_perpetual_presence(symbol)
        if presence == "present":
            bybit_candles, bybit_source, bybit_warning = load_candle_range(
                symbol, interval, start_timestamp, end_timestamp
            )
            if bybit_candles:
                fallback_warning = f"本所 {candle_venue} K 线不可用，已回退 Bybit"
                if warning:
                    fallback_warning = f"{fallback_warning}（{warning}）"
                if bybit_warning:
                    fallback_warning = f"{fallback_warning}；{bybit_warning}"
                print(
                    f"[market] position-review {symbol} {interval} venue=bybit fallback",
                    flush=True,
                )
                return {
                    "candles": bybit_candles,
                    "source": bybit_source,
                    "candleVenue": "bybit",
                    "warning": fallback_warning,
                    "truncated": truncated,
                    "entry": entry_timestamp,
                    "exit": exit_timestamp,
                }
    return {
        "candles": candles,
        "source": source,
        "candleVenue": candle_venue,
        "warning": warning,
        "truncated": truncated,
        "entry": entry_timestamp,
        "exit": exit_timestamp,
    }


def audit_venue_market_cache(sample_limit=200):
    inconsistent = []
    consistent_count = 0
    inconsistent_total = 0
    with DATABASE_LOCK, database() as connection:
        range_count = int(
            connection.execute(
                "SELECT COUNT(*) FROM venue_market_cache_ranges"
            ).fetchone()[0]
        )
        ranges = connection.execute(
            """SELECT venue, symbol, interval, start_timestamp, end_timestamp, fetched_at
               FROM venue_market_cache_ranges
               ORDER BY fetched_at DESC, venue, symbol, interval, start_timestamp
               LIMIT ?""",
            (CACHE_AUDIT_MAX_RANGES,),
        ).fetchall()
        audited_range_count = len(ranges)
        for row in ranges:
            venue = row["venue"]
            symbol = row["symbol"]
            interval = row["interval"]
            start_timestamp = int(row["start_timestamp"])
            end_timestamp = int(row["end_timestamp"])
            interval_ms = INTERVAL_MILLISECONDS.get(interval)
            issues = []
            if end_timestamp < start_timestamp:
                issues.append("invalid_range")
                timestamps = []
            elif not interval_ms:
                issues.append("unknown_interval")
                timestamps = []
            else:
                expected_candle_count = math.ceil(
                    (end_timestamp - start_timestamp + 1) / interval_ms
                )
                if expected_candle_count > CACHE_AUDIT_MAX_CANDLES_PER_RANGE:
                    issues.append("range_scan_limit_exceeded")
                    timestamps = []
                else:
                    candle_rows = connection.execute(
                        """SELECT timestamp FROM venue_market_candles
                           WHERE venue = ? AND symbol = ? AND interval = ?
                             AND timestamp BETWEEN ? AND ?
                           ORDER BY timestamp ASC
                           LIMIT ?""",
                        (
                            venue,
                            symbol,
                            interval,
                            start_timestamp,
                            end_timestamp,
                            CACHE_AUDIT_MAX_CANDLES_PER_RANGE,
                        ),
                    ).fetchall()
                    timestamps = [int(item["timestamp"]) for item in candle_rows]
                    if not timestamps:
                        issues.append("range_empty")
                    else:
                        if timestamps[0] > start_timestamp:
                            issues.append("starts_late")
                        if timestamps[-1] + interval_ms - 1 < end_timestamp:
                            issues.append("ends_early")
                        gap_count = 0
                        for index in range(1, len(timestamps)):
                            if timestamps[index] - timestamps[index - 1] > interval_ms:
                                gap_count += 1
                        if gap_count:
                            issues.append(f"internal_gaps:{gap_count}")
            if issues:
                inconsistent_total += 1
                if len(inconsistent) < sample_limit:
                    inconsistent.append(
                        {
                            "venue": venue,
                            "symbol": symbol,
                            "interval": interval,
                            "startTimestamp": start_timestamp,
                            "endTimestamp": end_timestamp,
                            "candleCount": len(timestamps),
                            "issues": issues,
                            "fetchedAt": row["fetched_at"],
                        }
                    )
            else:
                consistent_count += 1
    return {
        "readOnly": True,
        "repaired": False,
        "rangeCount": range_count,
        "auditedRangeCount": audited_range_count,
        "scanTruncated": audited_range_count < range_count,
        "consistentCount": consistent_count,
        "inconsistentCount": inconsistent_total,
        "inconsistent": inconsistent,
    }


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
                    "version": API_VERSION,
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
                        "perpetualSymbolSearch",
                        "positionReview",
                        "affiliateInvites",
                        "genericVideoImport",
                    ],
                },
            )
        if parsed.path == "/api/symbols/search":
            try:
                limit = int(query.get("limit", ["20"])[0])
                return self.send_json(
                    HTTPStatus.OK,
                    search_perpetual_symbols(query.get("q", [""])[0], limit),
                )
            except ValueError as error:
                return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
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
        if parsed.path == "/api/settings":
            return self.send_json(HTTPStatus.OK, get_workspace_settings())
        if parsed.path == "/api/videos/source":
            return self.send_json(
                HTTPStatus.OK, video_catalog.describe_catalog_source(ROOT)
            )
        if parsed.path == "/api/bitlang-review":
            return self.send_json(HTTPStatus.OK, get_bitlang_review_state())
        if parsed.path == "/api/bitlang-review/drawings":
            try:
                drawings = list_bitlang_drawings(
                    query.get("tradeId", [""])[0],
                    query.get("symbol", [""])[0],
                    query.get("interval", [""])[0],
                )
                return self.send_json(HTTPStatus.OK, {"drawings": drawings})
            except ValueError as error:
                return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
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
        if parsed.path == "/api/position-review":
            return self.send_json(HTTPStatus.OK, get_position_review_state())
        if parsed.path == "/api/position-review/cache-audit":
            return self.send_json(HTTPStatus.OK, audit_venue_market_cache())
        if parsed.path == "/api/position-review/candles":
            try:
                symbol = query.get("symbol", [""])[0]
                interval = query.get("interval", [""])[0]
                entry = int(query.get("entry", ["0"])[0])
                exit_timestamp = int(query.get("exit", ["0"])[0])
                preferred_venue = query.get("venue", [""])[0]
                return self.send_json(
                    HTTPStatus.OK,
                    load_position_review_candles(
                        symbol,
                        interval,
                        entry,
                        exit_timestamp,
                        preferred_venue,
                    ),
                )
            except ValueError as error:
                return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except RuntimeError as error:
                return self.send_json(HTTPStatus.BAD_GATEWAY, {"error": str(error)})
        if parsed.path == "/api/position-review/drawings":
            try:
                drawings = list_position_drawings(
                    query.get("venue", [POSITION_REVIEW_VENUE])[0],
                    query.get("positionId", [""])[0],
                    query.get("symbol", [""])[0],
                    query.get("interval", [""])[0],
                )
                return self.send_json(HTTPStatus.OK, {"drawings": drawings})
            except ValueError as error:
                return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
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
            except ValueError as error:
                return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except RuntimeError as error:
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
            if parsed.path == "/api/position-review/drawings":
                return self.send_json(HTTPStatus.OK, save_position_drawing(payload))
            if parsed.path == "/api/position-review/credentials":
                return self.send_json(
                    HTTPStatus.OK, save_position_review_credentials(payload)
                )
            if parsed.path == "/api/position-review/sync":
                return self.send_json(HTTPStatus.OK, sync_position_review())
            if parsed.path == "/api/videos/refresh":
                return self.send_json(HTTPStatus.OK, refresh_learning_videos(payload))
            if parsed.path == "/api/settings/invites":
                return self.send_json(HTTPStatus.OK, save_invite_urls(payload))
            if parsed.path == "/api/position-review/notes":
                return self.send_json(HTTPStatus.OK, save_position_note(payload))
            if parsed.path == "/api/position-review/tags":
                return self.send_json(
                    HTTPStatus.CREATED,
                    create_position_tag(payload.get("name")),
                )
            if parsed.path == "/api/position-review/position-tags":
                return self.send_json(HTTPStatus.OK, save_position_tag_map(payload))
            if parsed.path == "/api/position-review/tags/delete":
                tag_id = payload.get("id") or payload.get("tagId")
                delete_position_tag(int(tag_id))
                return self.send_json(HTTPStatus.OK, {"ok": True})
            if parsed.path == "/api/bitlang-review/notes":
                return self.send_json(HTTPStatus.OK, save_bitlang_note(payload))
            if parsed.path == "/api/bitlang-review/tags":
                return self.send_json(
                    HTTPStatus.CREATED,
                    create_bitlang_tag(payload.get("name")),
                )
            if parsed.path == "/api/bitlang-review/trade-tags":
                return self.send_json(HTTPStatus.OK, save_bitlang_tag_map(payload))
            if parsed.path == "/api/bitlang-review/drawings":
                return self.send_json(HTTPStatus.OK, save_bitlang_drawing(payload))
            if parsed.path == "/api/bitlang-review/tags/delete":
                tag_id = payload.get("id") or payload.get("tagId")
                delete_bitlang_tag(int(tag_id))
                return self.send_json(HTTPStatus.OK, {"ok": True})
        except SyncInProgressError as error:
            return self.send_json(HTTPStatus.CONFLICT, {"error": str(error)})
        except (ValueError, TypeError, OverflowError, AttributeError, json.JSONDecodeError) as error:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except RuntimeError as error:
            return self.send_json(HTTPStatus.BAD_GATEWAY, {"error": str(error)})
        return self.send_error(HTTPStatus.NOT_FOUND)

    def do_PUT(self):
        path = urlparse(self.path).path
        if path == "/api/chart/drawings":
            try:
                payload = self.read_json_body()
                return self.send_json(HTTPStatus.OK, {"drawings": replace_drawings(payload)})
            except (ValueError, json.JSONDecodeError, AttributeError) as error:
                return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        if path == "/api/position-review/drawings":
            try:
                payload = self.read_json_body()
                return self.send_json(
                    HTTPStatus.OK,
                    {"drawings": replace_position_drawings(payload)},
                )
            except (ValueError, json.JSONDecodeError, AttributeError) as error:
                return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        if path == "/api/bitlang-review/drawings":
            try:
                payload = self.read_json_body()
                return self.send_json(
                    HTTPStatus.OK,
                    {"drawings": replace_bitlang_drawings(payload)},
                )
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
        if not video_id or "/" in video_id or len(video_id) > 100:
            return self.send_error(HTTPStatus.BAD_REQUEST, "无效的视频 ID")
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8")) if length else None
            update_learning_state(video_id, payload)
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
            if parsed.path == "/api/position-review/tags":
                raw_id = query.get("id", [None])[0]
                if raw_id is None:
                    payload = self.read_json_body()
                    raw_id = payload.get("id") or payload.get("tagId")
                delete_position_tag(int(raw_id))
                return self.send_json(HTTPStatus.OK, {"ok": True})
            if parsed.path == "/api/bitlang-review/tags":
                raw_id = query.get("id", [None])[0]
                if raw_id is None:
                    payload = self.read_json_body()
                    raw_id = payload.get("id") or payload.get("tagId")
                delete_bitlang_tag(int(raw_id))
                return self.send_json(HTTPStatus.OK, {"ok": True})
            if parsed.path == "/api/position-review/drawings":
                delete_position_drawings(query)
                return self.send_json(HTTPStatus.OK, {"ok": True})
            if parsed.path == "/api/bitlang-review/drawings":
                delete_bitlang_drawings(query)
                return self.send_json(HTTPStatus.OK, {"ok": True})
            if parsed.path != "/api/chart/drawings":
                return self.send_error(HTTPStatus.NOT_FOUND)
            delete_drawings(query)
            return self.send_json(HTTPStatus.OK, {"ok": True})
        except (ValueError, TypeError) as error:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length).decode("utf-8")) if length else {}

    def send_json(self, status, payload):
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        accept_encoding = self.headers.get("Accept-Encoding", "")
        if "gzip" in accept_encoding and len(content) > 1024:
            compressed = gzip.compress(content, compresslevel=6)
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(compressed)))
            self.end_headers()
            self.wfile.write(compressed)
            return

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
