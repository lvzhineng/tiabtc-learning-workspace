"""Learning video catalog: CSV source data and videos.json snapshot.

Browser only reads `web/public/videos.json`. Import/refresh fetches a YouTube
channel or playlist, incrementally merges into the local catalog, then rebuilds
JSON. Existing rows keep their titles and published times.
"""

from __future__ import annotations

import csv
import json
import re
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parent
CSV_GLOB = "TiaBTC_公开视频清单*.csv"
GENERIC_CSV_NAME = "video-catalog.csv"
SOURCE_FILE_NAME = "video-source.json"
VIDEOS_JSON = ROOT / "web" / "public" / "videos.json"
TIA_CHANNEL_ID = "UCy2h-yNK9OF1kXDtT3AlF3Q"
TIA_CHANNEL_URL = "https://www.youtube.com/@tiabtc"
TIA_HANDLE = "tiabtc"
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
MAX_IMPORT_PAGES = 80
YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
}

TIA_TEMPLATE = {
    "url": TIA_CHANNEL_URL,
    "kind": "channel",
    "channelId": TIA_CHANNEL_ID,
    "playlistId": "",
    "label": "TiaBTC",
    "handle": TIA_HANDLE,
}


def find_video_csv(root: Path = ROOT) -> Path:
    generic = root / GENERIC_CSV_NAME
    if generic.exists():
        return generic
    matches = sorted(root.glob(CSV_GLOB))
    if not matches:
        raise FileNotFoundError(f"未找到视频清单 CSV（{GENERIC_CSV_NAME} 或 {CSV_GLOB}）")
    return matches[0]


def videos_json_path(root: Path = ROOT) -> Path:
    return root / "web" / "public" / "videos.json"


def catalog_write_path(root: Path = ROOT) -> Path:
    return root / GENERIC_CSV_NAME


def source_file_path(root: Path = ROOT) -> Path:
    return root / SOURCE_FILE_NAME


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


def load_catalog_videos(root: Path = ROOT) -> tuple[Path | None, list[dict]]:
    generic = root / GENERIC_CSV_NAME
    if generic.exists():
        return generic, load_csv_videos(generic)
    matches = sorted(root.glob(CSV_GLOB))
    if matches:
        return matches[0], load_csv_videos(matches[0])
    return None, []


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


def _title_from_node(node) -> str:
    if isinstance(node, str):
        return node.strip()
    if not isinstance(node, dict):
        return ""
    if isinstance(node.get("simpleText"), str):
        return node["simpleText"].strip()
    if isinstance(node.get("content"), str):
        return node["content"].strip()
    runs = node.get("runs")
    if isinstance(runs, list):
        return "".join(
            str(item.get("text") or "") for item in runs if isinstance(item, dict)
        ).strip()
    return ""


def _append_video(videos: list[dict], video_id, title: str) -> None:
    if not video_id or not isinstance(video_id, str):
        return
    videos.append(
        {
            "videoId": video_id,
            "title": (title or "").strip(),
            "url": f"https://www.youtube.com/watch?v={video_id}",
        }
    )


def _walk_lockups(node, videos: list[dict], continuations: list[str]) -> None:
    if isinstance(node, dict):
        if "lockupViewModel" in node:
            view = node["lockupViewModel"] or {}
            video_id = view.get("contentId")
            metadata = ((view.get("metadata") or {}).get("lockupMetadataViewModel") or {})
            title = _title_from_node((metadata.get("title") or {}))
            _append_video(videos, video_id, title)
        renderer = (
            node.get("playlistVideoRenderer")
            or node.get("gridVideoRenderer")
            or node.get("videoRenderer")
            or node.get("compactVideoRenderer")
        )
        if isinstance(renderer, dict):
            _append_video(
                videos,
                renderer.get("videoId"),
                _title_from_node(renderer.get("title")),
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


def _browse_videos(payload: dict, known_ids: set[str], full: bool, max_pages: int) -> list[dict]:
    collected: list[dict] = []
    seen: set[str] = set()
    hit_known = False
    for _page in range(max_pages):
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
            if video_id in known_ids:
                hit_known = True
        if (hit_known and not full) or not continuations:
            break
        payload = {
            "context": {"client": WEB_CLIENT},
            "continuation": continuations[0],
        }
    return collected


def fetch_channel_uploads(
    channel_id: str | None = None,
    known_ids: set[str] | None = None,
    full: bool = False,
) -> list[dict]:
    """Newest-first uploads from the Videos tab, stopping after known IDs unless full."""
    known = known_ids or set()
    payload = {
        "context": {"client": WEB_CLIENT},
        "browseId": channel_id or TIA_CHANNEL_ID,
        "params": CHANNEL_VIDEOS_PARAMS,
    }
    collected = _browse_videos(
        payload,
        known,
        full,
        MAX_IMPORT_PAGES if full else MAX_BROWSE_PAGES,
    )
    if not collected:
        raise RuntimeError("YouTube 频道未返回任何视频")
    return collected


def fetch_playlist_videos(
    playlist_id: str,
    known_ids: set[str] | None = None,
    full: bool = False,
) -> list[dict]:
    known = known_ids or set()
    browse_id = playlist_id if playlist_id.startswith("VL") else f"VL{playlist_id}"
    payload = {
        "context": {"client": WEB_CLIENT},
        "browseId": browse_id,
    }
    collected = _browse_videos(
        payload,
        known,
        full,
        MAX_IMPORT_PAGES if full else MAX_BROWSE_PAGES,
    )
    if not collected:
        raise RuntimeError("YouTube 播放列表未返回任何视频")
    return collected


def fetch_rss_published(channel_id: str = "", playlist_id: str = "") -> dict[str, datetime]:
    if playlist_id:
        feed_url = f"https://www.youtube.com/feeds/videos.xml?playlist_id={playlist_id}"
    elif channel_id:
        feed_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    else:
        return {}
    xml_bytes = _http_bytes(feed_url)
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


def resolve_published_times(
    video_ids: list[str],
    channel_id: str = "",
    playlist_id: str = "",
    require_all: bool = True,
) -> tuple[dict[str, datetime], list[str]]:
    times = fetch_rss_published(channel_id=channel_id, playlist_id=playlist_id)
    missing = [video_id for video_id in video_ids if video_id not in times]
    for index, video_id in enumerate(missing):
        parsed = fetch_player_published(video_id)
        if parsed is not None:
            times[video_id] = parsed
        if index + 1 < len(missing):
            time.sleep(0.05)
    unresolved = [video_id for video_id in video_ids if video_id not in times]
    if unresolved and require_all:
        preview = ", ".join(unresolved[:5])
        raise RuntimeError(f"无法读取 {len(unresolved)} 条视频的发布时间：{preview}")
    return times, unresolved


def merge_new_videos(existing: list[dict], fetched: list[dict], published: dict[str, datetime]) -> tuple[list[dict], int]:
    existing_ids = {item["videoId"] for item in existing}
    added_rows: list[dict] = []
    for item in fetched:
        video_id = item["videoId"]
        if video_id in existing_ids:
            continue
        moment = published.get(video_id)
        if moment is None:
            continue
        date, clock = format_catalog_datetime(moment)
        added_rows.append(
            {
                "index": 0,
                "date": date,
                "time": clock,
                "title": item["title"] or "未命名视频",
                "url": item["url"],
                "videoId": video_id,
            }
        )
        existing_ids.add(video_id)
    merged = reindex(added_rows + existing)
    return merged, len(added_rows)


def rebuild_from_source(
    existing: list[dict],
    fetched: list[dict],
    published: dict[str, datetime],
) -> tuple[list[dict], int]:
    by_id = {item["videoId"]: item for item in existing}
    rows: list[dict] = []
    added = 0
    for item in fetched:
        video_id = item["videoId"]
        previous = by_id.get(video_id)
        if previous:
            rows.append(
                {
                    "index": 0,
                    "date": previous["date"],
                    "time": previous["time"],
                    "title": previous["title"] or item["title"] or "未命名视频",
                    "url": previous["url"] or item["url"],
                    "videoId": video_id,
                }
            )
            continue
        moment = published.get(video_id)
        if moment is None:
            continue
        date, clock = format_catalog_datetime(moment)
        rows.append(
            {
                "index": 0,
                "date": date,
                "time": clock,
                "title": item["title"] or "未命名视频",
                "url": item["url"],
                "videoId": video_id,
            }
        )
        added += 1
    return reindex(rows), added


def parse_youtube_source(raw: str) -> dict:
    text = (raw or "").strip()
    if not text:
        raise ValueError("请粘贴 YouTube 频道或播放列表地址")
    if not re.match(r"^https?://", text, re.I):
        text = "https://" + text.lstrip("/")
    parsed = urlparse(text)
    host = (parsed.hostname or "").lower()
    if host not in YOUTUBE_HOSTS:
        raise ValueError("只支持 YouTube 频道或播放列表地址")
    query = parse_qs(parsed.query)
    list_id = (query.get("list") or [""])[0].strip()
    path = parsed.path or ""

    if list_id:
        if list_id in {"WL", "LL"}:
            raise ValueError("稍后观看 / 喜欢的视频需要登录，请改用公开播放列表")
        return {
            "url": f"https://www.youtube.com/playlist?list={list_id}",
            "kind": "playlist",
            "channelId": "",
            "playlistId": list_id,
            "label": "YouTube 播放列表",
            "handle": "",
        }

    channel_match = re.search(r"/channel/(UC[\w-]{20,})", path)
    if channel_match:
        channel_id = channel_match.group(1)
        return {
            "url": f"https://www.youtube.com/channel/{channel_id}/videos",
            "kind": "channel",
            "channelId": channel_id,
            "playlistId": "",
            "label": "YouTube 频道",
            "handle": "",
        }

    handle_match = re.search(r"/@([^/]+)", path)
    if handle_match:
        handle = handle_match.group(1).strip()
        known = TIA_CHANNEL_ID if handle.lower() == TIA_HANDLE else ""
        return {
            "url": f"https://www.youtube.com/@{handle}",
            "kind": "channel",
            "channelId": known,
            "playlistId": "",
            "label": "TiaBTC" if known else f"@{handle}",
            "handle": handle,
        }

    named = re.search(r"/(?:c|user)/([^/]+)", path)
    if named:
        return {
            "url": text.split("#")[0],
            "kind": "channel",
            "channelId": "",
            "playlistId": "",
            "label": named.group(1),
            "handle": "",
        }

    raise ValueError("无法识别该地址，请粘贴频道主页或 playlist?list= 播放列表链接")


def _extract_channel_id(html: str) -> str:
    patterns = (
        re.compile(r'<meta\s+itemprop="channelId"\s+content="(UC[\w-]{20,})"'),
        re.compile(r'"channelId"\s*:\s*"(UC[\w-]{20,})"'),
        re.compile(r"https://www\.youtube\.com/channel/(UC[\w-]{20,})"),
        re.compile(r"channel_id=(UC[\w-]{20,})"),
    )
    for pattern in patterns:
        match = pattern.search(html)
        if match:
            return match.group(1)
    return ""


def resolve_channel_id(source: dict) -> str:
    if source.get("channelId"):
        return source["channelId"]
    page_url = source.get("url") or ""
    handle = source.get("handle") or ""
    if handle:
        page_url = f"https://www.youtube.com/@{handle}"
    if not page_url:
        raise RuntimeError("无法解析 YouTube 频道")
    html = _http_bytes(page_url).decode("utf-8", "replace")
    channel_id = _extract_channel_id(html)
    if not channel_id:
        raise RuntimeError("无法从该 YouTube 地址解析频道 ID")
    return channel_id


def source_key(source: dict | None) -> str:
    if not source:
        return ""
    if source.get("kind") == "playlist" and source.get("playlistId"):
        return f"playlist:{source['playlistId']}"
    if source.get("channelId"):
        return f"channel:{source['channelId']}"
    handle = (source.get("handle") or "").lower()
    if handle:
        return f"handle:{handle}"
    return f"url:{(source.get('url') or '').lower()}"


def is_tia_source(source: dict | None) -> bool:
    if not source:
        return False
    if source.get("channelId") == TIA_CHANNEL_ID:
        return True
    return (source.get("handle") or "").lower() == TIA_HANDLE


def load_saved_source(root: Path = ROOT) -> dict | None:
    path = source_file_path(root)
    if not path.is_file():
        return None
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(loaded, dict):
        return None
    kind = str(loaded.get("kind") or "").strip()
    if kind not in {"channel", "playlist"}:
        return None
    return {
        "url": str(loaded.get("url") or "").strip(),
        "kind": kind,
        "channelId": str(loaded.get("channelId") or "").strip(),
        "playlistId": str(loaded.get("playlistId") or "").strip(),
        "label": str(loaded.get("label") or "").strip(),
        "handle": str(loaded.get("handle") or "").strip(),
    }


def save_source(root: Path, source: dict) -> None:
    payload = {
        "url": source.get("url") or "",
        "kind": source.get("kind") or "",
        "channelId": source.get("channelId") or "",
        "playlistId": source.get("playlistId") or "",
        "label": source.get("label") or "",
        "handle": source.get("handle") or "",
    }
    source_file_path(root).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def public_source(source: dict | None, total: int = 0, latest_date: str | None = None) -> dict:
    source = source or {}
    return {
        "url": source.get("url") or "",
        "kind": source.get("kind") or "",
        "label": source.get("label") or "",
        "channelId": source.get("channelId") or "",
        "playlistId": source.get("playlistId") or "",
        "template": is_tia_source(source),
        "total": total,
        "latestDate": latest_date,
    }


def describe_catalog_source(root: Path = ROOT) -> dict:
    _path, videos = load_catalog_videos(root)
    saved = load_saved_source(root)
    source = saved or (dict(TIA_TEMPLATE) if videos else None)
    latest = videos[0]["date"] if videos else None
    return public_source(source, len(videos), latest)


def resolve_requested_source(
    source_url: str | None = None,
    template: str | None = None,
) -> dict | None:
    if (template or "").strip().lower() == "tia":
        return dict(TIA_TEMPLATE)
    if source_url and str(source_url).strip():
        source = parse_youtube_source(str(source_url))
        if source["kind"] == "channel" and not source.get("channelId"):
            source["channelId"] = resolve_channel_id(source)
        if is_tia_source(source):
            source["label"] = TIA_TEMPLATE["label"]
        return source
    return None


def fetch_source_videos(source: dict, known_ids: set[str], full: bool) -> list[dict]:
    if source.get("kind") == "playlist":
        playlist_id = source.get("playlistId") or ""
        if not playlist_id:
            raise ValueError("播放列表地址无效")
        return fetch_playlist_videos(playlist_id, known_ids, full=full)
    channel_id = source.get("channelId") or ""
    if not channel_id:
        raise ValueError("频道地址无效")
    return fetch_channel_uploads(channel_id, known_ids, full=full)


def refresh_video_catalog(
    root: Path = ROOT,
    source_url: str | None = None,
    template: str | None = None,
) -> dict:
    _existing_path, existing = load_catalog_videos(root)
    saved = load_saved_source(root)
    implicit = dict(TIA_TEMPLATE) if existing else None
    previous = saved or implicit
    requested = resolve_requested_source(source_url, template)
    source = requested or previous or dict(TIA_TEMPLATE)
    if source.get("kind") == "channel" and not source.get("channelId"):
        source["channelId"] = resolve_channel_id(source)

    same_source = bool(previous) and source_key(source) == source_key(previous)
    incremental = same_source and bool(existing)
    known_ids = {item["videoId"] for item in existing} if incremental else set()
    fetched = fetch_source_videos(source, known_ids, full=not incremental)

    if incremental:
        new_ids = [item["videoId"] for item in fetched if item["videoId"] not in known_ids]
        if new_ids:
            published, _unresolved = resolve_published_times(
                new_ids,
                channel_id=source.get("channelId") or "",
                playlist_id=source.get("playlistId") or "",
                require_all=True,
            )
        else:
            published = {}
        merged, added = merge_new_videos(existing, fetched, published)
        removed = 0
        warning = None
    else:
        existing_ids = {item["videoId"] for item in existing}
        new_ids = [item["videoId"] for item in fetched if item["videoId"] not in existing_ids]
        if new_ids:
            published, unresolved = resolve_published_times(
                new_ids,
                channel_id=source.get("channelId") or "",
                playlist_id=source.get("playlistId") or "",
                require_all=False,
            )
        else:
            published, unresolved = {}, []
        merged, added = rebuild_from_source(existing, fetched, published)
        kept_ids = {item["videoId"] for item in merged}
        removed = sum(1 for item in existing if item["videoId"] not in kept_ids)
        warning = None
        if unresolved:
            preview = ", ".join(unresolved[:5])
            warning = f"已跳过 {len(unresolved)} 条无法读取发布时间的视频：{preview}"

    csv_path = catalog_write_path(root)
    write_csv_videos(csv_path, merged)
    json_path = videos_json_path(root)
    write_videos_json(json_path, merged)
    save_source(root, source)
    result = {
        "total": len(merged),
        "added": added,
        "removed": removed,
        "replaced": not incremental,
        "latestDate": merged[0]["date"] if merged else None,
        "csvPath": str(csv_path.relative_to(root)),
        "jsonPath": str(json_path.relative_to(root)),
        "source": public_source(
            source,
            len(merged),
            merged[0]["date"] if merged else None,
        ),
        "videos": merged,
    }
    if warning:
        result["warning"] = warning
    return result


# Backward-compatible alias used by older refresh callers.
CHANNEL_ID = TIA_CHANNEL_ID
