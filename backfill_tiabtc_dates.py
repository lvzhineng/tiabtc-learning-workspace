import csv
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


CSV_FILE = Path("TiaBTC_公开视频清单_20260711.csv")
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9",
}
DATE_PATTERN = re.compile(r'"publishDate":"(\d{4}-\d{2}-\d{2})(?:T([^"]+))?"')


def fetch_date(row):
    for attempt in range(3):
        try:
            request = urllib.request.Request(row["视频链接"], headers=HEADERS)
            content = urllib.request.urlopen(request, timeout=35).read().decode("utf-8", "ignore")
            match = DATE_PATTERN.search(content)
            if match:
                return row["视频ID"], match.group(1), match.group(2) or ""
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return row["视频ID"], "", ""


def main():
    with CSV_FILE.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        fields = reader.fieldnames
        rows = list(reader)

    pending = [row for row in rows if not row["发布日期"]]
    print(f"Pending dates: {len(pending)}")
    results = {}
    with ThreadPoolExecutor(max_workers=3) as executor:
        for index, result in enumerate(executor.map(fetch_date, pending), 1):
            video_id, published_date, published_time = result
            results[video_id] = (published_date, published_time)
            if index % 50 == 0:
                print(f"Processed {index}/{len(pending)}")
            time.sleep(0.2)

    filled = 0
    for row in rows:
        published_date, published_time = results.get(row["视频ID"], ("", ""))
        if not row["发布日期"] and published_date:
            row["发布日期"] = published_date
            row["发布时间（页面时区）"] = published_time
            filled += 1

    with CSV_FILE.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Filled: {filled}; remaining: {sum(not row['发布日期'] for row in rows)}")


if __name__ == "__main__":
    main()
