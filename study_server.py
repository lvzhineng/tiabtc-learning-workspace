import json
import os
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
STATE_FILE = ROOT / "learning-state.json"
HOST = "127.0.0.1"
PORT = 8765
VALID_STATUSES = {"unlearned", "learning", "learned"}


def load_state():
    if not STATE_FILE.exists():
        return {"records": {}}
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        records = data.get("records", {})
        return {"records": records if isinstance(records, dict) else {}}
    except (OSError, json.JSONDecodeError):
        return {"records": {}}


def write_state(state):
    temporary_file = STATE_FILE.with_suffix(".json.tmp")
    temporary_file.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary_file, STATE_FILE)


class StudyHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        if urlparse(self.path).path == "/":
            self.path = "/TiaBTC_学习视频清单.html"
        if urlparse(self.path).path == "/api/state":
            return self.send_json(HTTPStatus.OK, load_state())
        return super().do_GET()

    def do_PUT(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/state/"):
            return self.send_error(HTTPStatus.NOT_FOUND)
        video_id = unquote(path.removeprefix("/api/state/"))
        if not video_id or "/" in video_id:
            return self.send_error(HTTPStatus.BAD_REQUEST, "无效的视频 ID")
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8")) if length else None
            if payload is not None:
                payload = self.validate_record(payload)
            state = load_state()
            if payload is None:
                state["records"].pop(video_id, None)
            else:
                state["records"][video_id] = payload
            write_state(state)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        return self.send_json(HTTPStatus.OK, {"ok": True})

    def validate_record(self, value):
        if not isinstance(value, dict):
            raise ValueError("记录必须是对象")
        status = value.get("status", "unlearned")
        note = value.get("note", "")
        if status not in VALID_STATUSES or not isinstance(note, str) or len(note) > 20000:
            raise ValueError("学习记录格式无效")
        return {"bookmarked": bool(value.get("bookmarked")), "status": status, "note": note}

    def send_json(self, status, payload):
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, format, *args):
        print(f"{self.client_address[0]} - {format % args}")


if __name__ == "__main__":
    print(f"学习页已启动：http://{HOST}:{PORT}/")
    print("按 Ctrl+C 停止服务。")
    ThreadingHTTPServer((HOST, PORT), StudyHandler).serve_forever()
