import csv
import json
from pathlib import Path


CSV_FILE = Path("TiaBTC_公开视频清单_20260711.csv")
PLAYLIST_FILE = Path("_tiabtc_flat.json")


def main():
    playlist = json.loads(PLAYLIST_FILE.read_text(encoding="utf-8-sig"))
    titles = {entry["id"]: entry["title"] for entry in playlist["entries"]}

    with CSV_FILE.open(encoding="utf-8-sig", newline="") as source_file:
        reader = csv.DictReader(source_file)
        fieldnames = reader.fieldnames
        rows = list(reader)

    updated = 0
    for row in rows:
        title = titles.get(row["视频ID"])
        if title is not None and row["视频标题"] != title:
            row["视频标题"] = title
            updated += 1

    with CSV_FILE.open("w", encoding="utf-8-sig", newline="") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Repaired {updated} titles; playlist titles found: {len(titles)}.")


if __name__ == "__main__":
    main()
