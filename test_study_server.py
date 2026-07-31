import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest import mock

import study_server


def sample_drawing(**overrides):
    drawing = {
        "videoId": "video-1",
        "symbol": "BTCUSDT",
        "interval": "60",
        "id": "drawing-1",
        "toolType": "TrendLine",
        "points": [
            {"timestamp": 1_704_067_200, "price": 42_000},
            {"timestamp": 1_704_070_800, "price": 43_000},
        ],
        "options": {"visible": True, "editable": True, "line": {"color": "#2563eb"}},
    }
    drawing.update(overrides)
    return drawing


class DrawingStorageTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.original_database_file = study_server.DATABASE_FILE
        study_server.DATABASE_FILE = Path(self.temporary_directory.name) / "review.sqlite"
        study_server.initialize_database()

    def tearDown(self):
        study_server.DATABASE_FILE = self.original_database_file
        self.temporary_directory.cleanup()

    def test_save_list_update_and_delete_drawing(self):
        saved = study_server.save_drawing(sample_drawing())
        self.assertEqual(saved["toolType"], "TrendLine")
        self.assertEqual(study_server.list_drawings("video-1", "BTCUSDT", "60"), [saved])

        updated = sample_drawing(options={"visible": True, "line": {"color": "#ef4444"}})
        study_server.save_drawing(updated)
        self.assertEqual(
            study_server.list_drawings("video-1", "BTCUSDT", "60")[0]["options"]["line"]["color"],
            "#ef4444",
        )

        study_server.delete_drawings(
            {"id": ["drawing-1"], "videoId": ["video-1"], "symbol": ["BTCUSDT"], "interval": ["60"]}
        )
        self.assertEqual(study_server.list_drawings("video-1", "BTCUSDT", "60"), [])

    def test_scope_prevents_cross_video_delete(self):
        study_server.save_drawing(sample_drawing())
        # Drawings are shared globally across videos under GLOBAL_DRAWING_SCOPE
        study_server.delete_drawings(
            {"id": ["drawing-1"], "videoId": ["video-2"], "symbol": ["BTCUSDT"], "interval": ["60"]}
        )
        self.assertEqual(len(study_server.list_drawings("video-1", "BTCUSDT", "60")), 0)

    def test_drawings_are_shared_across_intervals(self):
        study_server.save_drawing(sample_drawing(interval="240"))

        drawings_on_hourly = study_server.list_drawings("video-1", "BTCUSDT", "60")
        self.assertEqual([drawing["id"] for drawing in drawings_on_hourly], ["drawing-1"])

        study_server.delete_drawings(
            {"videoId": ["video-1"], "symbol": ["BTCUSDT"], "interval": ["60"]}
        )
        self.assertEqual(study_server.list_drawings("video-1", "BTCUSDT", "240"), [])

    def test_replace_drawings_is_atomic_and_can_clear_scope(self):
        study_server.save_drawing(sample_drawing())
        replacement = sample_drawing(
            id="drawing-2",
            toolType="HorizontalLine",
            points=[{"timestamp": 1_704_067_200, "price": 42_500}],
        )
        result = study_server.replace_drawings({
            "videoId": "video-1", "symbol": "BTCUSDT", "interval": "240",
            "drawings": [replacement],
        })
        self.assertEqual([drawing["id"] for drawing in result], ["drawing-2"])
        self.assertEqual(
            [drawing["id"] for drawing in study_server.list_drawings("video-1", "BTCUSDT", "60")],
            ["drawing-2"],
        )
        study_server.replace_drawings({
            "videoId": "video-1", "symbol": "BTCUSDT", "interval": "60", "drawings": [],
        })
        self.assertEqual(study_server.list_drawings("video-1", "BTCUSDT", "240"), [])

    def test_contiguous_cache_fragments_cover_a_requested_range(self):
        with study_server.database() as connection:
            connection.executemany(
                "INSERT INTO market_cache_ranges VALUES (?, ?, ?, ?, ?)",
                [
                    ("BTCUSDT", "60", 1000, 1999, "now"),
                    ("BTCUSDT", "60", 2000, 2999, "now"),
                    ("BTCUSDT", "60", 3000, 3999, "now"),
                ],
            )
        self.assertTrue(study_server.cached_range_contains("BTCUSDT", "60", 1200, 3800))
        self.assertFalse(study_server.cached_range_contains("BTCUSDT", "60", 900, 3800))
        self.assertFalse(study_server.cached_range_contains("BTCUSDT", "60", 1200, 4100))

    def test_offline_mode_never_fetches_missing_ranges(self):
        original_fetch = study_server.fetch_market_candles
        study_server.fetch_market_candles = lambda *args: self.fail("offline mode used network")
        try:
            with self.assertRaisesRegex(RuntimeError, "仅本地模式"):
                study_server.load_candle_range("BTCUSDT", "60", 1000, 2000, offline=True)
        finally:
            study_server.fetch_market_candles = original_fetch

    def test_video_chart_stops_exactly_at_publish_time(self):
        anchor = 1_704_067_200_000
        now = 1_800_000_000_000
        with (
            mock.patch.object(study_server.time, "time", return_value=now / 1000),
            mock.patch.object(study_server, "load_candle_range", return_value=([], "sqlite", "")) as load_range,
        ):
            payload = study_server.load_chart_candles("BTCUSDT", "60", anchor)

        self.assertEqual(payload["effectiveCutoff"], anchor)
        self.assertEqual(payload["requestedCutoff"], anchor)
        self.assertEqual(payload["loadedCutoff"], anchor)
        self.assertFalse(payload["hasMoreLater"])
        self.assertNotIn("futureDays", payload)
        self.assertEqual(load_range.call_args.args[3], anchor)

    def test_rejects_unknown_system_and_wrong_point_count(self):
        invalid_drawings = [
            sample_drawing(toolType="Text"),
            sample_drawing(id="__system__:marker"),
            sample_drawing(points=sample_drawing()["points"][:1]),
            sample_drawing(options={"width": float("nan")}),
        ]
        for drawing in invalid_drawings:
            with self.subTest(drawing=drawing), self.assertRaises(ValueError):
                study_server.validate_drawing(drawing)

    def test_old_svg_schema_is_replaced_and_cleared(self):
        with closing(sqlite3.connect(study_server.DATABASE_FILE)) as connection, connection:
            connection.execute("DROP TABLE chart_drawings")
            connection.execute(
                """CREATE TABLE chart_drawings (
                    id TEXT PRIMARY KEY, video_id TEXT, symbol TEXT, interval TEXT,
                    kind TEXT, points_json TEXT, created_at TEXT, updated_at TEXT
                )"""
            )
            connection.execute(
                "INSERT INTO chart_drawings VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ("old-1", "video-1", "BTCUSDT", "60", "trend", json.dumps([]), "now", "now"),
            )

        study_server.initialize_database()

        with closing(sqlite3.connect(study_server.DATABASE_FILE)) as connection, connection:
            columns = {row[1] for row in connection.execute("PRAGMA table_info(chart_drawings)")}
            count = connection.execute("SELECT COUNT(*) FROM chart_drawings").fetchone()[0]
        self.assertIn("tool_json", columns)
        self.assertNotIn("points_json", columns)
        self.assertEqual(count, 0)


if __name__ == "__main__":
    unittest.main()
