#!/usr/bin/env python3
"""从根目录视频清单 CSV 重建 web/public/videos.json。"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import video_catalog  # noqa: E402


def main() -> int:
    try:
        result = video_catalog.build_videos_json(ROOT)
    except FileNotFoundError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    print(
        f"Successfully generated {ROOT / result['jsonPath']} "
        f"with {result['total']} videos."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
