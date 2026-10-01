"""Synthetic review benchmark; uses only generated data and in-memory SQLite.

Optional --baseline-ref compares fill results/timing with a trusted local Git ref.
"""

import argparse
import json
from pathlib import Path
import platform
import random
import sqlite3
import statistics
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from position_fill_assignment import assign_fills_to_positions


def median_ms(operation, repeats=3):
    samples = []
    for _ in range(repeats):
        start = time.perf_counter()
        operation()
        samples.append((time.perf_counter() - start) * 1000)
    return round(statistics.median(samples), 2)


def fixtures(count):
    positions = [{"venue": "gate", "positionId": str(index), "chartSymbol": "BTCUSDT",
                  "side": "long", "status": "closed", "entryTimeMs": 1_700_000_000_000 + index * 10000,
                  "exitTimeMs": 1_700_000_005_000 + index * 10000} for index in range(count)]
    fills = [{"venue": "gate", "execId": f"{index}-{offset}", "chartSymbol": "BTCUSDT",
              "side": side, "tradeSide": role, "timeMs": position["entryTimeMs"] + offset,
              "quantity": 1, "price": 100} for index, position in enumerate(positions)
             for offset, side, role in [(1000, "buy", "open"), (4000, "sell", "close")]]
    return positions, fills


def check_overlap_parity(baseline):
    randomizer = random.Random(42)
    for _ in range(100):
        positions = [{"venue": randomizer.choice(["gate", "bitget", None]), "positionId": str(index),
                      "chartSymbol": randomizer.choice(["BTCUSDT", "ETHUSDT"]),
                      "side": randomizer.choice(["long", "short"]), "status": "closed",
                      "entryTimeMs": randomizer.randrange(20) * 1000,
                      "exitTimeMs": 20000 + randomizer.randrange(20) * 1000} for index in range(50)]
        fills = [{"venue": randomizer.choice(["gate", "bitget", None]), "execId": str(index),
                  "chartSymbol": randomizer.choice(["BTCUSDT", "ETHUSDT"]),
                  "side": randomizer.choice(["buy", "sell"]), "tradeSide": randomizer.choice(["open", "close", None]),
                  "timeMs": randomizer.randrange(-2000, 42000), "price": 100, "quantity": 1} for index in range(100)]
        randomizer.shuffle(fills)
        assert assign_fills_to_positions(positions, fills) == baseline(positions, fills), "Fill assignment changed"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-ref", help="Trusted local ref containing the previous assignment algorithm")
    parser.add_argument("--positions", type=int, default=3000)
    args = parser.parse_args()
    if args.positions < 1:
        parser.error("--positions must be positive")
    positions, fills = fixtures(args.positions)
    result = {"python": platform.python_version(), "positionCount": len(positions), "fillCount": len(fills),
              "assignNewMedianMs": median_ms(lambda: assign_fills_to_positions(positions, fills))}
    if args.baseline_ref:
        source = subprocess.run(["git", "show", f"{args.baseline_ref}:position_fill_assignment.py"], cwd=ROOT,
                                check=True, capture_output=True, text=True, encoding="utf-8").stdout
        namespace = {"__name__": "benchmark_baseline"}
        exec(compile(source, "<trusted-git-baseline>", "exec"), namespace)
        baseline = namespace["assign_fills_to_positions"]
        assert baseline(positions, fills) == assign_fills_to_positions(positions, fills)
        check_overlap_parity(baseline)
        result.update(baselineRef=args.baseline_ref, overlapParityCases=100,
                      assignOldMedianMs=median_ms(lambda: baseline(positions, fills)))
    # Isolate the query/read cost: irrelevant fills must not be materialized.
    with sqlite3.connect(":memory:") as connection:
        connection.execute("CREATE TABLE position_fills (venue TEXT, chart_symbol TEXT, time_ms INTEGER, price REAL)")
        connection.execute("CREATE INDEX idx_position_fills_symbol_time ON position_fills (venue, chart_symbol, time_ms)")
        connection.executemany("INSERT INTO position_fills VALUES (?, ?, ?, ?)",
                               (("gate", "ETHUSDT", index * 10000, 100) for index in range(100000)))
        connection.executemany("INSERT INTO position_fills VALUES (?, ?, ?, ?)",
                               (("gate", "BTCUSDT", fill["timeMs"], 100) for fill in fills))
        query = "SELECT * FROM position_fills WHERE venue = ? AND chart_symbol = ? AND time_ms BETWEEN ? AND ? ORDER BY time_ms"
        parameters = ("gate", "BTCUSDT", positions[0]["entryTimeMs"] - 2000, positions[-1]["exitTimeMs"] + 2000)
        result.update(queryAllMedianMs=median_ms(lambda: connection.execute("SELECT * FROM position_fills ORDER BY time_ms").fetchall()),
                      queryScopedMedianMs=median_ms(lambda: connection.execute(query, parameters).fetchall()),
                      allRows=connection.execute("SELECT COUNT(*) FROM position_fills").fetchone()[0],
                      scopedRows=len(connection.execute(query, parameters).fetchall()),
                      queryPlan=[row[3] for row in connection.execute("EXPLAIN QUERY PLAN " + query, parameters)])
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
