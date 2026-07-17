import json
import math
import os
import shutil
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urlencode, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
STATE_FILE = ROOT / "learning-state.json"
DEFAULT_DATABASE_FILE = ROOT / "tiabtc-review.sqlite"
DATABASE_FILE = DEFAULT_DATABASE_FILE
SEED_DATABASE_FILE = ROOT / "data" / "tiabtc-review-seed.sqlite"
HOST = "127.0.0.1"
PORT = 8765
VALID_STATUSES = {"unlearned", "learning", "learned"}
VALID_SYMBOLS = {"BTCUSDT", "ETHUSDT"}
VALID_INTERVALS = {"5", "15", "60", "240", "D", "W"}
VALID_DRAWING_TYPES = {
    "TrendLine", "HorizontalLine", "FibRetracement", "Ray",
    "ExtendedLine", "Arrow", "Rectangle", "ParallelChannel",
}
DRAWING_POINT_COUNTS = {
    "TrendLine": 2, "HorizontalLine": 1, "FibRetracement": 2, "Ray": 2,
    "ExtendedLine": 2, "Arrow": 2, "Rectangle": 2, "ParallelChannel": 3,
}
SYSTEM_DRAWING_PREFIX = "__system__:"
MAX_DRAWING_JSON_BYTES = 200_000
INTERVAL_MILLISECONDS = {
    "5": 5 * 60_000,
    "15": 15 * 60_000,
    "60": 60 * 60_000,
    "240": 4 * 60 * 60_000,
    "D": 24 * 60 * 60_000,
    "W": 7 * 24 * 60 * 60_000,
}
DATABASE_LOCK = threading.RLock()


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
    connection.execute("PRAGMA journal_mode=WAL")
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
            INSERT OR IGNORE INTO app_settings (key, value) VALUES ('future_days', '3');
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
            connection.executescript(
                """
                DROP TABLE chart_drawings;
                CREATE TABLE chart_drawings (
                    id TEXT PRIMARY KEY,
                    video_id TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    interval TEXT NOT NULL,
                    tool_type TEXT NOT NULL,
                    tool_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )
        connection.execute("DROP INDEX IF EXISTS idx_chart_drawings_scope")
        connection.execute(
            "CREATE INDEX idx_chart_drawings_scope ON chart_drawings (video_id, symbol)"
        )


def get_future_days():
    with DATABASE_LOCK, database() as connection:
        row = connection.execute("SELECT value FROM app_settings WHERE key = 'future_days'").fetchone()
    try:
        return min(30, max(0, int(row["value"]))) if row else 3
    except (TypeError, ValueError):
        return 3


def set_future_days(value):
    if isinstance(value, bool):
        raise ValueError("未来天数必须是 0–30 的整数")
    days = int(value)
    if days < 0 or days > 30:
        raise ValueError("未来天数必须是 0–30 的整数")
    with DATABASE_LOCK, database() as connection:
        connection.execute(
            "INSERT INTO app_settings (key, value) VALUES ('future_days', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (str(days),),
        )
    return days


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
    if symbol not in VALID_SYMBOLS:
        raise ValueError("仅支持 BTCUSDT 和 ETHUSDT")
    if interval not in VALID_INTERVALS:
        raise ValueError("不支持该 K 线周期")


def cached_range_contains(symbol, interval, start_timestamp, end_timestamp):
    with DATABASE_LOCK, database() as connection:
        rows = connection.execute(
            """SELECT start_timestamp, end_timestamp FROM market_cache_ranges
               WHERE symbol = ? AND interval = ?
                 AND end_timestamp >= ? AND start_timestamp <= ?
               ORDER BY start_timestamp ASC""",
            (symbol, interval, start_timestamp, end_timestamp),
        ).fetchall()
    covered_until = start_timestamp - 1
    for row in rows:
        range_start = int(row["start_timestamp"])
        range_end = int(row["end_timestamp"])
        if range_start > covered_until + 1:
            return False
        covered_until = max(covered_until, range_end)
        if covered_until >= end_timestamp:
            return True
    return False


def fetch_bybit_candles(symbol, interval, start_timestamp, end_timestamp):
    candles = []
    cursor_end = end_timestamp
    while cursor_end >= start_timestamp:
        query = urlencode(
            {
                "category": "linear",
                "symbol": symbol,
                "interval": interval,
                "start": start_timestamp,
                "end": cursor_end,
                "limit": 1000,
            }
        )
        request = Request(
            f"https://api.bybit.com/v5/market/kline?{query}",
            headers={"Accept": "application/json", "User-Agent": "TiaBTC-Learning-Workspace/1.0"},
        )
        try:
            with urlopen(request, timeout=20) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError) as error:
            raise RuntimeError(f"Bybit K 线请求失败：{error}") from error
        if payload.get("retCode") != 0:
            raise RuntimeError(payload.get("retMsg") or "Bybit K 线请求失败")
        rows = payload.get("result", {}).get("list", [])
        if not rows:
            break
        page = [
            (
                symbol,
                interval,
                int(row[0]),
                float(row[1]),
                float(row[2]),
                float(row[3]),
                float(row[4]),
                float(row[5]),
            )
            for row in rows
            if len(row) >= 6 and start_timestamp <= int(row[0]) <= end_timestamp
        ]
        candles.extend(page)
        earliest = min(int(row[0]) for row in rows)
        if len(rows) < 1000 or earliest <= start_timestamp:
            break
        cursor_end = earliest - 1
    return candles


def save_candles(symbol, interval, start_timestamp, end_timestamp, candles):
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
        connection.execute(
            """INSERT OR REPLACE INTO market_cache_ranges
               (symbol, interval, start_timestamp, end_timestamp, fetched_at)
               VALUES (?, ?, ?, ?, ?)""",
            (symbol, interval, start_timestamp, end_timestamp, datetime.now().astimezone().isoformat()),
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


def load_candle_range(symbol, interval, start_timestamp, end_timestamp, offline=None):
    source = "sqlite"
    warning = ""
    offline = get_offline_mode() if offline is None else offline
    covered = cached_range_contains(symbol, interval, start_timestamp, end_timestamp)
    if not covered and not offline:
        try:
            fetched = fetch_bybit_candles(symbol, interval, start_timestamp, end_timestamp)
            save_candles(symbol, interval, start_timestamp, end_timestamp, fetched)
            source = "bybit"
        except RuntimeError as error:
            warning = str(error)
    candles = list_candles(symbol, interval, start_timestamp, end_timestamp)
    if offline and not covered:
        warning = "仅本地模式：该时间范围的缓存不完整"
    if not candles and warning:
        raise RuntimeError(warning)
    return candles, source, warning


def load_chart_candles(symbol, interval, anchor_timestamp, future_days):
    validate_market_scope(symbol, interval)
    if anchor_timestamp < 1_500_000_000_000 or anchor_timestamp > int(time.time() * 1000) + 31 * 86_400_000:
        raise ValueError("视频时间无效")
    requested_cutoff = anchor_timestamp + future_days * 86_400_000
    effective_cutoff = min(requested_cutoff, int(time.time() * 1000))
    start_timestamp = anchor_timestamp - INTERVAL_MILLISECONDS[interval] * 500
    candles, source, warning = load_candle_range(symbol, interval, start_timestamp, effective_cutoff)
    return {
        "candles": candles,
        "anchor": anchor_timestamp,
        "requestedCutoff": requested_cutoff,
        "effectiveCutoff": effective_cutoff,
        "futureDays": future_days,
        "source": source,
        "warning": warning,
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
    if not isinstance(points, list) or len(points) != expected:
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
    return drawing


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
        drawing_payload = {**drawing, "videoId": video_id, "symbol": symbol, "interval": interval}
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
                "SELECT id, created_at FROM chart_drawings WHERE video_id = ? AND symbol = ?",
                (video_id, symbol),
            ).fetchall()
        }
        connection.execute(
            "DELETE FROM chart_drawings WHERE video_id = ? AND symbol = ?",
            (video_id, symbol),
        )
        connection.executemany(
            """INSERT INTO chart_drawings
               (id, video_id, symbol, interval, tool_type, tool_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    drawing["id"], item_video, item_symbol, item_interval,
                    drawing["toolType"], encoded, created_times.get(drawing["id"], now), now,
                )
                for item_video, item_symbol, item_interval, drawing, encoded in validated
            ],
        )
    return [item[3] for item in validated]


def list_drawings(video_id, symbol, interval):
    validate_market_scope(symbol, interval)
    if not video_id or "/" in video_id or len(video_id) > 100:
        raise ValueError("视频 ID 无效")
    with DATABASE_LOCK, database() as connection:
        rows = connection.execute(
            """SELECT tool_json FROM chart_drawings
               WHERE video_id = ? AND symbol = ?
               ORDER BY created_at ASC""",
            (video_id, symbol),
        ).fetchall()
    return [json.loads(row["tool_json"]) for row in rows]


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
                """DELETE FROM chart_drawings
                   WHERE id = ? AND video_id = ? AND symbol = ?""",
                (drawing_id, video_id, symbol),
            )
            return
        connection.execute(
            "DELETE FROM chart_drawings WHERE video_id = ? AND symbol = ?",
            (video_id, symbol),
        )


class StudyHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self.path = "/TiaBTC_学习视频清单.html"
        if parsed.path == "/api/state":
            return self.send_json(HTTPStatus.OK, load_state())
        if parsed.path == "/api/chart/config":
            return self.send_json(
                HTTPStatus.OK,
                {"futureDays": get_future_days(), "offlineMode": get_offline_mode()},
            )
        if parsed.path == "/api/chart/candles":
            try:
                query = parse_qs(parsed.query)
                symbol = query.get("symbol", [""])[0]
                interval = query.get("interval", [""])[0]
                before = query.get("before", [""])[0]
                if before:
                    limit = int(query.get("limit", ["1000"])[0])
                    return self.send_json(
                        HTTPStatus.OK,
                        load_earlier_candles(symbol, interval, int(before), limit),
                    )
                anchor = int(query.get("anchor", ["0"])[0])
                days = int(query.get("futureDays", [str(get_future_days())])[0])
                if days < 0 or days > 30:
                    raise ValueError("未来天数必须是 0–30 的整数")
                return self.send_json(HTTPStatus.OK, load_chart_candles(symbol, interval, anchor, days))
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
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            payload = self.read_json_body()
            if parsed.path == "/api/chart/drawings":
                return self.send_json(HTTPStatus.OK, save_drawing(payload))
        except (ValueError, json.JSONDecodeError) as error:
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
                if "futureDays" in payload:
                    set_future_days(payload["futureDays"])
                if "offlineMode" in payload:
                    set_offline_mode(payload["offlineMode"])
                if "futureDays" not in payload and "offlineMode" not in payload:
                    raise ValueError("没有可保存的图表配置")
                return self.send_json(
                    HTTPStatus.OK,
                    {"futureDays": get_future_days(), "offlineMode": get_offline_mode()},
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
        if parsed.path != "/api/chart/drawings":
            return self.send_error(HTTPStatus.NOT_FOUND)
        try:
            delete_drawings(parse_qs(parsed.query))
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
    print(f"学习页已启动：http://{HOST}:{PORT}/")
    print("按 Ctrl+C 停止服务。")
    ThreadingHTTPServer((HOST, PORT), StudyHandler).serve_forever()
