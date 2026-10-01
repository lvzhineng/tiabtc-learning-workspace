"""Match and aggregate exchange fills for review positions."""

import time
import heapq


FILL_MATCH_PAD_MS = 2000


def fill_matches_position(fill, position):
    if fill.get("chartSymbol") != position.get("chartSymbol"):
        return False
    pos_side = position.get("side")
    trade_side = fill.get("tradeSide")
    fill_side = fill.get("side")
    if trade_side == "open":
        return (pos_side == "long" and fill_side == "buy") or (
            pos_side == "short" and fill_side == "sell"
        )
    if trade_side == "close":
        return (pos_side == "long" and fill_side == "sell") or (
            pos_side == "short" and fill_side == "buy"
        )
    if pos_side == "long":
        return fill_side in {"buy", "sell"}
    if pos_side == "short":
        return fill_side in {"buy", "sell"}
    return False


def classify_fill_role(fill, position):
    if not fill_matches_position(fill, position):
        return None
    trade_side = fill.get("tradeSide")
    fill_side = fill.get("side")
    pos_side = position.get("side")
    if trade_side == "open":
        return "open"
    if trade_side == "close":
        return "close"
    if pos_side == "long":
        return "open" if fill_side == "buy" else "close"
    if pos_side == "short":
        return "open" if fill_side == "sell" else "close"
    return None


def _aggregate_fill_operations(items):
    groups = {}
    for index, item in enumerate(items):
        order_id = item.get("orderId")
        key = (
            ("order", order_id, item.get("role"))
            if order_id
            else ("exec", item.get("execId") or str(index))
        )
        groups.setdefault(key, []).append(item)

    operations = []
    for group in groups.values():
        first = min(
            group,
            key=lambda item: (item.get("timeMs") or 0, item.get("execId") or ""),
        )
        last = max(
            group,
            key=lambda item: (item.get("timeMs") or 0, item.get("execId") or ""),
        )
        quantities = [
            item.get("quantity") for item in group if item.get("quantity") is not None
        ]
        weighted_prices = [
            (item.get("price"), item.get("quantity"))
            for item in group
            if item.get("price") is not None
            and item.get("quantity") is not None
            and item.get("quantity") > 0
        ]
        total_weight = sum(quantity for _, quantity in weighted_prices)
        if total_weight > 0:
            price = sum(price * quantity for price, quantity in weighted_prices) / total_weight
        else:
            price = next(
                (item.get("price") for item in group if item.get("price") is not None),
                None,
            )
        pnl_values = [item.get("pnl") for item in group if item.get("pnl") is not None]
        fee_values = [item.get("fee") for item in group if item.get("fee") is not None]
        operations.append(
            {
                **first,
                "quantity": sum(quantities) if quantities else None,
                "price": price,
                "pnl": sum(pnl_values) if pnl_values else None,
                "fee": sum(fee_values) if fee_values else None,
                "_lastTimeMs": last.get("timeMs") or first.get("timeMs"),
            }
        )
    return sorted(
        operations,
        key=lambda item: (item.get("timeMs") or 0, item.get("execId") or ""),
    )


def assign_fills_to_positions(positions, fills):
    now_ms = int(time.time() * 1000)
    grouped = {
        (position.get("venue"), position["positionId"]): [] for position in positions
    }
    positions_by_symbol = {}
    for index, position in enumerate(positions):
        if position.get("entryTimeMs") is not None:
            positions_by_symbol.setdefault(position.get("chartSymbol"), []).append((index, position))
    fills_by_symbol = {}
    for fill in fills or []:
        if fill.get("timeMs") is not None:
            fills_by_symbol.setdefault(fill.get("chartSymbol"), []).append(fill)
    for symbol, symbol_fills in fills_by_symbol.items():
        intervals = sorted(positions_by_symbol.get(symbol, []), key=lambda item: item[1]["entryTimeMs"])
        active = {}
        exits = []
        next_interval = 0
        for fill in sorted(symbol_fills, key=lambda item: item["timeMs"]):
            fill_time = fill["timeMs"]
            while next_interval < len(intervals) and intervals[next_interval][1]["entryTimeMs"] - FILL_MATCH_PAD_MS <= fill_time:
                index, position = intervals[next_interval]
                exit_ms = position.get("exitTimeMs") or now_ms
                active[index] = position
                heapq.heappush(exits, (exit_ms + FILL_MATCH_PAD_MS, index))
                next_interval += 1
            while exits and exits[0][0] < fill_time:
                _, index = heapq.heappop(exits)
                active.pop(index, None)
            candidates = []
            for index, position in active.items():
                fill_venue = fill.get("venue")
                position_venue = position.get("venue")
                if fill_venue and position_venue and fill_venue != position_venue:
                    continue
                role = classify_fill_role(fill, position)
                if role:
                    strictly_inside = position["entryTimeMs"] <= fill_time <= (position.get("exitTimeMs") or now_ms)
                    candidates.append((position, role, strictly_inside, index))
            strict_candidates = [item for item in candidates if item[2]]
            eligible = strict_candidates or candidates
            if not eligible:
                continue
            # Preserve the old latest-entry rule and original-order tie break.
            chosen, role, _, _ = max(eligible, key=lambda item: (item[0]["entryTimeMs"], -item[3]))
            chosen_key = (chosen.get("venue"), chosen["positionId"])
            grouped[chosen_key].append({**fill, "role": role})

    assigned = {}
    for position in positions:
        pos_key = (position.get("venue"), position["positionId"])
        items = sorted(
            grouped.get(pos_key, []),
            key=lambda item: (item.get("timeMs") or 0, item.get("execId") or ""),
        )
        items = _aggregate_fill_operations(items)
        close_items = [item for item in items if item.get("role") == "close"]
        last_close_id = None
        if position.get("status") == "closed" and close_items:
            last_close_id = max(
                close_items,
                key=lambda item: (
                    item.get("_lastTimeMs") or item.get("timeMs") or 0,
                    item.get("execId") or "",
                ),
            ).get("execId")
        seen_open = False
        annotated = []
        for item in items:
            role = item.get("role")
            if role == "open":
                kind = "open" if not seen_open else "scaleIn"
                seen_open = True
            elif position.get("status") == "closed" and item.get("execId") == last_close_id:
                kind = "close"
            else:
                kind = "reduce"
            operation_time_ms = (
                item.get("_lastTimeMs")
                if kind == "close"
                else item.get("timeMs")
            )
            annotated.append(
                {
                    "execId": item.get("execId"),
                    "timeMs": operation_time_ms,
                    "side": item.get("side"),
                    "tradeSide": item.get("tradeSide"),
                    "kind": kind,
                    "price": item.get("price"),
                    "quantity": item.get("quantity"),
                    "pnl": item.get("pnl"),
                }
            )
        sorted_annotated = sorted(
            annotated,
            key=lambda item: (item.get("timeMs") or 0, item.get("execId") or ""),
        )
        assigned[pos_key] = sorted_annotated
    return assigned
