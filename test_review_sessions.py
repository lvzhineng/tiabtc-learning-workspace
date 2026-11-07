import json
import math
import sqlite3
import tempfile
import threading
import time
import unittest
from contextlib import contextmanager
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path

from review_session_store import ReviewSessionStore
from workspace_schema import REVIEW_SESSIONS_SCHEMA_SQL


def validate_test_drawing(payload):
    if not isinstance(payload, dict):
        raise ValueError("画图记录必须是对象")
    drawing_id = payload.get("id")
    tool_type = payload.get("toolType")
    if not isinstance(drawing_id, str) or not drawing_id or drawing_id.startswith("__system__:"):
        raise ValueError("画图 ID 无效")
    expected_counts = {"TrendLine": 2, "HorizontalLine": 1, "TextAnnotation": 1}
    if tool_type not in expected_counts or not isinstance(payload.get("points"), list):
        raise ValueError("画图类型或控制点无效")
    points = payload["points"]
    if len(points) != expected_counts[tool_type]:
        raise ValueError("画图控制点数量无效")
    normalized_points = []
    for point in points:
        if not isinstance(point, dict):
            raise ValueError("画图控制点无效")
        timestamp = point.get("timestamp")
        price = point.get("price")
        if (
            isinstance(timestamp, bool) or not isinstance(timestamp, (int, float))
            or not math.isfinite(timestamp) or timestamp <= 0
            or isinstance(price, bool) or not isinstance(price, (int, float))
            or not math.isfinite(price) or price <= 0
        ):
            raise ValueError("画图控制点无效")
        normalized_points.append({"timestamp": float(timestamp), "price": float(price)})
    options = payload.get("options")
    if not isinstance(options, dict):
        raise ValueError("画图选项无效")
    drawing = {"id": drawing_id, "toolType": tool_type, "points": normalized_points, "options": options}
    encoded = json.dumps(drawing, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if len(encoded.encode("utf-8")) > 200_000:
        raise ValueError("画图记录过大")
    return drawing, encoded


class ReviewSessionStoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.database_path = Path(self.temporary_directory.name) / "review-sessions.sqlite"

        @contextmanager
        def database():
            connection = sqlite3.connect(self.database_path, timeout=5)
            connection.row_factory = sqlite3.Row
            try:
                with connection:
                    yield connection
            finally:
                connection.close()

        self.database = database
        self.lock = threading.RLock()
        with self.database() as connection:
            connection.executescript(REVIEW_SESSIONS_SCHEMA_SQL)
        self.store = self._new_store()

    def _new_store(self):
        def validate_perpetual(symbol, interval):
            if symbol not in {"BTCUSDT", "ETHUSDT", "SOLUSDT", "ARBUSDT"}:
                raise ValueError("交易对未添加")
            if interval not in {"1", "5", "15", "60", "240", "D", "W"}:
                raise ValueError("周期无效")

        def validate_cfd(symbol, interval):
            if symbol not in {"XAUUSD", "NAS100", "JPN225"}:
                raise ValueError("CFD 品种无效")
            if interval not in {"1", "5", "15", "60", "240", "D", "W"}:
                raise ValueError("周期无效")

        return ReviewSessionStore(
            self.database,
            self.lock,
            validate_test_drawing,
            validate_perpetual,
            validate_cfd,
            {"XAUUSD", "NAS100", "JPN225"},
        )

    @staticmethod
    def _state(symbol="BTCUSDT", **overrides):
        timestamp_ms = math.floor(time.time() * 1000) - 5_000
        state = {
            "symbol": symbol,
            "timeframe": "60",
            "timestampMs": timestamp_ms + 0.125,
            "visibleSpan": 88.5,
            "replay": {
                "startTimeMs": timestamp_ms - 1_000 + 0.5,
                "cursorTimeMs": timestamp_ms - 100 + 0.75,
                "speed": 2,
            },
            "isLogScale": False,
            "sessionBands": ["asia", "america"],
            "showWeekendBands": True,
            "videoContext": None,
        }
        state.update(overrides)
        return state

    @staticmethod
    def _drawing(drawing_id="drawing-1", interval="60", symbol="BTCUSDT", **overrides):
        drawing = {
            "id": drawing_id,
            "symbol": symbol,
            "interval": interval,
            "toolType": "TrendLine",
            "points": [
                {"timestamp": 1_700_000_000.25, "price": 42_000.123456789},
                {"timestamp": 1_700_003_600.75, "price": 43_000.987654321},
            ],
            "options": {"line": {"color": "#2563eb"}, "editable": True},
        }
        drawing.update(overrides)
        return drawing

    def _create(self, *, market="perpetual", symbol="BTCUSDT", **overrides):
        payload = {"market": market, "state": self._state(symbol)}
        payload.update(overrides)
        return self.store.create_session(payload)

    def test_create_and_reopen_preserves_state_precision_and_drawings(self):
        drawing = self._drawing(interval="240")
        drawing.update({"videoId": "__global__", "createdAt": "untrusted", "updatedAt": "untrusted"})
        created = self._create(drawings=[drawing])

        reopened_store = self._new_store()
        reopened = reopened_store.get_session(created["id"])
        self.assertEqual(reopened["state"]["visibleSpan"], 88.5)
        self.assertEqual(reopened["state"]["timestampMs"] % 1, 0.125)
        self.assertEqual(reopened["state"]["replay"]["cursorTimeMs"] % 1, 0.75)
        self.assertEqual(reopened["drawingCount"], 1)
        reopened_drawing = reopened_store.list_drawings(created["id"])[0]
        self.assertEqual(reopened_drawing["interval"], "240")
        self.assertNotIn("videoId", reopened_drawing)
        self.assertNotIn("createdAt", reopened_drawing)

    def test_metadata_update_does_not_overwrite_drawings(self):
        created = self._create()
        drawing = self.store.save_drawing(created["id"], self._drawing())
        updated = self.store.update_session(
            created["id"], {"title": "复盘一", "state": self._state(timestampMs=time.time() * 1000 - 123.25)}
        )

        self.assertEqual(updated["title"], "复盘一")
        self.assertEqual(updated["drawingCount"], 1)
        self.assertEqual(self.store.list_drawings(created["id"]), [drawing])

    def test_drawings_are_cross_period_and_isolated_between_sessions(self):
        first = self._create()
        second = self._create()
        same_id_first = self.store.save_drawing(first["id"], self._drawing(interval="60"))
        same_id_second = self.store.save_drawing(
            second["id"], self._drawing(interval="W", options={"line": {"color": "red"}})
        )

        self.assertEqual(same_id_first["id"], same_id_second["id"])
        self.assertEqual(self.store.list_drawings(first["id"]), [same_id_first])
        self.assertEqual(self.store.list_drawings(second["id"]), [same_id_second])
        self.assertEqual(self.store.get_session(first["id"])["drawingCount"], 1)

    def test_edit_delete_batch_replace_and_clear(self):
        created = self._create()
        first = self.store.save_drawing(created["id"], self._drawing("one"))
        second = self.store.save_drawing(created["id"], self._drawing("two", interval="15"))
        edited = self.store.save_drawing(
            created["id"], self._drawing("one", options={"line": {"color": "red"}})
        )
        self.assertEqual(edited["options"]["line"]["color"], "red")
        self.assertEqual(len(self.store.list_drawings(created["id"])), 2)

        self.store.delete_drawing(created["id"], "two")
        self.assertEqual([item["id"] for item in self.store.list_drawings(created["id"])], ["one"])

        # Replacing the full list models undo/redo snapshots.
        self.assertEqual(
            [item["id"] for item in self.store.replace_drawings(created["id"], {"drawings": [first, second]})],
            ["one", "two"],
        )
        self.store.delete_drawing(created["id"])
        self.assertEqual(self.store.list_drawings(created["id"]), [])

    def test_rejects_sensitive_or_inconsistent_state_and_malicious_drawings(self):
        with self.assertRaisesRegex(ValueError, "字段无效"):
            self._create(state=self._state(apiKey="secret"))
        with self.assertRaisesRegex(ValueError, "晚于当前时间"):
            self._create(state=self._state(timestampMs=9_999_999_999_999))
        with self.assertRaisesRegex(ValueError, "不可修改"):
            created = self._create()
            self.store.update_session(created["id"], {"state": self._state("ETHUSDT")})
        with self.assertRaisesRegex(ValueError, "画图交易对必须"):
            created = self._create()
            self.store.save_drawing(created["id"], self._drawing(symbol="ETHUSDT"))
        with self.assertRaisesRegex(ValueError, "画图 ID 无效"):
            created = self._create()
            self.store.save_drawing(created["id"], self._drawing("__system__:entry"))
        with self.assertRaisesRegex(ValueError, "画图交易对必填"):
            created = self._create()
            unscoped = self._drawing()
            unscoped.pop("symbol")
            self.store.save_drawing(created["id"], unscoped)

    def test_failed_batch_is_atomic_and_enforces_duplicate_and_count_limits(self):
        created = self._create()
        original = self.store.save_drawing(created["id"], self._drawing("kept"))
        with self.assertRaisesRegex(ValueError, "重复"):
            self.store.replace_drawings(
                created["id"], {"drawings": [self._drawing("dup"), self._drawing("dup")]}
            )
        self.assertEqual(self.store.list_drawings(created["id"]), [original])
        with self.assertRaisesRegex(ValueError, "最多保存 500"):
            self.store.replace_drawings(
                created["id"], {"drawings": [self._drawing(str(index)) for index in range(501)]}
            )
        self.assertEqual(self.store.list_drawings(created["id"]), [original])

    def test_listing_is_market_separated_and_limited_to_200(self):
        for _ in range(205):
            self._create()
        self._create(market="cfd", symbol="XAUUSD")

        perpetual_sessions = self.store.list_sessions("perpetual")
        cfd_sessions = self.store.list_sessions("cfd")
        self.assertEqual(len(perpetual_sessions), 200)
        self.assertTrue(all(item["market"] == "perpetual" for item in perpetual_sessions))
        self.assertTrue(all(item["symbol"] == "BTCUSDT" for item in perpetual_sessions))
        self.assertEqual(len(cfd_sessions), 1)
        self.assertEqual(cfd_sessions[0]["symbol"], "XAUUSD")


class ReviewSessionHttpRouteTests(unittest.TestCase):
    def setUp(self):
        import study_server

        self.study_server = study_server
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        original_database_file = study_server.DATABASE_FILE
        self.addCleanup(setattr, study_server, "DATABASE_FILE", original_database_file)
        study_server.DATABASE_FILE = Path(self.temporary_directory.name) / "http-review.sqlite"
        with study_server.DATABASE_LOCK, study_server.database() as connection:
            connection.executescript(REVIEW_SESSIONS_SCHEMA_SQL)

        class QuietStudyHandler(study_server.StudyHandler):
            def log_message(self, format, *args):
                return

        self.http_server = ThreadingHTTPServer(("127.0.0.1", 0), QuietStudyHandler)
        self.server_thread = threading.Thread(target=self.http_server.serve_forever, daemon=True)
        self.server_thread.start()
        self.addCleanup(self._stop_server)
        self.port = self.http_server.server_address[1]

    def _stop_server(self):
        self.http_server.shutdown()
        self.http_server.server_close()
        self.server_thread.join(timeout=3)

    def request(self, method, path, payload=None):
        connection = HTTPConnection("127.0.0.1", self.port, timeout=3)
        body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json; charset=utf-8"} if body is not None else {}
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        raw_body = response.read()
        connection.close()
        try:
            parsed_body = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            parsed_body = None
        return response.status, parsed_body

    @staticmethod
    def state(symbol="BTCUSDT", **overrides):
        return ReviewSessionStoreTests._state(symbol, **overrides)

    @staticmethod
    def drawing(drawing_id, *, interval="60", symbol="BTCUSDT", **overrides):
        return ReviewSessionStoreTests._drawing(
            drawing_id, interval=interval, symbol=symbol, **overrides
        )

    def create_session(self, *, market="perpetual", symbol="BTCUSDT", **overrides):
        payload = {"market": market, "state": self.state(symbol)}
        payload.update(overrides)
        status, body = self.request("POST", "/api/review-sessions", payload)
        self.assertEqual(status, 201, body)
        return body

    def test_http_list_create_get_update_and_market_separation(self):
        perpetual = self.create_session(title="BTC 第一轮")
        cfd = self.create_session(market="cfd", symbol="XAUUSD", title="黄金复盘")

        status, summary = self.request("GET", "/api/review-sessions?market=perpetual")
        self.assertEqual(status, 200)
        self.assertEqual([item["id"] for item in summary["sessions"]], [perpetual["id"]])
        self.assertNotIn("state", summary["sessions"][0])
        self.assertEqual(summary["sessions"][0]["drawingCount"], 0)

        status, detail = self.request("GET", f"/api/review-sessions/{perpetual['id']}")
        self.assertEqual(status, 200)
        self.assertEqual(detail["state"]["symbol"], "BTCUSDT")
        self.assertEqual(detail["id"], perpetual["id"])

        changed_state = self.state(timestampMs=time.time() * 1000 - 100)
        status, updated = self.request(
            "PUT", f"/api/review-sessions/{perpetual['id']}",
            {"title": "已命名", "state": changed_state},
        )
        self.assertEqual(status, 200)
        self.assertEqual(updated["title"], "已命名")
        self.assertEqual(updated["state"]["timestampMs"], changed_state["timestampMs"])

        status, cfd_list = self.request("GET", "/api/review-sessions?market=cfd")
        self.assertEqual(status, 200)
        self.assertEqual([item["id"] for item in cfd_list["sessions"]], [cfd["id"]])
        self.assertEqual(cfd_list["sessions"][0]["symbol"], "XAUUSD")

    def test_http_drawing_crud_and_atomic_batch_replace(self):
        session = self.create_session()
        drawings_path = f"/api/review-sessions/{session['id']}/drawings"

        first = self.drawing("line-1", interval="60")
        status, saved_first = self.request("POST", drawings_path, first)
        self.assertEqual(status, 200)
        self.assertNotIn("symbol", saved_first)
        self.assertEqual(saved_first["interval"], "60")

        status, loaded = self.request("GET", drawings_path)
        self.assertEqual(status, 200)
        self.assertEqual(loaded["drawings"], [saved_first])

        second = self.drawing("line-2", interval="W")
        self.assertEqual(self.request("POST", drawings_path, second)[0], 200)
        # GET drawings are period-independent and can be sent back in an undo/redo replacement.
        status, replaced = self.request("PUT", drawings_path, {"drawings": [saved_first]})
        self.assertEqual(status, 200)
        self.assertEqual([item["id"] for item in replaced["drawings"]], ["line-1"])

        status, deleted = self.request("DELETE", f"{drawings_path}?id=line-1")
        self.assertEqual(status, 200)
        self.assertTrue(deleted["ok"])
        self.assertEqual(self.request("GET", drawings_path)[1]["drawings"], [])

        self.request("POST", drawings_path, first)
        self.assertEqual(self.request("DELETE", drawings_path)[0], 200)
        self.assertEqual(self.request("GET", drawings_path)[1]["drawings"], [])

    def test_http_bad_requests_and_missing_sessions_return_400_or_404(self):
        self.assertEqual(self.request("GET", "/api/review-sessions")[0], 400)
        self.assertEqual(self.request("GET", "/api/review-sessions?market=unknown")[0], 400)
        self.assertEqual(self.request("POST", "/api/review-sessions", {"market": "perpetual"})[0], 400)
        self.assertEqual(self.request("GET", "/api/review-sessions/not-a-session")[0], 404)
        self.assertEqual(self.request("GET", "/api/review-sessions/not-a-session/drawings")[0], 404)

        session = self.create_session()
        drawings_path = f"/api/review-sessions/{session['id']}/drawings"
        bad_state = self.state(apiKey="must-not-be-persisted")
        self.assertEqual(
            self.request("PUT", f"/api/review-sessions/{session['id']}", {"state": bad_state})[0],
            400,
        )
        self.assertEqual(
            self.request("POST", drawings_path, self.drawing("__system__:marker"))[0],
            400,
        )
        self.assertEqual(
            self.request(
                "PUT", drawings_path,
                {"drawings": [self.drawing("duplicate"), self.drawing("duplicate")]},
            )[0],
            400,
        )
        self.assertEqual(self.request("GET", "/api/review-sessions/missing-id/drawings")[0], 404)


if __name__ == "__main__":
    unittest.main()
