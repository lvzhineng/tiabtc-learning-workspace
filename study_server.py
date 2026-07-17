import json
import os
import sqlite3
import threading
import time
import uuid
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urlencode, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
STATE_FILE = ROOT / "learning-state.json"
DATABASE_FILE = ROOT / "tiabtc-review.sqlite"
HOST = "127.0.0.1"
PORT = 8765
VALID_STATUSES = {"unlearned", "learning", "learned"}
VALID_SYMBOLS = {"BTCUSDT", "ETHUSDT"}
VALID_INTERVALS = {"5", "15", "60", "240", "D", "W"}
VALID_DRAWING_KINDS = {"horizontal", "trend", "fibonacci"}
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


def database():
    connection = sqlite3.connect(DATABASE_FILE, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=30000")
    return connection


def initialize_database():
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
                kind TEXT NOT NULL,
                points_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_chart_drawings_scope
                ON chart_drawings (video_id, symbol, interval);
            INSERT OR IGNORE INTO app_settings (key, value) VALUES ('future_days', '3');
            """
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


def validate_market_scope(symbol, interval):
    if symbol not in VALID_SYMBOLS:
        raise ValueError("仅支持 BTCUSDT 和 ETHUSDT")
    if interval not in VALID_INTERVALS:
        raise ValueError("不支持该 K 线周期")


def cached_range_contains(symbol, interval, start_timestamp, end_timestamp):
    with DATABASE_LOCK, database() as connection:
        row = connection.execute(
            """SELECT 1 FROM market_cache_ranges
               WHERE symbol = ? AND interval = ?
                 AND start_timestamp <= ? AND end_timestamp >= ?
               LIMIT 1""",
            (symbol, interval, start_timestamp, end_timestamp),
        ).fetchone()
    return row is not None


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


def load_candle_range(symbol, interval, start_timestamp, end_timestamp):
    source = "sqlite"
    warning = ""
    if not cached_range_contains(symbol, interval, start_timestamp, end_timestamp):
        try:
            fetched = fetch_bybit_candles(symbol, interval, start_timestamp, end_timestamp)
            save_candles(symbol, interval, start_timestamp, end_timestamp, fetched)
            source = "bybit"
        except RuntimeError as error:
            warning = str(error)
    candles = list_candles(symbol, interval, start_timestamp, end_timestamp)
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
    kind = str(payload.get("kind", ""))
    validate_market_scope(symbol, interval)
    if not video_id or "/" in video_id or len(video_id) > 100:
        raise ValueError("视频 ID 无效")
    if kind not in VALID_DRAWING_KINDS:
        raise ValueError("画图类型无效")
    points = payload.get("points")
    expected = 1 if kind == "horizontal" else 2
    if not isinstance(points, list) or len(points) != expected:
        raise ValueError("画图控制点数量无效")
    normalized_points = []
    for point in points:
        if not isinstance(point, dict):
            raise ValueError("画图控制点无效")
        timestamp = float(point.get("time"))
        price = float(point.get("price"))
        if not timestamp > 0 or not price > 0:
            raise ValueError("画图控制点无效")
        normalized_points.append({"time": timestamp, "price": price})
    return {
        "id": str(payload.get("id") or uuid.uuid4()),
        "videoId": video_id,
        "symbol": symbol,
        "interval": interval,
        "kind": kind,
        "points": normalized_points,
    }


def save_drawing(payload):
    drawing = validate_drawing(payload)
    now = datetime.now().astimezone().isoformat()
    with DATABASE_LOCK, database() as connection:
        existing = connection.execute("SELECT created_at FROM chart_drawings WHERE id = ?", (drawing["id"],)).fetchone()
        created_at = existing["created_at"] if existing else now
        connection.execute(
            """INSERT INTO chart_drawings
               (id, video_id, symbol, interval, kind, points_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 video_id = excluded.video_id, symbol = excluded.symbol,
                 interval = excluded.interval, kind = excluded.kind,
                 points_json = excluded.points_json, updated_at = excluded.updated_at""",
            (
                drawing["id"], drawing["videoId"], drawing["symbol"], drawing["interval"],
                drawing["kind"], json.dumps(drawing["points"], ensure_ascii=False), created_at, now,
            ),
        )
    drawing.update({"createdAt": created_at, "updatedAt": now})
    return drawing


def list_drawings(video_id, symbol, interval):
    validate_market_scope(symbol, interval)
    with DATABASE_LOCK, database() as connection:
        rows = connection.execute(
            """SELECT * FROM chart_drawings
               WHERE video_id = ? AND symbol = ? AND interval = ?
               ORDER BY created_at ASC""",
            (video_id, symbol, interval),
        ).fetchall()
    return [
        {
            "id": row["id"], "videoId": row["video_id"], "symbol": row["symbol"],
            "interval": row["interval"], "kind": row["kind"],
            "points": json.loads(row["points_json"]),
            "createdAt": row["created_at"], "updatedAt": row["updated_at"],
        }
        for row in rows
    ]


def delete_drawings(query):
    drawing_id = query.get("id", [""])[0]
    with DATABASE_LOCK, database() as connection:
        if drawing_id:
            connection.execute("DELETE FROM chart_drawings WHERE id = ?", (drawing_id,))
            return
        video_id = query.get("videoId", [""])[0]
        symbol = query.get("symbol", [""])[0]
        interval = query.get("interval", [""])[0]
        validate_market_scope(symbol, interval)
        if not video_id:
            raise ValueError("缺少视频 ID")
        connection.execute(
            "DELETE FROM chart_drawings WHERE video_id = ? AND symbol = ? AND interval = ?",
            (video_id, symbol, interval),
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
            return self.send_json(HTTPStatus.OK, {"futureDays": get_future_days()})
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
        if path == "/api/chart/config":
            try:
                payload = self.read_json_body()
                return self.send_json(HTTPStatus.OK, {"futureDays": set_future_days(payload.get("futureDays"))})
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
