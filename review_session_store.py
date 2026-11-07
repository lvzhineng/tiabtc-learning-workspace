"""Persistent, isolated review sessions and their editable chart drawings."""

import json
import math
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


SESSION_MARKETS = {"perpetual", "cfd"}
SESSION_INTERVALS = {"1", "5", "15", "60", "240", "D", "W"}
SESSION_BANDS = {"asia", "europe", "america"}
REPLAY_SPEEDS = {1, 2, 5, 10}
MAX_SESSION_TITLE_LENGTH = 100
MAX_SESSIONS_PER_MARKET = 200
MAX_SESSION_DRAWINGS = 500
MAX_SESSION_STATE_BYTES = 64_000


class ReviewSessionNotFoundError(LookupError):
    """Raised when an operation targets a review session that does not exist."""


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


class ReviewSessionStore:
    """SQLite store with injected database, lock, and domain validators."""

    def __init__(
        self,
        database_factory,
        lock,
        drawing_validator,
        perpetual_scope_validator,
        cfd_scope_validator,
        cfd_symbols,
    ):
        self._database = database_factory
        self._lock = lock
        self._drawing_validator = drawing_validator
        self._perpetual_scope_validator = perpetual_scope_validator
        self._cfd_scope_validator = cfd_scope_validator
        # Keep the live directory view: a snapshot would reject newly listed symbols.
        self._cfd_symbols = cfd_symbols

    @staticmethod
    def _validate_market(market):
        if market not in SESSION_MARKETS:
            raise ValueError("复盘市场类型无效")
        return market

    @staticmethod
    def _validate_title(title):
        if not isinstance(title, str):
            raise ValueError("复盘名称必须是文本")
        title = title.strip()
        if not title or len(title) > MAX_SESSION_TITLE_LENGTH or any(ord(char) < 32 for char in title):
            raise ValueError("复盘名称无效，长度需为 1 到 100 个字符")
        return title

    @staticmethod
    def _validate_time(value, field_name, now_ms):
        if not _is_number(value) or value <= 0 or value > now_ms:
            raise ValueError(f"{field_name} 时间无效或晚于当前时间")

    def _validate_symbol_scope(self, market, symbol, interval):
        self._validate_market(market)
        if not isinstance(symbol, str) or not symbol:
            raise ValueError("复盘交易对无效")
        if not isinstance(interval, str) or interval not in SESSION_INTERVALS:
            raise ValueError("不支持该 K 线周期")
        if market == "cfd":
            if symbol not in self._cfd_symbols:
                raise ValueError("不支持该 CFD 品种")
            self._cfd_scope_validator(symbol, interval)
            return
        self._perpetual_scope_validator(symbol, interval)

    def _validate_state(self, market, state, expected_symbol=None):
        self._validate_market(market)
        if not isinstance(state, dict):
            raise ValueError("复盘状态必须是对象")
        allowed_keys = {
            "symbol", "timeframe", "timestampMs", "visibleSpan", "replay",
            "isLogScale", "sessionBands", "showWeekendBands", "videoContext",
        }
        required_keys = allowed_keys - {"videoContext"}
        if set(state) - allowed_keys or required_keys - set(state):
            raise ValueError("复盘状态字段无效")

        symbol = state.get("symbol")
        if expected_symbol is not None and symbol != expected_symbol:
            raise ValueError("复盘记录的交易对不可修改")
        timeframe = state.get("timeframe")
        self._validate_symbol_scope(market, symbol, timeframe)

        now_ms = datetime.now(timezone.utc).timestamp() * 1000
        self._validate_time(state.get("timestampMs"), "复盘定位", now_ms)
        visible_span = state.get("visibleSpan")
        if not _is_number(visible_span) or not 30 <= visible_span <= 200:
            raise ValueError("图表可视范围必须在 30 到 200 根 K 线之间")
        if not isinstance(state.get("isLogScale"), bool):
            raise ValueError("对数价格轴状态无效")
        if not isinstance(state.get("showWeekendBands"), bool):
            raise ValueError("周末分隔线状态无效")

        session_bands = state.get("sessionBands")
        if (
            not isinstance(session_bands, list)
            or any(not isinstance(item, str) or item not in SESSION_BANDS for item in session_bands)
            or len(set(session_bands)) != len(session_bands)
        ):
            raise ValueError("交易时段标记无效")

        replay = state.get("replay")
        if replay is not None:
            if (not isinstance(replay, dict)
                    or set(replay) - {"startTimeMs", "cursorTimeMs", "speed", "daySession"}
                    or {"startTimeMs", "cursorTimeMs", "speed"} - set(replay)):
                raise ValueError("自由复盘状态无效")
            start_time = replay.get("startTimeMs")
            cursor_time = replay.get("cursorTimeMs")
            speed = replay.get("speed")
            self._validate_time(start_time, "自由复盘起点", now_ms)
            self._validate_time(cursor_time, "自由复盘游标", now_ms)
            if start_time > cursor_time:
                raise ValueError("自由复盘起点不能晚于当前游标")
            if not _is_number(speed) or speed not in REPLAY_SPEEDS:
                raise ValueError("自由复盘速度无效")
            if "daySession" in replay:
                session = replay["daySession"]
                if (market != "cfd" or symbol not in {"NAS100", "US500"}
                        or timeframe not in {"1", "5", "15"}
                        or not isinstance(session, dict)
                        or set(session) != {"date", "fromMs", "toMs"}):
                    raise ValueError("美股单日复盘范围无效")
                try:
                    date = session["date"]
                    parsed = datetime.strptime(date, "%Y-%m-%d")
                    if parsed.strftime("%Y-%m-%d") != date or parsed.weekday() >= 5:
                        raise ValueError()
                    zone = ZoneInfo("America/New_York")
                    open_ms = parsed.replace(hour=9, minute=30, tzinfo=zone).timestamp() * 1000
                    close_ms = parsed.replace(hour=16, tzinfo=zone).timestamp() * 1000
                    if (session["fromMs"] != open_ms or session["toMs"] != close_ms
                            or start_time != open_ms or not open_ms <= cursor_time <= close_ms
                            or close_ms > now_ms):
                        raise ValueError()
                except (ValueError, TypeError, OverflowError):
                    raise ValueError("美股单日复盘时间无效") from None

        if "videoContext" in state:
            video_context = state["videoContext"]
            if video_context is not None:
                if not isinstance(video_context, dict) or set(video_context) != {
                    "mode", "videoId", "title", "symbol", "anchorTimeMs",
                }:
                    raise ValueError("视频复盘上下文无效")
                if video_context.get("mode") != "video":
                    raise ValueError("视频复盘上下文无效")
                video_id = video_context.get("videoId")
                video_title = video_context.get("title")
                if not isinstance(video_id, str) or not video_id.strip() or len(video_id) > 200:
                    raise ValueError("视频复盘上下文无效")
                if not isinstance(video_title, str) or len(video_title) > 500:
                    raise ValueError("视频复盘上下文无效")
                if video_context.get("symbol") != symbol:
                    raise ValueError("视频上下文交易对必须与复盘交易对一致")
                self._validate_time(video_context.get("anchorTimeMs"), "视频锚点", now_ms)

        try:
            encoded = json.dumps(state, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        except (TypeError, ValueError):
            raise ValueError("复盘状态无法保存") from None
        if len(encoded.encode("utf-8")) > MAX_SESSION_STATE_BYTES:
            raise ValueError("复盘状态过大")
        return state, encoded, symbol

    def _normalise_drawing(self, market, symbol, raw_drawing, allow_implicit_symbol=False):
        if not isinstance(raw_drawing, dict):
            raise ValueError("画图记录必须是对象")
        # Existing chart drawing clients send these scope/display metadata
        # fields. They are accepted for compatibility and never persisted.
        if set(raw_drawing) - {
            "id", "symbol", "interval", "toolType", "points", "options",
            "videoId", "createdAt", "updatedAt",
        }:
            raise ValueError("画图记录字段无效")
        # List responses intentionally omit symbol; batch replacements can
        # send those normalized rows back unchanged. When provided, scope is
        # still checked against the immutable session symbol.
        if "symbol" not in raw_drawing and not allow_implicit_symbol:
            raise ValueError("画图交易对必填")
        drawing_symbol = raw_drawing.get("symbol", symbol)
        interval = raw_drawing.get("interval")
        if drawing_symbol != symbol:
            raise ValueError("画图交易对必须与复盘记录一致")
        self._validate_symbol_scope(market, drawing_symbol, interval)
        drawing, _encoded = self._drawing_validator(raw_drawing)
        normalized = {**drawing, "interval": interval}
        encoded = json.dumps(normalized, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        return normalized, encoded

    def _normalise_drawings(self, market, symbol, drawings, allow_implicit_symbol=False):
        if not isinstance(drawings, list) or len(drawings) > MAX_SESSION_DRAWINGS:
            raise ValueError("复盘画图数量无效，最多保存 500 张")
        normalized = []
        seen_ids = set()
        for raw_drawing in drawings:
            drawing, encoded = self._normalise_drawing(
                market, symbol, raw_drawing, allow_implicit_symbol=allow_implicit_symbol
            )
            if drawing["id"] in seen_ids:
                raise ValueError("画图 ID 重复")
            seen_ids.add(drawing["id"])
            normalized.append((drawing, encoded))
        return normalized

    @staticmethod
    def _parse_drawings(drawings_json):
        drawings = json.loads(drawings_json)
        if not isinstance(drawings, list):
            raise ValueError("复盘画图数据格式无效")
        return drawings

    @staticmethod
    def _detail(row):
        drawings = ReviewSessionStore._parse_drawings(row["drawings_json"])
        return {
            "id": row["id"],
            "title": row["title"],
            "market": row["market"],
            "symbol": row["symbol"],
            "state": json.loads(row["state_json"]),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "drawingCount": len(drawings),
        }

    @staticmethod
    def _summary(row):
        state = json.loads(row["state_json"])
        drawings = ReviewSessionStore._parse_drawings(row["drawings_json"])
        return {
            "id": row["id"],
            "title": row["title"],
            "market": row["market"],
            "symbol": row["symbol"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "drawingCount": len(drawings),
            "timeframe": state["timeframe"],
            "timestampMs": state["timestampMs"],
        }

    def list_sessions(self, market):
        self._validate_market(market)
        with self._lock, self._database() as connection:
            rows = connection.execute(
                """SELECT id, title, market, symbol, state_json, drawings_json, created_at, updated_at
                   FROM review_sessions WHERE market = ?
                   ORDER BY updated_at DESC, id DESC LIMIT ?""",
                (market, MAX_SESSIONS_PER_MARKET),
            ).fetchall()
        return [self._summary(row) for row in rows]

    def create_session(self, payload):
        if not isinstance(payload, dict):
            raise ValueError("复盘档案必须是对象")
        if set(payload) - {"market", "title", "state", "drawings"}:
            raise ValueError("复盘档案字段无效")
        market = self._validate_market(payload.get("market"))
        state, encoded_state, symbol = self._validate_state(market, payload.get("state"))
        title = self._validate_title(payload["title"]) if "title" in payload else (
            f"{symbol} {datetime.now().astimezone().strftime('%Y-%m-%d %H:%M')}"
        )
        drawings = self._normalise_drawings(market, symbol, payload.get("drawings", []))
        session_id = str(uuid.uuid4())
        now = _now_iso()
        encoded_drawings = json.dumps(
            [drawing for drawing, _encoded in drawings],
            ensure_ascii=False,
            separators=(",", ":"),
        )
        with self._lock, self._database() as connection:
            connection.execute(
                """INSERT INTO review_sessions
                   (id, title, market, symbol, state_json, drawings_json, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (session_id, title, market, symbol, encoded_state, encoded_drawings, now, now),
            )
            row = connection.execute(
                """SELECT id, title, market, symbol, state_json, drawings_json, created_at, updated_at
                   FROM review_sessions WHERE id = ?""",
                (session_id,),
            ).fetchone()
        return self._detail(row)

    def get_session(self, session_id):
        with self._lock, self._database() as connection:
            row = connection.execute(
                """SELECT id, title, market, symbol, state_json, drawings_json, created_at, updated_at
                   FROM review_sessions WHERE id = ?""",
                (session_id,),
            ).fetchone()
        if row is None:
            raise ReviewSessionNotFoundError("复盘档案不存在")
        return self._detail(row)

    def update_session(self, session_id, payload):
        if not isinstance(payload, dict) or not payload or set(payload) - {"title", "state"}:
            raise ValueError("复盘档案更新字段无效")
        with self._lock, self._database() as connection:
            row = connection.execute(
                """SELECT id, title, market, symbol, state_json, drawings_json, created_at, updated_at
                   FROM review_sessions WHERE id = ?""",
                (session_id,),
            ).fetchone()
            if row is None:
                raise ReviewSessionNotFoundError("复盘档案不存在")

            title = self._validate_title(payload["title"]) if "title" in payload else row["title"]
            if "state" in payload:
                _state, encoded_state, _symbol = self._validate_state(
                    row["market"], payload["state"], expected_symbol=row["symbol"]
                )
            else:
                encoded_state = row["state_json"]
            updated_at = _now_iso()
            connection.execute(
                """UPDATE review_sessions SET title = ?, state_json = ?, updated_at = ?
                   WHERE id = ?""",
                (title, encoded_state, updated_at, session_id),
            )
            updated = connection.execute(
                """SELECT id, title, market, symbol, state_json, drawings_json, created_at, updated_at
                   FROM review_sessions WHERE id = ?""",
                (session_id,),
            ).fetchone()
        return self._detail(updated)

    def list_drawings(self, session_id):
        with self._lock, self._database() as connection:
            row = connection.execute(
                "SELECT drawings_json FROM review_sessions WHERE id = ?", (session_id,)
            ).fetchone()
        if row is None:
            raise ReviewSessionNotFoundError("复盘档案不存在")
        return self._parse_drawings(row["drawings_json"])

    def save_drawing(self, session_id, raw_drawing):
        with self._lock, self._database() as connection:
            row = connection.execute(
                """SELECT market, symbol, drawings_json FROM review_sessions WHERE id = ?""",
                (session_id,),
            ).fetchone()
            if row is None:
                raise ReviewSessionNotFoundError("复盘档案不存在")
            drawing, _encoded = self._normalise_drawing(row["market"], row["symbol"], raw_drawing)
            drawings = self._parse_drawings(row["drawings_json"])
            existing_index = next(
                (index for index, item in enumerate(drawings) if item.get("id") == drawing["id"]),
                None,
            )
            if existing_index is None and len(drawings) >= MAX_SESSION_DRAWINGS:
                raise ValueError("复盘画图数量已达到 500 张上限")
            if existing_index is None:
                drawings.append(drawing)
            else:
                drawings[existing_index] = drawing
            encoded_drawings = json.dumps(
                drawings, ensure_ascii=False, separators=(",", ":"), allow_nan=False
            )
            updated_at = _now_iso()
            connection.execute(
                "UPDATE review_sessions SET drawings_json = ?, updated_at = ? WHERE id = ?",
                (encoded_drawings, updated_at, session_id),
            )
        return drawing

    def replace_drawings(self, session_id, payload):
        if not isinstance(payload, dict) or set(payload) != {"drawings"}:
            raise ValueError("画图批量记录无效")
        with self._lock, self._database() as connection:
            row = connection.execute(
                "SELECT market, symbol FROM review_sessions WHERE id = ?", (session_id,)
            ).fetchone()
            if row is None:
                raise ReviewSessionNotFoundError("复盘档案不存在")
            drawings = self._normalise_drawings(
                row["market"], row["symbol"], payload.get("drawings"),
                allow_implicit_symbol=True,
            )
            encoded_drawings = json.dumps(
                [drawing for drawing, _encoded in drawings],
                ensure_ascii=False,
                separators=(",", ":"),
                allow_nan=False,
            )
            updated_at = _now_iso()
            connection.execute(
                "UPDATE review_sessions SET drawings_json = ?, updated_at = ? WHERE id = ?",
                (encoded_drawings, updated_at, session_id),
            )
        return [drawing for drawing, _encoded in drawings]

    def delete_drawing(self, session_id, drawing_id=None):
        with self._lock, self._database() as connection:
            row = connection.execute(
                "SELECT drawings_json FROM review_sessions WHERE id = ?", (session_id,)
            ).fetchone()
            if row is None:
                raise ReviewSessionNotFoundError("复盘档案不存在")
            if drawing_id is None:
                drawings = []
            else:
                drawings = [
                    drawing for drawing in self._parse_drawings(row["drawings_json"])
                    if drawing.get("id") != drawing_id
                ]
            encoded_drawings = json.dumps(
                drawings, ensure_ascii=False, separators=(",", ":"), allow_nan=False
            )
            connection.execute(
                "UPDATE review_sessions SET drawings_json = ?, updated_at = ? WHERE id = ?",
                (encoded_drawings, _now_iso(), session_id),
            )
