"""Exness native Bid candles. Signed GET requests only; no trading methods."""

import base64
import hashlib
import io
import json
import math
import re
import threading
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from contextlib import contextmanager
from types import SimpleNamespace
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import HTTPRedirectHandler, Request

import requests

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


TIMEFRAMES = {"1": "M1", "5": "M5", "15": "M15", "60": "H1", "240": "H4", "D": "D1", "W": "W1"}
INTERVAL_MS = {"1": 60_000, "5": 300_000, "15": 900_000, "60": 3_600_000,
               "240": 14_400_000, "D": 86_400_000, "W": 604_800_000}
DEFAULT_GATEWAY = "https://api.exness.com"
PAGE_LIMIT = 1000


def native_symbol(chart_symbol):
    # Keep the existing drawing/position symbol keys; never rewrite old drawings.
    normalized = chart_symbol.upper()
    if normalized.endswith("M") and normalized[:-1] in {"BTCUSD", "XAUUSD", "USTEC"}:
        normalized = normalized[:-1]
    return {"BTCUSDT": "BTCUSD", "NAS100": "USTEC"}.get(normalized, normalized)


def _private_key(secret):
    try:
        raw = bytes.fromhex(secret)
        if len(raw) not in (32, 64):
            raise ValueError()
        key = Ed25519PrivateKey.from_private_bytes(raw[:32])
        if len(raw) == 64 and key.public_key().public_bytes(
                serialization.Encoding.Raw, serialization.PublicFormat.Raw) != raw[32:]:
            raise ValueError()
        return key
    except (ValueError, TypeError):
        raise ValueError("Exness私钥必须是有效的Ed25519十六进制私钥") from None


def validate_credentials(payload):
    if not isinstance(payload, dict):
        raise ValueError("Exness连接参数无效")
    account = str(payload.get("accountId") or "").strip()
    api_key = str(payload.get("apiKey") or "").strip()
    secret = str(payload.get("secret") or "").strip()
    gateway = str(payload.get("gatewayHost") or DEFAULT_GATEWAY).strip().rstrip("/")
    if not re.fullmatch(r"[1-9][0-9]{0,19}", account):
        raise ValueError("请输入有效的Exness交易账户编号")
    if not re.fullmatch(r"exnsk-[A-Za-z0-9_-]{16,200}", api_key):
        raise ValueError("Exness API Key格式无效")
    if gateway not in {DEFAULT_GATEWAY, "https://api.exness-api.com"}:
        raise ValueError("请使用Exness API管理页提供的官方网关主机名")
    _private_key(secret)
    return {"accountId": account, "apiKey": api_key, "secret": secret, "gatewayHost": gateway}


def market_scope(credentials):
    value = f"{credentials['gatewayHost']}|{credentials['accountId']}|bid"
    return "exness:" + hashlib.sha256(value.encode()).hexdigest()[:24]


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class _SignatureError(RuntimeError):
    def __init__(self, clock_offset_ms=None):
        super().__init__("Exness请求签名未通过（AUTH_INVALID_SIGNATURE），请核对本机时间和密钥配对")
        self.clock_offset_ms = clock_offset_ms


class _ApiKeyError(RuntimeError):
    def __init__(self):
        super().__init__("Exness当前未接受API Key（AUTH_INVALID_API_KEY），请检查密钥状态、账户关联及访问限制")


class _SessionOpener:
    def __init__(self):
        self.session = requests.Session()
        adapter = requests.adapters.HTTPAdapter(max_retries=0, pool_connections=2, pool_maxsize=1)
        self.session.mount("https://", adapter)

    @contextmanager
    def open(self, request, timeout):
        headers = {key.upper() if key.lower().startswith("exn-") else key: value
                   for key, value in request.header_items()}
        try:
            with self.session.get(request.full_url, headers=headers, timeout=timeout,
                                  allow_redirects=False, stream=True) as response:
                def read_bounded(size):
                    result = bytearray()
                    for chunk in response.iter_content(chunk_size=min(size, 65_536)):
                        result.extend(chunk)
                        if len(result) >= size:
                            break
                    return bytes(result[:size])

                if response.status_code != 200:
                    raise HTTPError(request.full_url, response.status_code, "Exness request failed",
                                    response.headers, io.BytesIO(read_bounded(4096)))
                yield SimpleNamespace(read=read_bounded)
        except requests.RequestException:
            raise URLError("Exness connection failed") from None


class ExnessMarketDataProvider:
    def __init__(self):
        self.request_lock = threading.Lock()
        self.discovery_lock = threading.Lock()
        self.next_request_at = 0.0
        self.rate_limit_until = 0.0
        self.clock_offset_ms = 0
        self.request_count = 0
        self.access_points = {}
        self.opener = _SessionOpener()
        self.max_requests_per_read = 8

    def _get(self, base_url, path, credentials):
        try:
            return self._signed_get(base_url, path, credentials)
        except _ApiKeyError:
            if base_url == credentials["gatewayHost"] or not re.fullmatch(r"https://[a-z0-9.-]+\.exness\.com", base_url):
                raise
            # Refresh the account binding once after an AP audience rejection.
            # A revoked key still fails discovery/account verification; do not
            # retry the original request until the same account is verified.
            fingerprint = hashlib.sha256((credentials["apiKey"] + credentials["secret"]).encode()).hexdigest()
            with self.discovery_lock:
                self.access_points.pop((market_scope(credentials), fingerprint), None)
            renewed_base = self._access_point(credentials)
            account_path = f"/v1/configuration/accounts/{credentials['accountId']}/account"
            account = self._signed_get(renewed_base, account_path, credentials)
            if str(account.get("account_id")) != credentials["accountId"]:
                raise RuntimeError("Exness返回的账户与连接账户不一致")
            return account if path == account_path else self._signed_get(renewed_base, path, credentials)

    def _signed_get(self, base_url, path, credentials):
        # Only a signed GET rejected for its signature may be rebuilt once,
        # using the HTTPS server clock. Key/permission errors and 429 never retry.
        for attempt in range(2):
            try:
                return self._get_once(base_url, path, credentials)
            except _SignatureError as error:
                if attempt or error.clock_offset_ms is None:
                    raise
                with self.request_lock:
                    self.clock_offset_ms = error.clock_offset_ms

    def _get_once(self, base_url, path, credentials):
        # One shared lane for discovery, configuration and candles, including
        # concurrent browser requests. The observed candle quota is 2/s.
        with self.request_lock:
            if time.monotonic() < self.rate_limit_until:
                remaining = math.ceil(self.rate_limit_until - time.monotonic())
                raise RuntimeError(f"Exness请求频率受限，请在约{remaining}秒后手动重试")
            time.sleep(max(0, self.next_request_at - time.monotonic()))
            self.next_request_at = time.monotonic() + 1.1
            self.request_count += 1
            stamp = int(time.time() * 1000 + self.clock_offset_ms)
            encode = lambda value: base64.urlsafe_b64encode(value).decode().rstrip("=")
            payload = json.dumps({"api_key": credentials["apiKey"], "idempotency_key": "",
                                  "timestamp": stamp, "sign_version": 1, "method": "GET", "path": path,
                                  "body_hash": encode(hashlib.sha256(b"").digest())}, separators=(",", ":")).encode()
            request = Request(base_url + path, method="GET", headers={
                "EXN-API-KEY": credentials["apiKey"], "EXN-IDEMPOTENCY-KEY": "",
                "EXN-TIMESTAMP": str(stamp), "EXN-SIGN-VERSION": "1",
                "EXN-DATA": encode(payload), "EXN-SIGN": encode(_private_key(credentials["secret"]).sign(payload)),
                # Every signature is fresh; authenticated GETs must not reuse
                # an intermediary's cached discovery or authentication response.
                "Cache-Control": "no-cache, no-store", "Pragma": "no-cache",
                "Accept": "application/json", "User-Agent": "TiaBTC-Exness-Replay/1.0"})
            request_started = time.monotonic()
            try:
                with self.opener.open(request, timeout=15) as response:
                    encoded = response.read(5_000_001)
                if len(encoded) > 5_000_000:
                    raise RuntimeError("Exness行情响应超过大小限制")
                data = json.loads(encoded)
                if not isinstance(data, dict):
                    raise ValueError()
                return data
            except HTTPError as error:
                # Never expose headers, signatures, key values or raw responses.
                auth_code = None
                if error.code in (401, 403):
                    try:
                        details = json.loads(error.read(4096))
                        auth_code = details.get("code") if isinstance(details, dict) else None
                    except (ValueError, OSError):
                        pass
                error.close()
                if error.code in (401, 403):
                    if auth_code == 1001:
                        clock_offset_ms = None
                        try:
                            # Date has second precision; use its midpoint and
                            # half the round trip to estimate server time now.
                            server_time = parsedate_to_datetime(error.headers.get("Date", "")).timestamp()
                            offset = (server_time + 0.5 + (time.monotonic() - request_started) / 2 - time.time()) * 1000
                            if math.isfinite(offset) and abs(offset) <= 30_000:
                                clock_offset_ms = offset
                        except (ValueError, TypeError, OverflowError, AttributeError):
                            pass
                        raise _SignatureError(clock_offset_ms) from None
                    if auth_code == 1000:
                        raise _ApiKeyError() from None
                    if auth_code == 1002:
                        raise RuntimeError("Exness读取权限不足（AUTH_PERMISSION_DENIED），请检查账户权限及IP限制") from None
                    raise RuntimeError("Exness鉴权失败，请检查只读密钥、账户权限或IP限制") from None
                if error.code == 404:
                    raise RuntimeError("Exness未提供所请求的数据或品种，请检查账户支持范围") from None
                if error.code == 429:
                    try:
                        cooldown = min(60, max(5, float(error.headers.get("Retry-After", 5))))
                    except (TypeError, ValueError):
                        cooldown = 5
                    self.rate_limit_until = time.monotonic() + cooldown
                    self.next_request_at = self.rate_limit_until
                    raise RuntimeError(f"Exness请求频率受限，请在约{math.ceil(cooldown)}秒后手动重试") from None
                if error.code == 400:
                    raise RuntimeError("Exness不接受该行情时间范围或周期，历史深度以平台实际支持为准") from None
                raise RuntimeError(f"Exness行情服务暂不可用（HTTP {error.code}）") from None
            except (URLError, TimeoutError, OSError):
                raise RuntimeError("Exness行情连接失败，请检查网络后重试") from None
            except (ValueError, TypeError):
                raise RuntimeError("Exness行情响应格式无效") from None

    def _access_point(self, credentials):
        fingerprint = hashlib.sha256((credentials["apiKey"] + credentials["secret"]).encode()).hexdigest()
        key = (market_scope(credentials), fingerprint)
        with self.discovery_lock:
            cached = self.access_points.get(key)
            if cached and time.monotonic() - cached[0] < 600:
                return cached[1]
            path = "/v1/trading/access-point?" + urlencode({"account_id": credentials["accountId"]})
            data = self._get(credentials["gatewayHost"], path, credentials)
            url = urlparse(str(data.get("access_point") or ""))
            if (url.scheme != "https" or not re.fullmatch(r"[a-z0-9.-]+\.exness\.com", url.hostname or "")
                    or url.port not in (None, 443) or url.username or url.password
                    or url.path not in ("", "/") or url.query or url.fragment
                    or str(data.get("account_id")) != credentials["accountId"]):
                raise RuntimeError("Exness返回的账户接入地址无效")
            base = url.geturl().rstrip("/")
            if len(self.access_points) >= 8:
                self.access_points.clear()
            self.access_points[key] = (time.monotonic(), base)
            return base

    def verify(self, credentials):
        data = self._get(self._access_point(credentials),
                         f"/v1/configuration/accounts/{credentials['accountId']}/account", credentials)
        if str(data.get("account_id")) != credentials["accountId"]:
            raise RuntimeError("Exness返回的账户与连接账户不一致")
        currency = data.get("settings", {}).get("currency")
        return str(currency) if isinstance(currency, str) and re.fullmatch(r"[A-Z]{3,8}", currency) else None

    def fetch(self, credentials, symbol, interval, start, end):
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,11}", symbol):
            raise ValueError("Exness品种名称无效")
        if interval not in TIMEFRAMES:
            raise ValueError("不支持该Exness K线周期")
        # End is exclusive locally, even if the upstream returns its boundary bar.
        stamp = lambda ms: datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat()
        params = urlencode({"instrument": symbol, "price_type": "bid", "timeframe": TIMEFRAMES[interval],
                            "from": stamp(start), "to": stamp(end)})
        data = self._get(self._access_point(credentials),
                         f"/v1/market-data/accounts/{credentials['accountId']}/candles?{params}", credentials)
        rows = data.get("candles")
        if not isinstance(rows, list) or len(rows) > PAGE_LIMIT + 1:
            raise RuntimeError("Exness原生K线格式或数量无效")
        result = {}
        try:
            for row in rows:
                date = datetime.fromisoformat(row["time"].replace("Z", "+00:00"))
                if date.tzinfo is None:
                    raise ValueError()
                timestamp = int(date.timestamp() * 1000)
                values = [float(row[key]) for key in ("open", "high", "low", "close")]
                if not all(math.isfinite(value) and value > 0 for value in values):
                    raise ValueError()
                opened, high, low, closed = values
                if low > min(opened, closed) or high < max(opened, closed) or low > high:
                    raise ValueError()
                if start <= timestamp < end:
                    result[timestamp] = dict(zip(("timestamp", "open", "high", "low", "close"), (timestamp, *values)))
        except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
            raise RuntimeError("Exness原生K线数据无效") from None
        return sorted(result.values(), key=lambda row: row["timestamp"])
