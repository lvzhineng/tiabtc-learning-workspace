"""预下载复盘页所需的全部 Bybit K 线数据到 tiabtc-review.sqlite。"""

import argparse
import csv
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import study_server


ROOT = Path(__file__).resolve().parent
DEFAULT_CSV = ROOT / "TiaBTC_公开视频清单_20260711.csv"


def parse_args():
    parser = argparse.ArgumentParser(
        description="下载所有视频复盘会用到的 BTC/ETH K 线；可安全重复执行。"
    )
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV, help="视频清单 CSV")
    parser.add_argument(
        "--symbols", nargs="+", default=sorted(study_server.VALID_SYMBOLS),
        choices=sorted(study_server.VALID_SYMBOLS), help="要下载的交易对",
    )
    parser.add_argument(
        "--intervals", nargs="+", default=sorted(study_server.VALID_INTERVALS),
        choices=sorted(study_server.VALID_INTERVALS), help="要下载的 K 线周期",
    )
    parser.add_argument("--pause", type=float, default=0.08, help="每次请求后的暂停秒数")
    parser.add_argument("--retries", type=int, default=4, help="单批失败重试次数")
    parser.add_argument("--workers", type=int, default=4, help="并发下载数")
    parser.add_argument("--force", action="store_true", help="忽略缓存标记并重新下载")
    parser.add_argument("--dry-run", action="store_true", help="只显示计划，不联网下载")
    return parser.parse_args()


def load_video_timestamps(csv_path):
    timestamps = []
    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            date = (row.get("发布日期") or "").strip()
            clock = (row.get("发布时间（页面时区）") or "").strip()
            if not date or not clock:
                continue
            timestamps.append(int(datetime.fromisoformat(f"{date}T{clock}").timestamp() * 1000))
    if not timestamps:
        raise ValueError(f"{csv_path} 中没有有效的视频发布时间")
    return timestamps


def batches(start, end, interval_ms, size=1000):
    cursor = start
    span = interval_ms * size
    while cursor <= end:
        batch_end = min(end, cursor + span - 1)
        yield cursor, batch_end
        cursor = batch_end + 1


def format_time(timestamp):
    return datetime.fromtimestamp(timestamp / 1000).astimezone().isoformat(timespec="seconds")


def download_batch(symbol, interval, start, end, retries):
    for attempt in range(1, retries + 1):
        try:
            candles = study_server.fetch_bybit_candles(symbol, interval, start, end)
            study_server.save_candles(symbol, interval, start, end, candles)
            return len(candles)
        except Exception:
            if attempt == retries:
                raise
            delay = min(10, 2 ** (attempt - 1))
            print(f"    请求失败，{delay} 秒后进行第 {attempt + 1} 次尝试……", flush=True)
            time.sleep(delay)


def main():
    args = parse_args()
    if args.pause < 0 or args.retries < 1 or args.workers < 1:
        raise SystemExit("--pause 必须大于等于 0，--retries 和 --workers 必须大于等于 1")

    anchors = load_video_timestamps(args.csv.resolve())
    earliest_anchor = min(anchors)
    latest_cutoff = max(anchors)
    study_server.initialize_database()

    plan = []
    for symbol in args.symbols:
        for interval in args.intervals:
            interval_ms = study_server.INTERVAL_MILLISECONDS[interval]
            start = earliest_anchor - interval_ms * 500
            chunks = list(batches(start, latest_cutoff, interval_ms))
            plan.append((symbol, interval, start, latest_cutoff, chunks))

    print(f"视频数：{len(anchors)}")
    print(f"覆盖至：{format_time(latest_cutoff)}（最新视频发布时间）")
    for symbol, interval, start, end, chunks in plan:
        print(f"  {symbol:7} {interval:>3}: {format_time(start)} → {format_time(end)}，{len(chunks)} 批")
    if args.dry_run:
        return

    total_batches = sum(len(item[4]) for item in plan)
    completed = skipped = candles_total = 0
    for symbol, interval, _start, _end, chunks in plan:
        print(f"\n[{symbol} / {interval}]", flush=True)
        pending = []
        for start, end in chunks:
            if not args.force and study_server.cached_range_contains(symbol, interval, start, end):
                skipped += 1
                completed += 1
                print(f"  {completed}/{total_batches} 已缓存，跳过", flush=True)
                continue
            pending.append((start, end))
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {
                executor.submit(download_batch, symbol, interval, start, end, args.retries): (start, end)
                for start, end in pending
            }
            for future in as_completed(futures):
                count = future.result()
                candles_total += count
                completed += 1
                print(f"  {completed}/{total_batches} 写入 {count} 根（累计 {candles_total}）", flush=True)
                time.sleep(args.pause)

    print(f"\n完成：新增/更新 {candles_total} 根 K 线，跳过 {skipped} 个已缓存批次。")
    print(f"数据库：{study_server.DATABASE_FILE}")


if __name__ == "__main__":
    main()
