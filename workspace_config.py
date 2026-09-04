"""Local workspace config: invite URLs from defaults, local file, env, and settings."""

from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DEFAULTS_FILE = "config.defaults.json"
LOCAL_FILE = "config.local.json"
PLACEHOLDERS = {
    "YOUR_GATE_INVITE_URL",
    "YOUR_BITGET_INVITE_URL",
}
AUTHOR_DEFAULT_INVITES = {
    "gate": "https://www.gatewebsite.app/share/VFHFAFJW",
    "bitget": "https://partner.bitget.cafe/bg/19qdpd2n",
}
ENV_GATE = "TIA_GATE_INVITE_URL"
ENV_BITGET = "TIA_BITGET_INVITE_URL"
MAX_INVITE_URL_LEN = 500


def is_placeholder(value: str | None) -> bool:
    text = (value or "").strip()
    return not text or text in PLACEHOLDERS


def normalize_invite_url(value, field="邀请链接") -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if is_placeholder(text):
        return ""
    parsed = urlparse(text)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError(f"{field}邀请链接必须是 http(s) 地址")
    if len(text) > MAX_INVITE_URL_LEN:
        raise ValueError(f"{field}邀请链接过长")
    return text


def _read_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _invite_from_mapping(data: dict, key: str) -> str:
    invites = data.get("invites")
    if not isinstance(invites, dict):
        return ""
    return "" if is_placeholder(str(invites.get(key) or "")) else str(invites.get(key) or "").strip()


def load_file_invites(root: Path = ROOT) -> dict[str, str]:
    defaults = _read_json(root / DEFAULTS_FILE)
    local = _read_json(root / LOCAL_FILE)
    return {
        "gate": (
            _invite_from_mapping(local, "gate")
            or _invite_from_mapping(defaults, "gate")
            or AUTHOR_DEFAULT_INVITES["gate"]
        ),
        "bitget": (
            _invite_from_mapping(local, "bitget")
            or _invite_from_mapping(defaults, "bitget")
            or AUTHOR_DEFAULT_INVITES["bitget"]
        ),
    }


def _clean_invite(value: str | None) -> str:
    text = (value or "").strip()
    if is_placeholder(text):
        return ""
    try:
        return normalize_invite_url(text)
    except ValueError:
        return ""


def resolve_invite_urls(
    root: Path = ROOT,
    stored_gate: str = "",
    stored_bitget: str = "",
) -> dict:
    files = load_file_invites(root)
    gate = (
        _clean_invite(stored_gate)
        or _clean_invite(os.environ.get(ENV_GATE))
        or _clean_invite(files["gate"])
    )
    bitget = (
        _clean_invite(stored_bitget)
        or _clean_invite(os.environ.get(ENV_BITGET))
        or _clean_invite(files["bitget"])
    )
    return {
        "gate": gate,
        "bitget": bitget,
        "gateConfigured": bool(gate),
        "bitgetConfigured": bool(bitget),
    }
