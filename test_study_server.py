import os
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
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
        self.original_state_file = study_server.STATE_FILE
        study_server.DATABASE_FILE = Path(self.temporary_directory.name) / "review.sqlite"
        study_server.STATE_FILE = Path(self.temporary_directory.name) / "learning-state.json"
        study_server.initialize_database()

    def tearDown(self):
        study_server.DATABASE_FILE = self.original_database_file
        study_server.STATE_FILE = self.original_state_file
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

    def test_position_review_prefers_bybit_until_catalog_confirms_absence(self):
        with mock.patch.object(
            study_server.MARKET_DATA_PROVIDER,
            "usdt_perpetual_presence",
            return_value="unknown",
        ):
            self.assertEqual(
                study_server.resolve_position_candle_venue("BTCUSDT"),
                "bybit",
            )
        with mock.patch.object(
            study_server.MARKET_DATA_PROVIDER,
            "usdt_perpetual_presence",
            return_value="present",
        ):
            self.assertEqual(
                study_server.resolve_position_candle_venue("INTCUSDT"),
                "bybit",
            )
        with mock.patch.object(
            study_server.MARKET_DATA_PROVIDER,
            "usdt_perpetual_presence",
            return_value="absent",
        ):
            self.assertEqual(
                study_server.resolve_position_candle_venue("SHIBUSDT"),
                "bitget",
            )

    def test_bybit_presence_is_unknown_before_catalog_loads(self):
        from market_data_provider import CcxtBybitMarketDataProvider

        provider = CcxtBybitMarketDataProvider()
        provider.exchange.markets = {}
        with mock.patch.object(provider, "_schedule_catalog_refresh"):
            self.assertEqual(provider.usdt_perpetual_presence("BTCUSDT"), "unknown")
        provider._perpetual_catalog = [
            {
                "symbol": "BTCUSDT",
                "base": "BTC",
                "quote": "USDT",
                "name": "BTC/USDT 永续",
            }
        ]
        provider._perpetual_catalog_loaded_at = 1.0
        self.assertEqual(provider.usdt_perpetual_presence("BTCUSDT"), "present")
        self.assertEqual(provider.usdt_perpetual_presence("SHIBUSDT"), "absent")
        self.assertTrue(provider.has_usdt_perpetual_symbol("BTCUSDT"))
        self.assertFalse(provider.has_usdt_perpetual_symbol("SHIBUSDT"))

    def test_save_candles_does_not_cover_open_bar_or_internal_holes(self):
        now = 1_787_809_200_000
        interval = "15"
        interval_ms = study_server.INTERVAL_MILLISECONDS[interval]
        with mock.patch.object(study_server.time, "time", return_value=now / 1000):
            open_ts = study_server.current_open_candle_timestamp(interval, now)
            last_closed = open_ts - interval_ms
            older = last_closed - interval_ms * 2
            skipped = last_closed - interval_ms
            candles = [
                ("BTCUSDT", interval, older, 100, 101, 99, 100.5, 10),
                ("BTCUSDT", interval, last_closed, 100.5, 102, 100, 101, 12),
                ("BTCUSDT", interval, open_ts, 101, 101.2, 100.8, 101.1, 0.4),
            ]
            study_server.save_candles(
                "BTCUSDT",
                interval,
                older,
                open_ts + interval_ms - 1,
                candles,
            )
            self.assertTrue(
                study_server.cached_range_contains("BTCUSDT", interval, older, older)
            )
            self.assertFalse(
                study_server.cached_range_contains("BTCUSDT", interval, skipped, skipped)
            )
            self.assertTrue(
                study_server.cached_range_contains(
                    "BTCUSDT", interval, last_closed, last_closed
                )
            )
            self.assertFalse(
                study_server.cached_range_contains("BTCUSDT", interval, open_ts, open_ts)
            )

    def test_load_candle_range_repairs_claimed_hole_and_stale_partial(self):
        now = 1_787_809_200_000
        interval = "15"
        interval_ms = study_server.INTERVAL_MILLISECONDS[interval]
        study_server.MARKET_RANGE_REPAIR_AT.clear()
        study_server.MARKET_FETCH_FAILURES.pop(("BTCUSDT", interval), None)
        with mock.patch.object(study_server.time, "time", return_value=now / 1000):
            last_closed = study_server.latest_closed_candle_timestamp(interval, now)
            first_ts = last_closed - interval_ms * 2
            hole_ts = last_closed - interval_ms
            with study_server.database() as connection:
                connection.executemany(
                    "INSERT INTO market_candles VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                        ("BTCUSDT", interval, first_ts, 100, 101, 99, 100.5, 20),
                        ("BTCUSDT", interval, last_closed, 90, 91, 89, 90.5, 25),
                    ],
                )
                connection.execute(
                    "INSERT INTO market_cache_ranges VALUES (?, ?, ?, ?, ?)",
                    (
                        "BTCUSDT",
                        interval,
                        first_ts,
                        last_closed + interval_ms - 1,
                        "now",
                    ),
                )

            def fetch_missing(symbol, interval_name, start_timestamp, end_timestamp):
                self.assertEqual(symbol, "BTCUSDT")
                self.assertEqual(interval_name, interval)
                return [
                    ("BTCUSDT", interval, hole_ts, 100.5, 101, 100, 100.8, 18),
                    ("BTCUSDT", interval, last_closed, 100.8, 101.2, 100.4, 101, 22),
                ]

            with mock.patch.object(
                study_server,
                "fetch_market_candles",
                side_effect=fetch_missing,
            ), mock.patch.object(
                study_server,
                "request_needs_trailing_refresh",
                return_value=False,
            ):
                candles, source, warning = study_server.load_candle_range(
                    "BTCUSDT",
                    interval,
                    first_ts,
                    last_closed,
                    offline=False,
                    wait_for_refresh=True,
                )

        timestamps = [candle["timestamp"] for candle in candles]
        self.assertEqual(timestamps, [first_ts, hole_ts, last_closed])
        self.assertEqual(source, "bybit")
        self.assertEqual(warning, "")
        repaired = next(candle for candle in candles if candle["timestamp"] == last_closed)
        self.assertEqual(repaired["open"], 100.8)
        self.assertEqual(repaired["close"], 101)

    def test_offline_mode_never_fetches_missing_ranges(self):
        original_fetch = study_server.fetch_market_candles
        study_server.fetch_market_candles = lambda *args: self.fail("offline mode used network")
        try:
            with self.assertRaisesRegex(RuntimeError, "仅本地模式"):
                study_server.load_candle_range("BTCUSDT", "60", 1000, 2000, offline=True)
        finally:
            study_server.fetch_market_candles = original_fetch

    def test_complete_range_raises_when_online_refresh_fails_with_stale_candles(self):
        with study_server.database() as connection:
            connection.execute(
                "INSERT INTO market_candles VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ("BTCUSDT", "60", 1000, 100, 101, 99, 100.5, 12),
            )
        study_server.MARKET_FETCH_FAILURES.pop(("BTCUSDT", "60"), None)

        with mock.patch.object(
            study_server,
            "fetch_market_candles",
            side_effect=RuntimeError("Bybit 暂时不可用"),
        ):
            with self.assertRaisesRegex(RuntimeError, "Bybit 暂时不可用"):
                study_server.load_candle_range(
                    "BTCUSDT",
                    "60",
                    1000,
                    3_601_000,
                    offline=False,
                    require_complete=True,
                )

        study_server.MARKET_FETCH_FAILURES.pop(("BTCUSDT", "60"), None)

    def test_complete_live_tail_surfaces_refresh_failure(self):
        with study_server.database() as connection:
            connection.execute(
                "INSERT INTO market_candles VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ("BTCUSDT", "60", 1000, 100, 101, 99, 100.5, 12),
            )
            connection.execute(
                "INSERT INTO market_cache_ranges VALUES (?, ?, ?, ?, ?)",
                ("BTCUSDT", "60", 1000, 2000, "now"),
            )

        with (
            mock.patch.object(
                study_server,
                "request_needs_trailing_refresh",
                return_value=True,
            ),
            mock.patch.object(
                study_server,
                "refresh_trailing_candles",
                side_effect=RuntimeError("尾部刷新失败"),
            ) as refresh_tail,
        ):
            with self.assertRaisesRegex(RuntimeError, "尾部刷新失败"):
                study_server.load_candle_range(
                    "BTCUSDT",
                    "60",
                    1000,
                    2000,
                    offline=False,
                    require_complete=True,
                )

        self.assertTrue(refresh_tail.call_args.kwargs["wait_for_lock"])
        self.assertTrue(refresh_tail.call_args.kwargs["raise_on_error"])

    def test_market_catalog_only_contains_active_linear_usdt_perpetuals(self):
        markets = {
            "btc-swap": {
                "id": "BTCUSDT", "base": "BTC", "quote": "USDT", "settle": "USDT",
                "swap": True, "linear": True, "active": True,
            },
            "eth-spot": {
                "id": "ETHUSDT", "base": "ETH", "quote": "USDT", "settle": None,
                "swap": False, "linear": None, "active": True,
            },
            "btc-future": {
                "id": "BTCUSDT-260925", "base": "BTC", "quote": "USDT", "settle": "USDT",
                "swap": False, "linear": True, "active": True,
            },
            "btc-usdc": {
                "id": "BTCPERP", "base": "BTC", "quote": "USDC", "settle": "USDC",
                "swap": True, "linear": True, "active": True,
            },
            "old-swap": {
                "id": "OLDUSDT", "base": "OLD", "quote": "USDT", "settle": "USDT",
                "swap": True, "linear": True, "active": False,
            },
        }
        catalog = study_server.MARKET_DATA_PROVIDER._build_perpetual_catalog(markets)
        self.assertEqual([item["symbol"] for item in catalog], ["BTCUSDT"])

    def test_market_provider_uses_system_proxy_when_environment_has_none(self):
        provider_class = type(study_server.MARKET_DATA_PROVIDER)
        with (
            mock.patch.dict(os.environ, {}, clear=True),
            mock.patch(
                "market_data_provider.getproxies",
                return_value={"https": "http://127.0.0.1:7890"},
            ),
        ):
            provider = provider_class()

        self.assertEqual(provider.exchange.httpsProxy, "http://127.0.0.1:7890")

    def test_trailing_refresh_expires_when_a_new_candle_closes(self):
        fetch_key = ("BTCUSDT", "60")
        interval_ms = study_server.INTERVAL_MILLISECONDS["60"]
        now = 1_786_268_536_566
        boundary = study_server.latest_closed_candle_timestamp("60", now)
        study_server.MARKET_TRAILING_REFRESH_AT[fetch_key] = 100
        study_server.MARKET_TRAILING_REFRESH_BOUNDARY[fetch_key] = boundary
        try:
            self.assertTrue(
                study_server.trailing_refresh_is_fresh(
                    fetch_key,
                    "60",
                    now_monotonic=101,
                    now_timestamp=now,
                )
            )
            self.assertFalse(
                study_server.trailing_refresh_is_fresh(
                    fetch_key,
                    "60",
                    now_monotonic=101,
                    now_timestamp=now + interval_ms,
                )
            )
            for interval in study_server.VALID_INTERVALS:
                self.assertGreater(
                    study_server.trailing_refresh_bar_count(interval),
                    0,
                )
        finally:
            study_server.MARKET_TRAILING_REFRESH_AT.pop(fetch_key, None)
            study_server.MARKET_TRAILING_REFRESH_BOUNDARY.pop(fetch_key, None)

    def test_symbol_search_merges_saved_and_recommended_perpetuals(self):
        recommendation = {
            "symbol": "1000PEPEUSDT",
            "base": "1000PEPE",
            "quote": "USDT",
            "name": "1000PEPE/USDT 永续",
        }
        with (
            mock.patch.object(study_server, "get_offline_mode", return_value=False),
            mock.patch.object(
                study_server.MARKET_DATA_PROVIDER,
                "search_usdt_perpetual_markets",
                return_value=[recommendation],
            ),
        ):
            payload = study_server.search_perpetual_symbols("pepe", 20)

        self.assertEqual([item["symbol"] for item in payload["symbols"]], ["1000PEPEUSDT"])
        self.assertFalse(payload["symbols"][0]["added"])

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
        self.assertEqual(load_range.call_args_list[0].args[3], anchor)
        self.assertTrue(load_range.call_args_list[0].kwargs["wait_for_refresh"])
        self.assertEqual(load_range.call_count, 2)

    def test_empty_historical_chart_retries_around_now(self):
        anchor = 1_620_518_400_000
        now = 1_787_209_200_000
        latest = {
            "timestamp": now - 86_400_000,
            "open": 1,
            "high": 2,
            "low": 0.5,
            "close": 1.5,
            "volume": 10,
        }

        def load_range(symbol, interval, start_timestamp, end_timestamp, **kwargs):
            if end_timestamp >= now - 1:
                return ([latest], "bybit", "")
            return ([], "sqlite", "")

        with (
            mock.patch.object(study_server.time, "time", return_value=now / 1000),
            mock.patch.object(
                study_server, "load_candle_range", side_effect=load_range
            ) as mocked_range,
        ):
            payload = study_server.load_chart_candles("BTCUSDT", "D", anchor)

        self.assertEqual(payload["candles"], [latest])
        self.assertEqual(payload["requestedCutoff"], anchor)
        self.assertEqual(payload["effectiveCutoff"], now)
        self.assertEqual(payload["source"], "bybit")
        self.assertEqual(mocked_range.call_count, 2)

    def test_replay_requires_complete_range_and_excludes_open_candle(self):
        now = 1_786_268_536_566
        interval_ms = study_server.INTERVAL_MILLISECONDS["60"]
        latest_closed = study_server.latest_closed_candle_timestamp("60", now)
        current_open = latest_closed + interval_ms
        candles = [
            {
                "timestamp": latest_closed,
                "open": 100,
                "high": 101,
                "low": 99,
                "close": 100.5,
                "volume": 10,
            },
            {
                "timestamp": current_open,
                "open": 100.5,
                "high": 102,
                "low": 100,
                "close": 101,
                "volume": 5,
            },
        ]
        with (
            mock.patch.object(study_server.time, "time", return_value=now / 1000),
            mock.patch.object(
                study_server,
                "load_candle_range",
                return_value=(candles, "bybit", ""),
            ) as load_range,
        ):
            payload = study_server.load_replay_candles(
                "BTCUSDT",
                "60",
                latest_closed,
                500,
            )

        self.assertTrue(load_range.call_args.kwargs["require_complete"])
        self.assertEqual(payload["effectiveCutoff"], latest_closed)
        self.assertEqual(
            [candle["timestamp"] for candle in payload["candles"]],
            [latest_closed],
        )

        with (
            mock.patch.object(study_server.time, "time", return_value=now / 1000),
            mock.patch.object(
                study_server,
                "load_candle_range",
                return_value=(candles, "bybit", ""),
            ) as later_range,
        ):
            later_payload = study_server.load_later_candles(
                "BTCUSDT",
                "60",
                latest_closed - interval_ms,
                100,
            )

        self.assertTrue(later_range.call_args.kwargs["require_complete"])
        self.assertEqual(
            [candle["timestamp"] for candle in later_payload["candles"]],
            [latest_closed],
        )

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

    def test_old_svg_schema_is_rejected_without_data_loss(self):
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
                ("old-1", "video-1", "BTCUSDT", "60", "trend", "[]", "now", "now"),
            )

        with self.assertRaisesRegex(RuntimeError, "不会自动删表"):
            study_server.initialize_database()

        with closing(sqlite3.connect(study_server.DATABASE_FILE)) as connection, connection:
            columns = {row[1] for row in connection.execute("PRAGMA table_info(chart_drawings)")}
            count = connection.execute("SELECT COUNT(*) FROM chart_drawings").fetchone()[0]
        self.assertNotIn("tool_json", columns)
        self.assertIn("points_json", columns)
        self.assertEqual(count, 1)

    def test_learning_state_updates_are_atomic_and_keep_updated_time(self):
        def save_record(index):
            study_server.update_learning_state(
                f"video-{index}",
                {
                    "status": "learning",
                    "note": f"note-{index}",
                    "bookmarked": index % 2 == 0,
                    "updatedAt": f"2026-08-09T12:{index:02d}:00+08:00",
                },
            )

        with ThreadPoolExecutor(max_workers=12) as executor:
            list(executor.map(save_record, range(30)))

        records = study_server.load_state()["records"]
        self.assertEqual(len(records), 30)
        self.assertEqual(records["video-7"]["note"], "note-7")
        self.assertEqual(
            records["video-7"]["updatedAt"],
            "2026-08-09T12:07:00+08:00",
        )

    def test_learning_state_rejects_naive_updated_time(self):
        with self.assertRaisesRegex(ValueError, "必须包含时区"):
            study_server.validate_learning_record(
                {
                    "status": "learned",
                    "note": "",
                    "updatedAt": "2026-08-09T12:00:00",
                }
            )

    def test_paper_trade_rejects_naive_created_time(self):
        with self.assertRaisesRegex(ValueError, "时间格式无效"):
            study_server.save_paper_trade(
                {
                    "id": "trade-naive-time",
                    "videoId": "__global__",
                    "symbol": "BTCUSDT",
                    "interval": "60",
                    "direction": "LONG",
                    "entryPrice": 100,
                    "tpPrice": 110,
                    "slPrice": 95,
                    "status": "OPEN",
                    "createdAt": "2026-08-09T12:00:00",
                }
            )


class PositionReviewStorageTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.original_database_file = study_server.DATABASE_FILE
        self.original_state_file = study_server.STATE_FILE
        study_server.DATABASE_FILE = Path(self.temporary_directory.name) / "review.sqlite"
        study_server.STATE_FILE = Path(self.temporary_directory.name) / "learning-state.json"
        study_server.initialize_database()
        with study_server.DATABASE_LOCK, study_server.database() as connection:
            study_server._upsert_exchange_position(
                connection,
                {
                    "venue": "bitget",
                    "positionId": "pos-1",
                    "unifiedSymbol": "BTC/USDT:USDT",
                    "chartSymbol": "BTCUSDT",
                    "side": "long",
                    "status": "closed",
                    "entryPrice": 60000.0,
                    "exitPrice": 62000.0,
                    "contracts": 1.0,
                    "leverage": 10.0,
                    "marginMode": "crossed",
                    "hedged": False,
                    "realizedPnl": 200.0,
                    "netPnl": 195.0,
                    "funding": -2.0,
                    "openFee": 1.5,
                    "closeFee": 1.5,
                    "entryTimeMs": 1700000000000,
                    "exitTimeMs": 1700010000000,
                },
                "2026-08-26T12:00:00+08:00",
            )

    def tearDown(self):
        study_server.DATABASE_FILE = self.original_database_file
        study_server.STATE_FILE = self.original_state_file
        self.temporary_directory.cleanup()

    def test_create_list_and_delete_tag(self):
        tag1 = study_server.create_position_tag("突破追单")
        tag2 = study_server.create_position_tag("假突破止损")
        tags = study_server.list_position_tags()
        self.assertEqual(len(tags), 2)
        tag_names = {t["name"] for t in tags}
        self.assertIn("突破追单", tag_names)
        self.assertIn("假突破止损", tag_names)

        # map tag to position
        study_server.save_position_tag_map({
            "venue": "bitget",
            "positionId": "pos-1",
            "tagIds": [tag1["id"], tag2["id"]],
        })
        positions = study_server.list_position_review()
        self.assertEqual(len(positions), 1)
        self.assertEqual(set(positions[0]["tagIds"]), {tag1["id"], tag2["id"]})

        # delete tag1 and verify cascade
        study_server.delete_position_tag(tag1["id"])
        tags_after = study_server.list_position_tags()
        self.assertEqual(len(tags_after), 1)
        self.assertEqual(tags_after[0]["name"], "假突破止损")

        positions_after = study_server.list_position_review()
        self.assertEqual(positions_after[0]["tagIds"], [tag2["id"]])

    def test_upsert_keeps_leverage_when_closed_history_omits_it(self):
        with study_server.DATABASE_LOCK, study_server.database() as connection:
            study_server._upsert_exchange_position(
                connection,
                {
                    "venue": "bitget",
                    "positionId": "pos-1",
                    "unifiedSymbol": "BTC/USDT:USDT",
                    "chartSymbol": "BTCUSDT",
                    "side": "long",
                    "status": "closed",
                    "entryPrice": 60000.0,
                    "exitPrice": 62000.0,
                    "contracts": 1.0,
                    "leverage": None,
                    "marginMode": "crossed",
                    "hedged": False,
                    "realizedPnl": 200.0,
                    "netPnl": 195.0,
                    "funding": -2.0,
                    "openFee": 1.5,
                    "closeFee": 1.5,
                    "entryTimeMs": 1700000000000,
                    "exitTimeMs": 1700010000000,
                },
                "2026-08-27T12:00:00+08:00",
            )
        positions = study_server.list_position_review()
        self.assertEqual(positions[0]["leverage"], 10.0)

    def test_migrate_copies_leverage_from_open_row(self):
        open_position = {
            "venue": "bitget",
            "positionId": "open:ETHUSDT:long:1800000000000",
            "unifiedSymbol": "ETH/USDT:USDT",
            "chartSymbol": "ETHUSDT",
            "side": "long",
            "status": "open",
            "entryPrice": 3000.0,
            "exitPrice": None,
            "contracts": 2.0,
            "leverage": 8.0,
            "marginMode": "crossed",
            "hedged": False,
            "realizedPnl": None,
            "netPnl": None,
            "funding": None,
            "openFee": 0.5,
            "closeFee": None,
            "entryTimeMs": 1800000000000,
            "exitTimeMs": None,
        }
        closed_position = {
            **open_position,
            "positionId": "eth-closed-1",
            "status": "closed",
            "exitPrice": 3100.0,
            "leverage": None,
            "realizedPnl": 200.0,
            "netPnl": 198.0,
            "closeFee": 0.5,
            "exitTimeMs": 1800010000000,
        }
        with study_server.DATABASE_LOCK, study_server.database() as connection:
            study_server._upsert_exchange_position(
                connection, open_position, "2026-08-27T12:00:00+08:00"
            )
            study_server._migrate_open_annotations(connection, closed_position)
            study_server._upsert_exchange_position(
                connection, closed_position, "2026-08-27T12:00:00+08:00"
            )
        positions = {
            item["positionId"]: item for item in study_server.list_position_review()
        }
        self.assertEqual(positions["eth-closed-1"]["leverage"], 8.0)
        self.assertNotIn("open:ETHUSDT:long:1800000000000", positions)

    def test_assign_fills_open_reduce_close(self):
        positions = [
            {
                "positionId": "pos-a",
                "chartSymbol": "BTCUSDT",
                "side": "long",
                "status": "closed",
                "entryTimeMs": 1_000,
                "exitTimeMs": 5_000,
            }
        ]
        fills = [
            {
                "execId": "f-open",
                "chartSymbol": "BTCUSDT",
                "side": "buy",
                "tradeSide": "open",
                "timeMs": 1_000,
                "price": 100.0,
                "quantity": 1.0,
                "pnl": 0.0,
            },
            {
                "execId": "f-reduce",
                "chartSymbol": "BTCUSDT",
                "side": "sell",
                "tradeSide": "close",
                "timeMs": 3_000,
                "price": 110.0,
                "quantity": 0.4,
                "pnl": 4.0,
            },
            {
                "execId": "f-close",
                "chartSymbol": "BTCUSDT",
                "side": "sell",
                "tradeSide": "close",
                "timeMs": 5_000,
                "price": 120.0,
                "quantity": 0.6,
                "pnl": 12.0,
            },
        ]
        assigned = study_server.assign_fills_to_positions(positions, fills)
        self.assertEqual(
            [item["kind"] for item in assigned["pos-a"]],
            ["open", "reduce", "close"],
        )

    def test_assign_fills_does_not_cross_adjacent_positions(self):
        positions = [
            {
                "positionId": "first",
                "chartSymbol": "BTCUSDT",
                "side": "long",
                "status": "closed",
                "entryTimeMs": 1_000,
                "exitTimeMs": 5_000,
            },
            {
                "positionId": "second",
                "chartSymbol": "BTCUSDT",
                "side": "long",
                "status": "closed",
                "entryTimeMs": 6_000,
                "exitTimeMs": 9_000,
            },
        ]
        fills = [
            {
                "execId": "a-open",
                "chartSymbol": "BTCUSDT",
                "side": "buy",
                "tradeSide": "open",
                "timeMs": 1_100,
                "price": 100.0,
                "quantity": 1.0,
                "pnl": 0.0,
            },
            {
                "execId": "b-open",
                "chartSymbol": "BTCUSDT",
                "side": "buy",
                "tradeSide": "open",
                "timeMs": 6_100,
                "price": 130.0,
                "quantity": 1.0,
                "pnl": 0.0,
            },
            {
                "execId": "b-close",
                "chartSymbol": "BTCUSDT",
                "side": "sell",
                "tradeSide": "close",
                "timeMs": 8_800,
                "price": 140.0,
                "quantity": 1.0,
                "pnl": 10.0,
            },
        ]
        assigned = study_server.assign_fills_to_positions(positions, fills)
        self.assertEqual([item["execId"] for item in assigned["first"]], ["a-open"])
        self.assertEqual(
            [item["execId"] for item in assigned["second"]],
            ["b-open", "b-close"],
        )
        self.assertEqual([item["kind"] for item in assigned["second"]], ["open", "close"])

    def test_parse_uta_fill_from_bitget_sample(self):
        from bitget_position_provider import parse_uta_fill

        parsed = parse_uta_fill(
            {
                "execId": "1",
                "execPnl": "12.50000000",
                "orderId": "1",
                "symbol": "BTCUSDT",
                "category": "USDT-FUTURES",
                "side": "sell",
                "orderType": "limit",
                "tradeSide": "close",
                "execPrice": "27000.50",
                "execQty": "0.01",
                "execValue": "270.005",
                "feeDetail": [{"feeCoin": "USDT", "fee": "0.108002"}],
                "createdTime": "1697685948870",
            }
        )
        self.assertEqual(parsed["execId"], "1")
        self.assertEqual(parsed["chartSymbol"], "BTCUSDT")
        self.assertEqual(parsed["side"], "sell")
        self.assertEqual(parsed["tradeSide"], "close")
        self.assertEqual(parsed["price"], 27000.50)
        self.assertEqual(parsed["quantity"], 0.01)
        self.assertEqual(parsed["pnl"], 12.5)
        self.assertEqual(parsed["fee"], 0.108002)
        self.assertEqual(parsed["timeMs"], 1697685948870)
        self.assertIsNone(
            parse_uta_fill(
                {
                    "execId": "spot-1",
                    "symbol": "BTCUSDT",
                    "category": "SPOT",
                    "side": "buy",
                    "tradeSide": "open",
                    "execPrice": "27000.50",
                    "execQty": "0.01",
                    "createdTime": "1697685948870",
                }
            )
        )


if __name__ == "__main__":
    unittest.main()
