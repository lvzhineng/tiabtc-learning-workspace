"""Gate TradFi account reads. Only signed GET endpoints are exposed."""

import calendar
import hashlib
import hmac
import json
import math
import threading
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from gate_cfd_provider import validate_cfd_position_scope


GATE_CFD_VENUE = "gate-cfd"


def _number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def _timestamp(value):
    number = _number(value)
    return int(number * 1000) if number is not None and number > 0 else None


def history_start_ms(now_ms):
    """The API supports one calendar month, not the perpetual 90-day window."""
    now = datetime.fromtimestamp(now_ms / 1000, timezone.utc)
    year, month = (now.year, now.month - 1) if now.month > 1 else (now.year - 1, 12)
    start = now.replace(year=year, month=month, day=min(now.day, calendar.monthrange(year, month)[1]))
    # Leave room for request latency at the server's moving history boundary.
    return int(start.timestamp() * 1000) + 60_000


def parse_cfd_position(row, *, closed):
    if not isinstance(row, dict):
        raise RuntimeError("Gate CFD 仓位格式无效")
    symbol = str(row.get("symbol") or "").strip().upper()
    try:
        validate_cfd_position_scope(symbol, "1")
    except ValueError:
        raise RuntimeError("Gate CFD 仓位品种无效") from None
    side = str(row.get("position_dir") or "").lower()
    position_id = str(row.get("position_id") or "")
    entry = _timestamp(row.get("time_create"))
    exit_time = _timestamp(row.get("time_close")) if closed else None
    price = _number(row.get("price_open"))
    quantity = _number(row.get("volume"))
    if (side not in {"long", "short"} or not position_id.isdigit()
            or len(position_id) > 80 or not entry or price is None or price <= 0
            or quantity is None or quantity <= 0
            or (closed and (not exit_time or exit_time < entry))):
        raise RuntimeError("Gate CFD 仓位字段无效，未保存不完整快照")
    detail = row.get("realized_pnl_detail") or {}
    if not isinstance(detail, dict):
        raise RuntimeError("Gate CFD 盈亏明细格式无效")
    fee = _number(detail.get("fee"))
    net_pnl = _number(row.get("realized_pnl")) if closed else None
    return {
        "venue": GATE_CFD_VENUE, "positionId": position_id,
        "unifiedSymbol": symbol, "chartSymbol": symbol, "side": side,
        "status": "closed" if closed else "open", "entryPrice": price,
        "exitPrice": _number(row.get("close_price")) if closed else None,
        "contracts": quantity, "leverage": None, "marginMode": None, "hedged": True,
        "realizedPnl": _number(detail.get("closed_pnl")) if closed else None,
        "netPnl": net_pnl, "funding": _number(detail.get("swap")) if closed else None,
        "openFee": None, "closeFee": -fee if fee is not None else None,
        "entryTimeMs": entry, "exitTimeMs": exit_time,
    }


class GateCfdPositionProvider:
    PATHS = {"/tradfi/positions", "/tradfi/positions/history", "/tradfi/users/assets"}

    def __init__(self, credentials):
        self.api_key = credentials["apiKey"]
        self.secret = credentials["secret"]
        self.request_lock = threading.Lock()
        self.next_request_at = 0.0

    def _get(self, path, params=None):
        if path not in self.PATHS:
            raise ValueError("不支持的 Gate CFD 只读接口")
        query = urlencode(params or {})
        request_path = "/api/v4" + path
        for attempt in range(3):
            try:
                with self.request_lock:
                    time.sleep(max(0, self.next_request_at - time.monotonic()))
                    self.next_request_at = time.monotonic() + 0.25
                    stamp = str(int(time.time()))
                    message = "\n".join(("GET", request_path, query, hashlib.sha512(b"").hexdigest(), stamp))
                    signature = hmac.new(self.secret.encode(), message.encode(), hashlib.sha512).hexdigest()
                    request = Request(
                        "https://api.gateio.ws" + request_path + ("?" + query if query else ""),
                        headers={"Accept": "application/json", "KEY": self.api_key,
                                 "Timestamp": stamp, "SIGN": signature}, method="GET",
                    )
                    with urlopen(request, timeout=15) as response:
                        encoded = response.read(5_000_001)
                    if len(encoded) > 5_000_000:
                        raise RuntimeError("Gate CFD 账户响应过大")
                    payload = json.loads(encoded)
                if not isinstance(payload, dict):
                    raise RuntimeError("Gate CFD 账户响应格式无效")
                if payload.get("label") or payload.get("code") not in (None, 0, "0"):
                    raise RuntimeError("Gate CFD 账户读取失败，请检查 CFD 开通状态与 API 只读权限")
                data = payload.get("data")
                if not isinstance(data, dict):
                    raise RuntimeError("Gate CFD 账户响应格式无效")
                return data
            except HTTPError as error:
                if error.code != 429 and error.code < 500:
                    # Never include raw account responses, headers or credentials in errors.
                    raise RuntimeError(f"Gate CFD 账户读取失败（HTTP {error.code}），请检查 CFD 开通状态与 API 只读权限") from None
            except (URLError, OSError, TimeoutError):
                pass
            except (ValueError, TypeError):
                raise RuntimeError("Gate CFD 账户响应格式无效") from None
            if attempt < 2:
                time.sleep(0.5 * (attempt + 1))
        raise RuntimeError("Gate CFD 暂时无法连接，请稍后手动同步")

    def fetch_open_positions(self):
        rows = self._get("/tradfi/positions").get("list")
        if not isinstance(rows, list):
            raise RuntimeError("Gate CFD 当前持仓格式无效")
        return [parse_cfd_position(row, closed=False) for row in rows]

    def fetch_closed_positions(self, now_ms):
        positions = {}
        for page in range(1, 101):
            data = self._get("/tradfi/positions/history", {
                "begin_time": history_start_ms(now_ms) // 1000, "end_time": now_ms // 1000,
                "page": page, "page_size": 100,
            })
            rows = data.get("list")
            if not isinstance(rows, list):
                raise RuntimeError("Gate CFD 历史仓位格式无效")
            for row in rows:
                position = parse_cfd_position(row, closed=True)
                positions[position["positionId"]] = position
            total_pages = data.get("total_page")
            if total_pages is not None:
                try:
                    total_pages = int(total_pages)
                except (ValueError, TypeError):
                    raise RuntimeError("Gate CFD 历史分页格式无效") from None
                if page >= total_pages:
                    return list(positions.values())
                if not rows:
                    raise RuntimeError("Gate CFD 历史分页不完整，未保存快照")
            elif len(rows) < 100:
                return list(positions.values())
        raise RuntimeError("Gate CFD 历史仓位超过分页上限，未保存不完整快照")

    def fetch_balance(self):
        total = _number(self._get("/tradfi/users/assets").get("equity"))
        if total is None:
            raise RuntimeError("Gate CFD 账户权益格式无效")
        return {"total": total, "currency": "USD"}
