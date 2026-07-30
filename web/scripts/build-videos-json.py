import csv
import json
from pathlib import Path

def main():
    root_dir = Path(__file__).resolve().parent.parent.parent
    csv_path = root_dir / 'TiaBTC_公开视频清单_20260711.csv'
    out_path = root_dir / 'web' / 'public' / 'videos.json'

    if not csv_path.exists():
        print(f"Error: CSV file not found at {csv_path}")
        return

    with csv_path.open(encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        videos = []
        for row in reader:
            cleaned_row = {k.strip(): v.strip() for k, v in row.items() if k}
            idx = cleaned_row.get('序号', '')
            pub_date = cleaned_row.get('发布日期', '')
            pub_time = cleaned_row.get('发布时间（网页时间）', '')
            title = cleaned_row.get('视频标题', '')
            url = cleaned_row.get('视频链接', '')
            video_id = cleaned_row.get('视频ID', '')

            videos.append({
                'index': int(idx) if idx.isdigit() else 0,
                'date': pub_date,
                'time': pub_time,
                'title': title,
                'url': url,
                'videoId': video_id,
            })

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open('w', encoding='utf-8') as out_f:
        json.dump(videos, out_f, ensure_ascii=False, indent=2)

    print(f"Successfully generated {out_path} with {len(videos)} videos.")

if __name__ == '__main__':
    main()
