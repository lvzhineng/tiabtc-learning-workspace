"""Read-only Gate TradFi/CFD public market data (no account credentials)."""

import json
import math
import re
import threading
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


CFD_SYMBOLS = {
    "XAUUSD": {"symbol": "XAUUSD", "name": "黄金", "quote": "USD"},
    "XAGUSD": {"symbol": "XAGUSD", "name": "白银", "quote": "USD"},
    "NAS100": {"symbol": "NAS100", "name": "纳斯达克100", "quote": "USD"},
    "US500": {"symbol": "US500", "name": "标普500", "quote": "USD"},
    "JPN225": {"symbol": "JPN225", "name": "日经225", "quote": "JPY"},
}
CFD_CATEGORY_NAMES = {1: "金属", 2: "股票及 ETF", 3: "指数", 4: "外汇", 5: "大宗商品"}
for _symbol, _item in CFD_SYMBOLS.items():
    _category = 1 if _symbol in {"XAUUSD", "XAGUSD"} else 3
    _item.update(categoryId=_category, categoryName=CFD_CATEGORY_NAMES[_category], isBase=True)
CFD_TIMEFRAMES = {"1": "1m", "5": "5m", "15": "15m", "60": "1h", "240": "4h", "D": "1d", "W": "7d"}
CFD_INTERVAL_MS = {"1": 60_000, "5": 300_000, "15": 900_000, "60": 3_600_000, "240": 14_400_000, "D": 86_400_000, "W": 604_800_000}


def validate_cfd_scope(symbol, interval):
    validate_cfd_position_scope(symbol, interval)
    if symbol not in CFD_SYMBOLS:
        raise ValueError("不支持该 CFD 品种")
    if interval not in CFD_TIMEFRAMES:
        raise ValueError("不支持该 CFD K 线周期")


def validate_cfd_position_scope(symbol, interval):
    # Symbols are opaque upstream IDs: never strip numeric leverage suffixes.
    if not isinstance(symbol, str) or not re.fullmatch(r"[A-Z0-9][A-Z0-9._-]{0,39}", symbol):
        raise ValueError("CFD 仓位品种无效")
    if interval not in CFD_TIMEFRAMES:
        raise ValueError("不支持该 CFD K 线周期")


class GateCfdRequestError(RuntimeError):
    def __init__(self, label, message):
        self.label = label
        super().__init__(message)


class GateCfdMarketDataProvider:
    PAGE_LIMIT = 500

    def __init__(self):
        self.request_lock = threading.Lock()
        self.next_request_at = 0.0

    def fetch_directory(self, categories=False):
        suffix = "/categories" if categories else ""
        url = f"https://api.gateio.ws/api/v4/tradfi/symbols{suffix}"
        try:
            with self.request_lock:
                time.sleep(max(0, self.next_request_at - time.monotonic()))
                self.next_request_at = time.monotonic() + 0.25
                request = Request(url, headers={"Accept": "application/json", "User-Agent": "TiaBTC-CFD-Replay/1.0"})
                with urlopen(request, timeout=12) as response:
                    encoded = response.read(5_000_001)
            if len(encoded) > 5_000_000:
                raise ValueError("oversized directory")
            payload = json.loads(encoded)
            rows = payload.get("data", {}).get("list")
            if payload.get("label") or not isinstance(rows, list) or not rows:
                raise ValueError("invalid directory")
            return rows
        except (OSError, ValueError, TypeError, AttributeError) as error:
            raise RuntimeError("Gate 品种目录暂时无法获取，使用本机已有目录") from error

    def _request(self, symbol, params):
        url = f"https://api.gateio.ws/api/v4/tradfi/symbols/{symbol}/klines?{urlencode(params)}"
        for attempt in range(3):
            try:
                with self.request_lock:
                    time.sleep(max(0, self.next_request_at - time.monotonic()))
                    self.next_request_at = time.monotonic() + 0.25
                    request = Request(url, headers={"Accept": "application/json", "User-Agent": "TiaBTC-CFD-Replay/1.0"})
                    with urlopen(request, timeout=12) as response:
                        encoded = response.read(5_000_001)
                    if len(encoded) > 5_000_000:
                        raise RuntimeError("Gate CFD 行情响应过大")
                    data = json.loads(encoded)
                if not isinstance(data, dict) or data.get("label"):
                    raise GateCfdRequestError(str(data.get("label", "")), "Gate CFD 返回行情错误")
                rows = data.get("data", {}).get("list")
                if not isinstance(rows, list):
                    raise RuntimeError("Gate CFD 行情格式无效")
                candles = {}
                for row in rows:
                    timestamp = int(row["t"]) * 1000
                    prices = [float(row[key]) for key in ("o", "h", "l", "c")]
                    if timestamp <= 0 or not all(math.isfinite(value) and value > 0 for value in prices):
                        raise ValueError("invalid OHLC")
                    if prices[1] < max(prices[0], prices[2], prices[3]) or prices[2] > min(prices[0], prices[1], prices[3]):
                        raise ValueError("invalid OHLC range")
                    candles[timestamp] = dict(zip(("timestamp", "open", "high", "low", "close"), (timestamp, *prices)))
                return sorted(candles.values(), key=lambda row: row["timestamp"])
            except HTTPError as error:
                try:
                    data = json.loads(error.read(4096))
                except (ValueError, OSError):
                    data = {}
                label = str(data.get("label", ""))
                message = str(data.get("message", ""))
                if error.code < 500 and error.code != 429 and label != "INTERNAL_SERVER_ERROR":
                    raise GateCfdRequestError(label, f"Gate CFD 请求失败：{message or label or error.code}") from None
            except (URLError, TimeoutError, OSError):
                pass
            except (ValueError, TypeError, KeyError, AttributeError) as error:
                raise RuntimeError("Gate CFD 行情格式无效") from error
            if attempt < 2:
                time.sleep(0.5 * (attempt + 1))
        raise RuntimeError("Gate CFD 暂时无法连接，请稍后重试")

    def fetch(self, symbol, interval, *, start=None, end=None, limit=None):
        validate_cfd_position_scope(symbol, interval)
        params = {"kline_type": CFD_TIMEFRAMES[interval]}
        if start is not None:
            params["begin_time"] = start // 1000
        if end is not None:
            params["end_time"] = end // 1000
        # Gate rejects begin_time + end_time + limit together.
        if limit is not None and start is None:
            params["limit"] = min(self.PAGE_LIMIT, limit)
        try:
            return self._request(symbol, params)
        except GateCfdRequestError as error:
            message = str(error).lower()
            if interval != "5" or not ("kline" in message and any(word in message for word in ("unsupported", "not support", "不支持"))):
                raise
            # Only an explicit unsupported-period error permits aggregation.
            end = end if end is not None else int(time.time() * 1000)
            start = start if start is not None else end - (limit or 500) * 300_000 * 3
            raw = []
            cursor = start
            while cursor <= end:
                page_end = min(end, cursor + (self.PAGE_LIMIT - 1) * 60_000)
                raw.extend(self.fetch(symbol, "1", start=cursor, end=page_end))
                cursor = page_end + 1000
            grouped = {}
            for row in raw:
                stamp = row["timestamp"] // 300_000 * 300_000
                item = grouped.setdefault(stamp, {**row, "timestamp": stamp})
                item["high"] = max(item["high"], row["high"])
                item["low"] = min(item["low"], row["low"])
                item["close"] = row["close"]
            result = sorted(grouped.values(), key=lambda row: row["timestamp"])
            return result[-limit:] if limit else result


class GateCfdSymbolCatalog:
    """Public directory with bounded refresh and an atomic, non-sensitive snapshot.

    Previously seen symbols remain valid for cached candles, drawings and archives.
    Only this directory refresh extends the global-market allowlist.
    """

    TTL_SECONDS = 3600
    RETRY_SECONDS = 60
    CATEGORY_TRANSLATIONS = {
        "metals": "金属", "stocks": "股票及 ETF", "indices": "指数",
        "forex": "外汇", "commodities": "大宗商品",
    }
    DISPLAY_NAMES = {
        "XAUUSD": "黄金", "XAGUSD": "白银", "NAS100": "纳斯达克100",
        "US500": "标普500", "JPN225": "日经225", "US30": "道琼斯30",
        "GER40": "德国DAX40", "HK50": "恒生50", "UK100": "英国富时100",
        "US2000": "罗素2000", "CHCUSD": "中国A50", "XTIUSD": "WTI原油",
        "XBRUSD": "布伦特原油", "NG": "天然气", "GAS": "汽油",
        "WHEAT": "小麦", "SOYBEAN": "大豆", "XCU": "铜", "XNI": "镍",
        "XPDUSD": "钯金", "XPTUSD": "铂金", "XAL": "铝", "XPB": "铅",
        "AAPL": "苹果", "NVDA": "英伟达", "TSLA": "特斯拉", "MSFT": "微软",
        "AMZN": "亚马逊", "META": "Meta", "GOOGL": "谷歌", "BABA": "阿里巴巴",
        "TENCENT": "腾讯", "XIAOMI": "小米", "QQQ": "纳指100 ETF",
    }
    CURRENCY_NAMES = {
        "EUR": "欧元", "USD": "美元", "GBP": "英镑", "JPY": "日元",
        "AUD": "澳元", "NZD": "纽元", "CAD": "加元", "CHF": "瑞郎",
        "CNH": "离岸人民币", "HKD": "港元", "SGD": "新加坡元",
    }

    def __init__(self, provider, cache_file):
        self.provider = provider
        self.cache_file = Path(cache_file)
        self.lock = threading.Lock()
        self.fetched_at = 0.0
        self.next_attempt_at = 0.0
        self.active_symbols = set(CFD_SYMBOLS)
        self.warning = None
        try:
            with self.cache_file.open("rb") as stream:
                encoded = stream.read(5_000_001)
            if len(encoded) > 5_000_000:
                raise ValueError("oversized snapshot")
            snapshot = json.loads(encoded)
            items = snapshot["symbols"]
            if not isinstance(items, list) or not 1 <= len(items) <= 10000:
                raise ValueError("invalid snapshot")
            restored = {}
            for item in items:
                validate_cfd_position_scope(item["symbol"], "1")
                if not isinstance(item.get("categoryId"), int) or not isinstance(item.get("name"), str):
                    raise ValueError("invalid snapshot item")
                if not isinstance(item.get("categoryName"), str) or not isinstance(item.get("isBase"), bool):
                    raise ValueError("invalid snapshot category")
                restored[item["symbol"]] = item
            active = snapshot["activeSymbols"]
            if not isinstance(active, list) or not active or any(symbol not in restored for symbol in active):
                raise ValueError("invalid active symbols")
            fetched_at = float(snapshot["fetchedAt"])
            if not math.isfinite(fetched_at) or not 0 < fetched_at <= time.time():
                raise ValueError("invalid snapshot time")
            CFD_SYMBOLS.update(restored)
            self.active_symbols = set(active)
            self.fetched_at = fetched_at
        except (OSError, ValueError, TypeError, KeyError, AttributeError):
            pass

    def _normalize(self, rows, categories):
        if len(rows) > 10000:
            raise RuntimeError("Gate 品种目录超出数量限制，使用本机已有目录")
        symbols = {}
        for row in rows:
            symbol = row.get("symbol")
            validate_cfd_position_scope(symbol, "1")
            category_id = int(row["category_id"])
            description = str(row.get("symbol_desc") or symbol)[:200]
            name = self.DISPLAY_NAMES.get(symbol, description)
            if categories.get(category_id) == "外汇" and len(symbol) == 6:
                currencies = [self.CURRENCY_NAMES.get(symbol[:3]), self.CURRENCY_NAMES.get(symbol[3:])]
                if all(currencies):
                    name = "/".join(currencies)
            precision = row.get("price_precision")
            symbols[symbol] = {
                "symbol": symbol, "name": name, "description": description,
                "categoryId": category_id, "categoryName": categories.get(category_id, "其他"),
                # This is the upstream settlement currency, not an inferred quote.
                "settlementCurrency": str(row.get("settlement_currency") or ""),
                "pricePrecision": precision if isinstance(precision, int) and 0 <= precision <= 8 else None,
                "status": str(row.get("status") or "unknown"),
                "isBase": row.get("is_base") is not False,
                "tradeMode": str(row.get("trade_mode") or ""),
            }
        if not symbols:
            raise RuntimeError("Gate 品种目录为空，使用本机已有目录")
        return symbols

    def remember(self, symbols):
        """Keep historical scopes usable even when the directory snapshot is lost."""
        with self.lock:
            for symbol in symbols:
                try:
                    validate_cfd_position_scope(symbol, "1")
                except ValueError:
                    continue
                CFD_SYMBOLS.setdefault(symbol, {
                    "symbol": symbol, "name": self.DISPLAY_NAMES.get(symbol, symbol),
                    "categoryId": -1, "categoryName": "历史品种", "isBase": True,
                    "status": "unavailable",
                })

    def get(self, *, refresh=False, offline=False):
        with self.lock:
            now = time.time()
            if not offline and now >= self.next_attempt_at and (refresh or now - self.fetched_at >= self.TTL_SECONDS):
                self.next_attempt_at = now + self.RETRY_SECONDS
                try:
                    categories = dict(CFD_CATEGORY_NAMES)
                    # Category failure must not hide otherwise usable symbols.
                    try:
                        for item in self.provider.fetch_directory(categories=True):
                            if not item.get("is_favorite"):
                                name = str(item["category_name"])
                                categories[int(item["category_id"])] = self.CATEGORY_TRANSLATIONS.get(name.lower(), name)
                    except RuntimeError:
                        pass
                    symbols = self._normalize(self.provider.fetch_directory(), categories)
                    CFD_SYMBOLS.update(symbols)
                    self.active_symbols = set(symbols)
                    self.fetched_at = now
                    self.warning = None
                    try:
                        self.cache_file.parent.mkdir(parents=True, exist_ok=True)
                        temporary = self.cache_file.with_suffix(".tmp")
                        temporary.write_text(json.dumps({
                            "symbols": list(CFD_SYMBOLS.values()),
                            "activeSymbols": sorted(self.active_symbols), "fetchedAt": now,
                        }, ensure_ascii=False), encoding="utf-8")
                        temporary.replace(self.cache_file)
                    except OSError:
                        self.warning = "目录已更新，但本机目录快照未能保存"
                except (RuntimeError, ValueError, TypeError, KeyError, AttributeError):
                    self.warning = "Gate 品种目录暂时无法获取，使用本机已有目录；稍后可刷新重试"
            symbols = [dict(item) if symbol in self.active_symbols else {**item, "status": "unavailable"}
                       for symbol, item in CFD_SYMBOLS.items()]
            return {
                "symbols": symbols, "source": "gate-cfd", "updatedAt": self.fetched_at * 1000 or None,
                "stale": offline or now - self.fetched_at >= self.TTL_SECONDS,
                "warning": "离线模式：使用本机已有品种目录" if offline else self.warning,
            }
