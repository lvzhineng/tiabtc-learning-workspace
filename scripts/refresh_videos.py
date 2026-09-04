#!/usr/bin/env python3
"""从 TiaBTC YouTube 频道增量刷新公开视频清单，并重建 videos.json。"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import video_catalog  # noqa: E402


def main() -> int:
    try:
        result = video_catalog.refresh_video_catalog(ROOT)
    except (FileNotFoundError, RuntimeError) as error:
        print(f"刷新失败：{error}", file=sys.stderr)
        return 1
    added = result["added"]
    total = result["total"]
    latest = result["latestDate"] or "—"
    print(
        f"已刷新视频清单：新增 {added} 条，共 {total} 条，最新发布 {latest}。"
    )
    print(f"CSV  {result['csvPath']}")
    print(f"JSON {result['jsonPath']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
