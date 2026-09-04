#!/usr/bin/env python3
"""从 YouTube 频道或播放列表刷新学习清单，并重建 videos.json。"""

import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import video_catalog  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="导入或增量刷新 YouTube 频道 / 播放列表到顺序学习清单"
    )
    parser.add_argument(
        "--url",
        help="YouTube 频道或播放列表地址，例如 https://www.youtube.com/@name 或 playlist?list=",
    )
    parser.add_argument(
        "--template",
        choices=["tia"],
        help="使用内置示例模板（TiaBTC 频道）",
    )
    args = parser.parse_args(argv)
    try:
        result = video_catalog.refresh_video_catalog(
            ROOT,
            source_url=args.url,
            template=args.template,
        )
    except (FileNotFoundError, RuntimeError, ValueError) as error:
        print(f"刷新失败：{error}", file=sys.stderr)
        return 1
    added = result["added"]
    total = result["total"]
    latest = result["latestDate"] or "—"
    label = (result.get("source") or {}).get("label") or "YouTube"
    action = "已导入并重建" if result.get("replaced") else "已增量刷新"
    print(
        f"{action}「{label}」：新增 {added} 条，共 {total} 条，最新发布 {latest}。"
    )
    if result.get("removed"):
        print(f"已移出不在新来源中的 {result['removed']} 条。")
    if result.get("warning"):
        print(result["warning"])
    print(f"CSV  {result['csvPath']}")
    print(f"JSON {result['jsonPath']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
