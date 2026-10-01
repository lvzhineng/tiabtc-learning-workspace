"""Read-only position snapshots and scoped fill reads, separate from HTTP/sync."""

import time
from position_fill_assignment import FILL_MATCH_PAD_MS, assign_fills_to_positions
from performance_metrics import measure_operation


def read_positions(connection):
    with measure_operation("position-review.read") as metrics:
        rows = connection.execute(
            """SELECT p.*, n.note, GROUP_CONCAT(m.tag_id) AS tag_ids
               FROM exchange_positions p
               LEFT JOIN position_notes n ON n.venue = p.venue AND n.position_id = p.position_id
               LEFT JOIN position_tag_map m ON m.venue = p.venue AND m.position_id = p.position_id
               WHERE p.status <> 'stale'
               GROUP BY p.venue, p.position_id
               ORDER BY COALESCE(p.exit_time_ms, p.entry_time_ms) DESC"""
        ).fetchall()
        positions = [_position_from_row(row) for row in rows]
        # Use the existing (venue, symbol, time) index. No unrelated symbol or
        # older orphan fills are fetched. Scope ranges are computed from the
        # same position snapshot rather than from a second positions query.
        now_ms = int(time.time() * 1000)
        scopes = {}
        for position in positions:
            key = (position["venue"], position["chartSymbol"])
            start = position["entryTimeMs"] - FILL_MATCH_PAD_MS
            end = (position["exitTimeMs"] or now_ms) + FILL_MATCH_PAD_MS
            old = scopes.get(key)
            scopes[key] = (min(old[0], start), max(old[1], end)) if old else (start, end)
        fills = []
        for (venue, symbol), (start, end) in scopes.items():
            fill_rows = connection.execute(
                """SELECT venue, exec_id, order_id, chart_symbol, unified_symbol,
                          side, trade_side, price, quantity, pnl, fee, time_ms
                   FROM position_fills WHERE venue = ? AND chart_symbol = ?
                     AND time_ms BETWEEN ? AND ? ORDER BY time_ms ASC""",
                (venue, symbol, start, end),
            )
            fills.extend(_fill_from_row(row) for row in fill_rows)
        with measure_operation("position-review.assign-fills") as assignment:
            grouped = assign_fills_to_positions(positions, fills)
            assignment.update(positionCount=len(positions), fillCount=len(fills))
        for position in positions:
            position["fills"] = grouped.get((position["venue"], position["positionId"]), [])
        metrics.update(positionCount=len(positions), fillCount=len(fills), scopeCount=len(scopes))
        return positions


def _position_from_row(row):
    fields = {
        "venue": "venue", "positionId": "position_id", "unifiedSymbol": "unified_symbol",
        "chartSymbol": "chart_symbol", "side": "side", "status": "status",
        "entryPrice": "entry_price", "exitPrice": "exit_price", "contracts": "contracts",
        "leverage": "leverage", "marginMode": "margin_mode", "realizedPnl": "realized_pnl",
        "netPnl": "net_pnl", "funding": "funding", "openFee": "open_fee", "closeFee": "close_fee",
        "entryTimeMs": "entry_time_ms", "exitTimeMs": "exit_time_ms",
    }
    return {
        **{key: row[column] for key, column in fields.items()},
        "hedged": bool(row["hedged"]), "note": row["note"] or "",
        "tagIds": [int(item) for item in str(row["tag_ids"]).split(",") if item] if row["tag_ids"] else [],
    }


def _fill_from_row(row):
    fields = {
        "venue": "venue", "execId": "exec_id", "orderId": "order_id", "chartSymbol": "chart_symbol",
        "unifiedSymbol": "unified_symbol", "side": "side", "tradeSide": "trade_side", "price": "price",
        "quantity": "quantity", "pnl": "pnl", "fee": "fee", "timeMs": "time_ms",
    }
    return {key: row[column] for key, column in fields.items()}
