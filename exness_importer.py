"""Incremental, local-only import of closed Exness CSV position legs."""

import csv
import hashlib
import io
import json
import math
import re
import threading
import time
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation


# Stable UI/drawing keys from the initial importer. These are aliases only;
# Exness candles are always read from Exness using the original instrument.
EXNESS_CHART_ALIASES = {"USTEC": "NAS100", "XAUUSD": "XAUUSD", "BTCUSD": "BTCUSDT"}
IMPORT_INTERVAL_SECONDS = 30
MAX_FILE_BYTES = 20_000_000
REQUIRED_COLUMNS = {"ticket", "opening_time_utc", "closing_time_utc", "type", "lots",
                    "original_position_size", "symbol", "opening_price", "closing_price", "profit"}


def chart_symbol(symbol):
    normalized = symbol.strip().upper()
    base = normalized[:-1] if normalized.endswith("M") and normalized[:-1] in EXNESS_CHART_ALIASES else normalized
    return EXNESS_CHART_ALIASES.get(base, normalized)


def _number(value, name, positive=False, optional=False):
    if optional and not str(value or "").strip():
        return None
    try:
        result = Decimal(str(value).strip())
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError(f"{name}不是有效数值") from None
    if not result.is_finite() or not math.isfinite(float(result)) or (positive and result <= 0):
        raise ValueError(f"{name}超出有效范围")
    return str(result.normalize())


def _utc_ms(value):
    try:
        date = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
        if date.tzinfo is None:
            date = date.replace(tzinfo=timezone.utc)
        stamp = int(date.timestamp() * 1000)
        if stamp < 1_230_768_000_000 or stamp > int(time.time() * 1000) + 60_000:
            raise ValueError()
        return stamp
    except (ValueError, TypeError, OverflowError):
        raise ValueError("UTC交易时间无效") from None


def parse_exness_csv(content):
    reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig"), newline=""), strict=True)
    if not REQUIRED_COLUMNS.issubset(reader.fieldnames or []):
        raise ValueError("CSV缺少Exness交易记录字段")
    rows = []
    for number, row in enumerate(reader, 2):
        if not any(row.values()):
            continue
        if len(rows) >= 100_000:
            raise ValueError("单文件交易记录超过100000条")
        try:
            ticket = str(row.get("ticket", "")).strip()
            if not re.fullmatch(r"\d{1,40}", ticket):
                raise ValueError("ticket格式无效")
            side = str(row.get("type", "")).strip().lower()
            symbol = str(row.get("symbol", "")).strip().upper()
            if side not in {"buy", "sell"} or not re.fullmatch(r"[A-Z0-9._-]{2,40}", symbol):
                raise ValueError("仅支持buy/sell交易及有效品种")
            opened, closed = _utc_ms(row["opening_time_utc"]), _utc_ms(row["closing_time_utc"])
            if closed < opened:
                raise ValueError("平仓时间早于开仓时间")
            leg = {"ticket": ticket, "positionId": f"default:{ticket}", "symbol": symbol,
                   "side": "long" if side == "buy" else "short", "entryTimeMs": opened, "exitTimeMs": closed,
                   "lots": _number(row["lots"], "平仓手数", positive=True),
                   "originalLots": _number(row["original_position_size"], "原始手数", positive=True),
                   "entryPrice": _number(row["opening_price"], "开仓价", positive=True),
                   "exitPrice": _number(row["closing_price"], "平仓价", positive=True),
                   "profit": _number(row["profit"], "利润"),
                   "commission": _number(row.get("commission"), "手续费", optional=True),
                   "swap": _number(row.get("swap"), "隔夜费", optional=True)}
            rows.append(leg)
        except ValueError as error:
            raise ValueError(f"第{number}行：{error}") from None
    # CSV has no execution ID. Match exact close signatures across overlapping
    # exports; time alone would merge distinct partial closes in the same second.
    rows.sort(key=lambda row: (row["positionId"], row["exitTimeMs"], row["lots"], row["exitPrice"], row["profit"]))
    occurrences = defaultdict(int)
    for row in rows:
        key = (row["positionId"], row["exitTimeMs"], row["lots"], row["exitPrice"], row["profit"])
        slot = occurrences[key]
        occurrences[key] += 1
        row["id"] = hashlib.sha256(json.dumps([*key, slot]).encode()).hexdigest()
    return rows


def aggregate_position(legs):
    first = min(legs, key=lambda leg: leg["entryTimeMs"])
    for leg in legs:
        if (leg["symbol"], leg["side"], leg["entryTimeMs"], leg["originalLots"]) != (
                first["symbol"], first["side"], first["entryTimeMs"], first["originalLots"]):
            raise ValueError("同一ticket的仓位信息不一致，请确认目录只放同一账户的导出")
    original = Decimal(first["originalLots"])
    quantity = sum((Decimal(leg["lots"]) for leg in legs), Decimal(0))
    if quantity > original + Decimal("0.00000001"):
        raise ValueError("同一ticket的累计平仓手数超过原始手数，请核对导出文件")
    closed = abs(original - quantity) <= Decimal("0.00000001")
    price = sum(Decimal(leg["exitPrice"]) * Decimal(leg["lots"]) for leg in legs) / quantity
    chart = chart_symbol(first["symbol"])
    return {"venue": "exness", "positionId": first["positionId"], "unifiedSymbol": first["symbol"],
            "chartSymbol": chart, "side": first["side"], "status": "closed" if closed else "open",
            "entryPrice": float(Decimal(first["entryPrice"])), "exitPrice": float(price) if closed else None,
            "contracts": float(original), "contractSize": None, "leverage": None, "marginMode": None,
            "hedged": False, "realizedPnl": float(sum(Decimal(leg["profit"]) for leg in legs)),
            "netPnl": None, "funding": None, "openFee": None, "closeFee": None,
            "entryTimeMs": first["entryTimeMs"], "exitTimeMs": max(leg["exitTimeMs"] for leg in legs) if closed else None}


def read_exness_fills(connection, positions):
    result = {}
    imported = [position for position in positions if position["venue"] == "exness"]
    for start in range(0, len(imported), 200):
        chunk = imported[start:start + 200]
        ids = [position["positionId"] for position in chunk]
        placeholders = ",".join("?" for _ in ids)
        rows = connection.execute(
            f"SELECT position_id, payload_json FROM exness_trade_legs WHERE position_id IN ({placeholders}) ORDER BY exit_time_ms, id", ids
        ).fetchall()
        grouped = defaultdict(list)
        for row in rows:
            grouped[row["position_id"]].append(json.loads(row["payload_json"]))
        for position in chunk:
            legs = grouped[position["positionId"]]
            fills = []
            for index, leg in enumerate(legs):
                fills.append({"execId": leg["id"], "timeMs": leg["exitTimeMs"],
                              "side": "sell" if position["side"] == "long" else "buy", "tradeSide": "close",
                              "kind": "close" if position["status"] == "closed" and index == len(legs) - 1 else "reduce",
                              "price": float(Decimal(leg["exitPrice"])), "quantity": float(Decimal(leg["lots"])),
                              "pnl": float(Decimal(leg["profit"]))})
            result[("exness", position["positionId"])] = fills
    return result


class ExnessImporter:
    def __init__(self, directory, database, database_lock, upsert_position, enabled=lambda: True):
        self.directory, self.database = directory, database
        self.database_lock, self.upsert_position = database_lock, upsert_position
        self.enabled = enabled
        self.lock = threading.Lock()
        self.last_check = 0.0
        self.file_fingerprints = {}
        self.state = {"directory": "data/exness", "checkedAt": None, "importedAt": None,
                      "fileCount": 0, "positionCount": 0, "legCount": 0, "added": 0, "updated": 0,
                      "skipped": 0, "warning": None}

    def status(self):
        with self.lock:
            return dict(self.state)

    def scan(self, force=False):
        if not force and not self.enabled():
            return self.status()
        with self.lock:
            if not force and time.monotonic() - self.last_check < IMPORT_INTERVAL_SECONDS:
                return dict(self.state)
            self.last_check = time.monotonic()
            now = datetime.now(timezone.utc).isoformat()
            files = sorted(self.directory.glob("*.csv")) if self.directory.exists() else []
            warnings = []
            added, updated, skipped, processed = set(), set(), 0, 0
            for path in files[:1000]:
                try:
                    stat = path.stat()
                    if path.is_symlink() or path.resolve().parent != self.directory.resolve():
                        raise ValueError("不读取目录外的链接文件")
                    if stat.st_size > MAX_FILE_BYTES:
                        raise ValueError("文件超过20MB")
                    if time.time() - stat.st_mtime < 1:
                        continue
                    fingerprint = (stat.st_mtime_ns, stat.st_size)
                    if self.file_fingerprints.get(path.name) == fingerprint:
                        skipped += 1
                        continue
                    content = path.read_bytes()
                    if (path.stat().st_mtime_ns, path.stat().st_size) != (stat.st_mtime_ns, stat.st_size):
                        continue
                    digest = hashlib.sha256(content).hexdigest()
                    with self.database_lock, self.database() as connection:
                        existing = connection.execute("SELECT digest FROM exness_import_files WHERE path=?", (path.name,)).fetchone()
                    if existing and existing["digest"] == digest:
                        self.file_fingerprints[path.name] = fingerprint
                        skipped += 1
                        continue
                    legs = parse_exness_csv(content)
                    new, changed = self._import_file(path.name, digest, stat.st_mtime_ns, legs, now)
                    added.update(new)
                    updated.update(changed)
                    self.file_fingerprints[path.name] = fingerprint
                    processed += 1
                except (ValueError, OSError, UnicodeError, csv.Error) as error:
                    warnings.append(f"{path.name}：{error}")
            if len(files) > 1000:
                warnings.append("目录超过1000个CSV文件，本次只检查前1000个")
            with self.database_lock, self.database() as connection:
                position_count = connection.execute("SELECT COUNT(*) FROM exchange_positions WHERE venue='exness'").fetchone()[0]
                leg_count = connection.execute("SELECT COUNT(*) FROM exness_trade_legs").fetchone()[0]
                imported_at = connection.execute("SELECT MAX(imported_at) FROM exness_import_files").fetchone()[0]
            self.state.update(checkedAt=now, importedAt=imported_at, fileCount=len(files),
                              positionCount=position_count, legCount=leg_count, skipped=skipped,
                              warning="；".join(warnings[:5]) or None)
            if processed:
                self.state.update(added=len(added), updated=len(updated - added))
            return dict(self.state)

    def _import_file(self, filename, digest, modified, legs, now):
        added, updated, affected = set(), set(), set()
        with self.database_lock, self.database() as connection:
            for leg in legs:
                payload = json.dumps(leg, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
                existing = connection.execute("SELECT payload_json, source_modified FROM exness_trade_legs WHERE id=?", (leg["id"],)).fetchone()
                if existing:
                    if existing["payload_json"] == payload:
                        connection.execute("UPDATE exness_trade_legs SET source_modified=MAX(source_modified, ?) WHERE id=?", (modified, leg["id"]))
                        continue
                    if existing["source_modified"] > modified:
                        continue
                connection.execute(
                    """INSERT INTO exness_trade_legs (id, position_id, exit_time_ms, payload_json, source_modified)
                       VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,
                       source_modified=excluded.source_modified""",
                    (leg["id"], leg["positionId"], leg["exitTimeMs"], payload, modified))
                affected.add(leg["positionId"])
            for position_id in affected:
                if connection.execute("SELECT 1 FROM exness_api_positions WHERE position_id=? LIMIT 1", (position_id,)).fetchone():
                    # An API-linked position is authoritative; a later CSV scan
                    # must not replace it with incomplete file data.
                    continue
                rows = connection.execute("SELECT payload_json FROM exness_trade_legs WHERE position_id=? ORDER BY exit_time_ms, id", (position_id,)).fetchall()
                position = aggregate_position([json.loads(row["payload_json"]) for row in rows])
                existed = connection.execute("SELECT 1 FROM exchange_positions WHERE venue='exness' AND position_id=?", (position_id,)).fetchone()
                self.upsert_position(connection, position, now)
                (updated if existed else added).add(position_id)
            connection.execute(
                """INSERT INTO exness_import_files (path, digest, imported_at) VALUES (?, ?, ?)
                   ON CONFLICT(path) DO UPDATE SET digest=excluded.digest, imported_at=excluded.imported_at""",
                (filename, digest, now))
        return added, updated

    def watch(self):
        while True:
            try:
                self.scan()
            except Exception:
                # Keep the monitor alive without logging account data or file contents.
                with self.lock:
                    self.state["warning"] = "Exness目录检查失败，请稍后重试"
            time.sleep(IMPORT_INTERVAL_SECONDS)
