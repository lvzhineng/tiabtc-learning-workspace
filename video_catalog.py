"""TiaBTC 公开视频清单：CSV 源数据与 videos.json 快照。

浏览器只读 `web/public/videos.json`。刷新时从 YouTube 频道增量拉取新视频，
合并进根目录 CSV，再重建 JSON。已有条目的标题与发布时间不会被覆盖。
"""

from __future__ import annotations

import csv
import json
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parent
CSV_GLOB = "TiaBTC_公开视频清单*.csv"
VIDEOS_JSON = ROOT / "web" / "public" / "videos.json"
CHANNEL_ID = "UCy2h-yNK9OF1kXDtT3AlF3Q"
CHANNEL_VIDEOS_PARAMS = "EgZ2aWRlb3PyBgQKAjoA"
WEB_CLIENT = {
    "hl": "en",
    "gl": "US",
    "clientName": "WEB",
    "clientVersion": "2.20260815.00.00",
}
REMIX_CLIENT = {
    "hl": "en",
    "gl": "US",
    "clientName": "WEB_REMIX",
    "clientVersion": "1.20260815.00.00",
}
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)
PACIFIC = ZoneInfo("America/Los_Angeles")
CSV_FIELDS = ["序号", "发布日期", "发布时间（页面时区）", "视频标题", "视频链接", "视频ID"]
MAX_BROWSE_PAGES = 20


def find_video_csv(root: Path = ROOT) -> Path:
    matches = sorted(root.glob(CSV_GLOB))
    if not matches:
        raise FileNotFoundError(f"未找到视频清单 CSV（{CSV_GLOB}）")
    return matches[0]


def videos_json_path(root: Path = ROOT) -> Path:
    return root / "web" / "public" / "videos.json"


def load_csv_videos(csv_path: Path) -> list[dict]:
    with csv_path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        videos = []
        for row in reader:
            cleaned = {key.strip(): (value or "").strip() for key, value in row.items() if key}
            video_id = cleaned.get("视频ID", "")
            if not video_id:
                continue
            idx = cleaned.get("序号", "")
            videos.append(
                {
                    "index": int(idx) if idx.isdigit() else 0,
                    "date": cleaned.get("发布日期", ""),
                    "time": cleaned.get("发布时间（页面时区）", ""),
                    "title": cleaned.get("视频标题", ""),
                    "url": cleaned.get("视频链接", "")
                    or f"https://www.youtube.com/watch?v={video_id}",
                    "videoId": video_id,
                }
            )
    return videos


def write_csv_videos(csv_path: Path, videos: list[dict]) -> None:
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS, lineterminator="\n")
        writer.writeheader()
        for item in videos:
            writer.writerow(
                {
                    "序号": item["index"],
                    "发布日期": item["date"],
                    "发布时间（页面时区）": item["time"],
                    "视频标题": item["title"],
                    "视频链接": item["url"],
                    "视频ID": item["videoId"],
                }
            )


def write_videos_json(json_path: Path, videos: list[dict]) -> None:
    json_path.parent.mkdir(parents=True, exist_ok=True)
    with json_path.open("w", encoding="utf-8") as handle:
        json.dump(videos, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def build_videos_json(root: Path = ROOT, csv_path: Path | None = None) -> dict:
    source = csv_path or find_video_csv(root)
    videos = load_csv_videos(source)
    out_path = videos_json_path(root)
    write_videos_json(out_path, videos)
    return {
        "total": len(videos),
        "added": 0,
        "latestDate": videos[0]["date"] if videos else None,
        "csvPath": str(source.relative_to(root)),
        "jsonPath": str(out_path.relative_to(root)),
        "videos": videos,
    }


def reindex(videos: list[dict]) -> list[dict]:
    numbered = []
    for offset, item in enumerate(videos, start=1):
        updated = dict(item)
        updated["index"] = offset
        numbered.append(updated)
    return numbered


def format_catalog_datetime(moment: datetime) -> tuple[str, str]:
    local = moment.astimezone(PACIFIC)
    offset = local.strftime("%z")
    offset_colon = f"{offset[:3]}:{offset[3:]}" if len(offset) == 5 else offset
    return local.strftime("%Y-%m-%d"), f"{local.strftime('%H:%M:%S')}{offset_colon}"


def parse_iso_datetime(value: str) -> datetime | None:
    text = (value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _http_json(url: str, payload: dict, timeout: int = 30) -> dict:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"YouTube 请求失败 HTTP {error.code}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"无法连接 YouTube：{error.reason}") from error


def _http_bytes(url: str, timeout: int = 20) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"YouTube 请求失败 HTTP {error.code}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"无法连接 YouTube：{error.reason}") from error


def _walk_lockups(node, videos: list[dict], continuations: list[str]) -> None:
    if isinstance(node, dict):
        if "lockupViewModel" in node:
            view = node["lockupViewModel"] or {}
            video_id = view.get("contentId")
            metadata = ((view.get("metadata") or {}).get("lockupMetadataViewModel") or {})
            title = ((metadata.get("title") or {}).get("content") or "").strip()
            if video_id:
                videos.append(
                    {
                        "videoId": video_id,
                        "title": title,
                        "url": f"https://www.youtube.com/watch?v={video_id}",
                    }
                )
        command = node.get("continuationCommand")
        if isinstance(command, dict):
            token = command.get("token")
            if token:
                continuations.append(token)
        for value in node.values():
            _walk_lockups(value, videos, continuations)
    elif isinstance(node, list):
        for item in node:
            _walk_lockups(item, videos, continuations)


def fetch_channel_uploads(known_ids: set[str] | None = None) -> list[dict]:
    """Newest-first uploads from the Videos tab, stopping after known IDs."""
    known = known_ids or set()
    collected: list[dict] = []
    seen: set[str] = set()
    payload = {
        "context": {"client": WEB_CLIENT},
        "browseId": CHANNEL_ID,
        "params": CHANNEL_VIDEOS_PARAMS,
    }
    hit_known = False
    for _page in range(MAX_BROWSE_PAGES):
        data = _http_json(
            "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false",
            payload,
        )
        page_videos: list[dict] = []
        continuations: list[str] = []
        _walk_lockups(data, page_videos, continuations)
        for item in page_videos:
            video_id = item["videoId"]
            if video_id in seen:
                continue
            seen.add(video_id)
            collected.append(item)
            if video_id in known:
                hit_known = True
        if hit_known or not continuations:
            break
        payload = {
            "context": {"client": WEB_CLIENT},
            "continuation": continuations[0],
        }
    if not collected:
        raise RuntimeError("YouTube 频道未返回任何视频")
    return collected


def fetch_rss_published() -> dict[str, datetime]:
    xml_bytes = _http_bytes(
        f"https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL_ID}"
    )
    root = ET.fromstring(xml_bytes)
    ns = {
        "atom": "http://www.w3.org/2005/Atom",
        "yt": "http://www.youtube.com/xml/schemas/2015",
    }
    published: dict[str, datetime] = {}
    for entry in root.findall("atom:entry", ns):
        video_el = entry.find("yt:videoId", ns)
        published_el = entry.find("atom:published", ns)
        if video_el is None or published_el is None:
            continue
        parsed = parse_iso_datetime(published_el.text or "")
        if parsed is not None:
            published[video_el.text] = parsed
    return published


def fetch_player_published(video_id: str) -> datetime | None:
    data = _http_json(
        "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
        {
            "context": {"client": REMIX_CLIENT},
            "videoId": video_id,
            "contentCheckOk": True,
            "racyCheckOk": True,
        },
    )
    renderer = (data.get("microformat") or {}).get("microformatDataRenderer") or {}
    raw = renderer.get("publishDate") or renderer.get("uploadDate") or ""
    return parse_iso_datetime(raw)


def resolve_published_times(video_ids: list[str]) -> dict[str, datetime]:
    times = fetch_rss_published()
    missing = [video_id for video_id in video_ids if video_id not in times]
    for index, video_id in enumerate(missing):
        parsed = fetch_player_published(video_id)
        if parsed is not None:
            times[video_id] = parsed
        if index + 1 < len(missing):
            time.sleep(0.05)
    unresolved = [video_id for video_id in video_ids if video_id not in times]
    if unresolved:
        preview = ", ".join(unresolved[:5])
        raise RuntimeError(f"无法读取 {len(unresolved)} 条视频的发布时间：{preview}")
    return times


def merge_new_videos(existing: list[dict], fetched: list[dict], published: dict[str, datetime]) -> tuple[list[dict], int]:
    existing_ids = {item["videoId"] for item in existing}
    added_rows: list[dict] = []
    for item in fetched:
        video_id = item["videoId"]
        if video_id in existing_ids:
            continue
        moment = published[video_id]
        date, clock = format_catalog_datetime(moment)
        added_rows.append(
            {
                "index": 0,
                "date": date,
                "time": clock,
                "title": item["title"],
                "url": item["url"],
                "videoId": video_id,
            }
        )
        existing_ids.add(video_id)
    merged = reindex(added_rows + existing)
    return merged, len(added_rows)


def refresh_video_catalog(root: Path = ROOT) -> dict:
    csv_path = find_video_csv(root)
    existing = load_csv_videos(csv_path)
    known_ids = {item["videoId"] for item in existing}
    fetched = fetch_channel_uploads(known_ids)
    new_ids = [item["videoId"] for item in fetched if item["videoId"] not in known_ids]
    published = resolve_published_times(new_ids) if new_ids else {}
    merged, added = merge_new_videos(existing, fetched, published)
    write_csv_videos(csv_path, merged)
    json_path = videos_json_path(root)
    write_videos_json(json_path, merged)
    return {
        "total": len(merged),
        "added": added,
        "latestDate": merged[0]["date"] if merged else None,
        "csvPath": str(csv_path.relative_to(root)),
        "jsonPath": str(json_path.relative_to(root)),
        "videos": merged,
    }
