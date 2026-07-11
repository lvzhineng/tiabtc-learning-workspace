import csv
import json
from pathlib import Path


SOURCE = Path("TiaBTC_公开视频清单_20260711.csv")
OUTPUT = Path("TiaBTC_学习视频清单.html")


def main():
    with SOURCE.open(encoding="utf-8-sig", newline="") as source_file:
        videos = list(csv.DictReader(source_file))

    video_data = json.dumps(videos, ensure_ascii=False).replace("</", "<\\/")
    page = f'''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TiaBTC 顺序学习工作台</title>
  <style>
    :root {{
      color-scheme: light; font-family: "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
      color: #172033; background: #f4f7fb; --blue: #315fce; --blue-dark: #234aa8;
      --line: #dbe3ef; --muted: #64748b; --green: #18845b; --amber: #a45c00;
    }}
    * {{ box-sizing: border-box; }} body {{ margin: 0; background: linear-gradient(180deg, #edf3ff 0, #f4f7fb 300px); }}
    main {{ max-width: 1320px; margin: auto; padding: 34px 22px 56px; }}
    button, input, select, textarea {{ font: inherit; }} button, select {{ cursor: pointer; }}
    button {{ border: 1px solid #b9c8df; border-radius: 9px; padding: 8px 13px; background: #fff; color: #243b61; }}
    button:hover:not(:disabled) {{ border-color: #8ba7d6; background: #f2f6ff; }} button:disabled {{ opacity: .48; cursor: not-allowed; }}
    input, select, textarea {{ border: 1px solid #c5d0e0; border-radius: 9px; padding: 9px 11px; background: #fff; color: #172033; }}
    input:focus, select:focus, textarea:focus {{ outline: 3px solid #dbe7ff; border-color: #6e91d8; }}
    .hero {{ display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 22px; }}
    .eyebrow {{ margin: 0 0 6px; color: var(--blue); font-weight: 700; letter-spacing: .08em; font-size: 13px; }}
    h1 {{ margin: 0; font-size: clamp(26px, 3vw, 38px); letter-spacing: -.03em; }}
    .subtitle {{ margin: 9px 0 0; color: var(--muted); line-height: 1.6; }}
    .primary {{ background: var(--blue); color: #fff; border-color: var(--blue); font-weight: 700; padding: 11px 18px; box-shadow: 0 8px 20px rgba(49, 95, 206, .18); }}
    .primary:hover:not(:disabled) {{ background: var(--blue-dark); border-color: var(--blue-dark); }}
    .dashboard {{ display: grid; grid-template-columns: repeat(4, minmax(130px, 1fr)) 2fr; gap: 12px; margin-bottom: 18px; }}
    .metric, .progress-card {{ background: rgba(255,255,255,.92); border: 1px solid var(--line); border-radius: 14px; padding: 15px 17px; box-shadow: 0 6px 20px rgba(42, 63, 95, .05); }}
    .metric-label, .progress-label {{ color: var(--muted); font-size: 13px; }} .metric-value {{ display: block; margin-top: 5px; font-size: 24px; font-weight: 800; }}
    .progress-head {{ display: flex; justify-content: space-between; gap: 12px; margin-bottom: 10px; }} .progress-head strong {{ font-size: 18px; }}
    .progress-track {{ height: 10px; background: #e7edf6; border-radius: 999px; overflow: hidden; }}
    .progress-fill {{ height: 100%; width: 0; border-radius: inherit; background: linear-gradient(90deg, #315fce, #27a676); transition: width .25s ease; }}
    .filters {{ background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 15px; margin-bottom: 14px; box-shadow: 0 6px 20px rgba(42, 63, 95, .045); }}
    .filter-row {{ display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }} .filter-row + .filter-row {{ margin-top: 11px; }}
    #search {{ flex: 1 1 320px; min-width: 220px; }} .filter-select {{ min-width: 132px; }}
    .quick-filters {{ display: flex; gap: 7px; flex-wrap: wrap; }} .chip {{ border-radius: 999px; padding: 7px 12px; font-size: 14px; }}
    .chip.active {{ background: #e5edff; color: var(--blue-dark); border-color: #8ca9e4; font-weight: 700; }}
    .context-bar {{ display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 12px 2px; color: #465a78; }}
    #scope-progress {{ font-weight: 700; }} #save-status {{ font-size: 14px; color: var(--green); }} #save-status.error {{ color: #b42318; }}
    .table-wrap {{ max-height: calc(100vh - 150px); overflow: auto; background: #fff; border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 10px 30px rgba(42, 63, 95, .06); }}
    table {{ width: 100%; border-collapse: separate; border-spacing: 0; min-width: 1030px; }}
    th, td {{ padding: 11px 13px; border-bottom: 1px solid #e8edf4; text-align: left; vertical-align: top; }}
    th {{ position: sticky; top: 0; z-index: 2; background: #edf3fd; color: #334b70; font-size: 13px; letter-spacing: .02em; }}
    tbody tr:nth-child(even) {{ background: #fbfcfe; }} tbody tr:hover {{ background: #f2f6ff; }}
    tr.learned {{ background-image: linear-gradient(90deg, rgba(33, 151, 105, .07), transparent 36%); }}
    tr.current-target {{ outline: 3px solid #f2b94b; outline-offset: -3px; background: #fff9e8; }}
    .index {{ width: 64px; color: var(--muted); font-variant-numeric: tabular-nums; }} .date-cell {{ width: 128px; white-space: nowrap; }}
    .date-main {{ font-weight: 700; }} .date-time, .muted {{ color: var(--muted); font-size: 12px; }}
    .video-title {{ color: #1555b5; text-decoration: none; font-weight: 700; line-height: 1.55; }} .video-title:hover {{ text-decoration: underline; }}
    .video-meta {{ display: flex; align-items: center; gap: 8px; margin-top: 7px; }}
    .bookmark {{ width: 36px; height: 34px; padding: 2px; font-size: 20px; }} .bookmark.active {{ color: var(--amber); background: #fff5d8; border-color: #edc45f; }}
    .status-select {{ min-width: 104px; padding: 7px 9px; font-weight: 700; }}
    .quick-toggle {{ white-space: nowrap; padding: 7px 9px; font-size: 13px; }}
    details.note summary {{ cursor: pointer; color: #4b6284; font-size: 13px; user-select: none; }}
    details.note[open] summary {{ color: var(--blue); font-weight: 700; }} .note textarea {{ display: block; width: min(520px, 48vw); min-height: 86px; margin-top: 8px; resize: vertical; line-height: 1.55; }}
    .pagination {{ display: flex; justify-content: center; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 18px; }} #page-input {{ width: 70px; text-align: center; }}
    .empty {{ padding: 44px 20px; text-align: center; color: var(--muted); }}
    @media (max-width: 960px) {{ .dashboard {{ grid-template-columns: repeat(2, 1fr); }} .progress-card {{ grid-column: 1 / -1; }} .table-wrap {{ max-height: none; }} }}
    @media (max-width: 680px) {{
      main {{ padding: 22px 10px 38px; }} .hero {{ flex-direction: column; }} .hero .primary {{ width: 100%; }}
      .dashboard {{ grid-template-columns: repeat(2, 1fr); }} .metric, .progress-card {{ padding: 12px; }}
      .filter-row > input, .filter-row > select {{ width: 100%; }} .quick-filters {{ width: 100%; }} .context-bar {{ align-items: flex-start; flex-direction: column; }}
      th, td {{ padding: 9px 10px; }} .note textarea {{ width: min(520px, 75vw); }}
    }}
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div><p class="eyebrow">TIA BTC · SYSTEMATIC LEARNING</p><h1>顺序学习工作台</h1><p class="subtitle">从最早的视频开始，按年月推进。书签、状态和备注会自动保存在本机。</p></div>
      <button id="continue-learning" class="primary" type="button">继续学习 →</button>
    </section>

    <section class="dashboard" aria-label="学习概览">
      <div class="metric"><span class="metric-label">全部视频</span><strong id="total-count" class="metric-value">0</strong></div>
      <div class="metric"><span class="metric-label">已经学完</span><strong id="learned-count" class="metric-value">0</strong></div>
      <div class="metric"><span class="metric-label">剩余视频</span><strong id="remaining-count" class="metric-value">0</strong></div>
      <div class="metric"><span class="metric-label">我的书签</span><strong id="bookmark-count" class="metric-value">0</strong></div>
      <div class="progress-card"><div class="progress-head"><span class="progress-label">总体完成进度</span><strong id="overall-percent">0%</strong></div><div class="progress-track"><div id="overall-progress" class="progress-fill"></div></div></div>
    </section>

    <section class="filters" aria-label="筛选条件">
      <div class="filter-row">
        <input id="search" type="search" placeholder="搜索标题、日期或备注…" autofocus>
        <select id="year-filter" class="filter-select" aria-label="年份"><option value="all">全部年份</option></select>
        <select id="month-filter" class="filter-select" aria-label="月份" disabled><option value="all">全部月份</option></select>
        <select id="sort-order" class="filter-select" aria-label="排序"><option value="asc">最早优先</option><option value="desc">最新优先</option></select>
      </div>
      <div class="filter-row"><div id="quick-filters" class="quick-filters" role="group" aria-label="快捷筛选">
        <button class="chip active" type="button" data-filter="all">全部</button><button class="chip" type="button" data-filter="unfinished">未完成</button>
        <button class="chip" type="button" data-filter="learned">已学</button><button class="chip" type="button" data-filter="bookmarked">仅书签</button><button class="chip" type="button" data-filter="noted">有备注</button>
      </div></div>
    </section>

    <div class="context-bar"><span id="scope-progress"></span><span id="save-status" role="status"></span></div>
    <div class="table-wrap"><table>
      <thead><tr><th class="index">序号</th><th>书签</th><th class="date-cell">发布日期</th><th>视频与学习笔记</th><th>学习状态</th><th>快捷操作</th></tr></thead>
      <tbody id="videos"></tbody>
    </table></div>
    <div class="pagination">
      <button id="first-page" type="button">首页</button><button id="previous-page" type="button">上一页</button>
      <span id="page-range"></span><label>第 <input id="page-input" type="number" min="1" value="1"> 页</label><span id="page-total"></span>
      <button id="next-page" type="button">下一页</button><button id="last-page" type="button">末页</button>
    </div>
  </main>
  <script>
    const rawVideos = {video_data};
    const pageSize = 100;
    const statusLabels = {{ unlearned: '未学', learning: '学习中', learned: '已学' }};
    const state = {{ records: {{}} }};
    const noteTimers = new Map();
    let currentPage = 1;
    let quickFilter = 'all';
    let highlightedVideoId = '';
    const $ = (selector) => document.querySelector(selector);
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({{ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }}[char]));
    const dateKey = (video) => `${{video['发布日期'] || '9999-99-99'}}T${{video['发布时间（页面时区）'] || '00:00:00'}}`;

    async function loadState() {{
      try {{
        const response = await fetch('/api/state');
        if (!response.ok) throw new Error('读取失败');
        const data = await response.json(); state.records = data.records || {{}};
      }} catch (error) {{ showSaveError('无法读取学习记录；请通过本机服务打开。'); }}
      populateYears(); render();
    }}

    function recordFor(videoId) {{ return state.records[videoId] || {{ bookmarked: false, status: 'unlearned', note: '' }}; }}
    function compactRecord(record) {{ return {{ bookmarked: Boolean(record.bookmarked), status: record.status || 'unlearned', note: record.note || '' }}; }}
    function isLearned(video) {{ return recordFor(video['视频ID']).status === 'learned'; }}

    function populateYears() {{
      const years = [...new Set(rawVideos.map((video) => video['发布日期'].slice(0, 4)).filter(Boolean))].sort();
      $('#year-filter').innerHTML = '<option value="all">全部年份</option>' + years.map((year) => `<option value="${{year}}">${{year}} 年</option>`).join('');
    }}

    function populateMonths() {{
      const year = $('#year-filter').value;
      const current = $('#month-filter').value;
      if (year === 'all') {{ $('#month-filter').innerHTML = '<option value="all">全部月份</option>'; $('#month-filter').disabled = true; return; }}
      const months = [...new Set(rawVideos.filter((video) => video['发布日期'].startsWith(`${{year}}-`)).map((video) => video['发布日期'].slice(5, 7)))].sort();
      $('#month-filter').innerHTML = '<option value="all">全部月份</option>' + months.map((month) => `<option value="${{month}}">${{Number(month)}} 月</option>`).join('');
      $('#month-filter').disabled = false; $('#month-filter').value = months.includes(current) ? current : 'all';
    }}

    function periodVideos() {{
      const year = $('#year-filter').value; const month = $('#month-filter').value;
      return rawVideos.filter((video) => (year === 'all' || video['发布日期'].startsWith(`${{year}}-`)) && (year === 'all' || month === 'all' || video['发布日期'].slice(5, 7) === month));
    }}

    function filteredVideos() {{
      const term = $('#search').value.trim().toLowerCase(); const order = $('#sort-order').value;
      return periodVideos().filter((video) => {{
        const record = recordFor(video['视频ID']);
        const matchesTerm = !term || `${{video['视频标题']}} ${{video['发布日期']}} ${{record.note || ''}}`.toLowerCase().includes(term);
        const matchesQuick = quickFilter === 'all' || (quickFilter === 'unfinished' && record.status !== 'learned') || (quickFilter === 'learned' && record.status === 'learned') || (quickFilter === 'bookmarked' && record.bookmarked) || (quickFilter === 'noted' && Boolean(record.note && record.note.trim()));
        return matchesTerm && matchesQuick;
      }}).sort((a, b) => order === 'asc' ? dateKey(a).localeCompare(dateKey(b)) : dateKey(b).localeCompare(dateKey(a)));
    }}

    function scopeLabel() {{
      const year = $('#year-filter').value; const month = $('#month-filter').value;
      if (year === 'all') return '全部时间'; if (month === 'all') return `${{year}} 年`; return `${{year}} 年 ${{Number(month)}} 月`;
    }}

    function renderDashboard() {{
      const learned = rawVideos.filter(isLearned).length; const bookmarked = rawVideos.filter((video) => recordFor(video['视频ID']).bookmarked).length;
      const percent = rawVideos.length ? Math.round(learned * 100 / rawVideos.length) : 0;
      $('#total-count').textContent = rawVideos.length; $('#learned-count').textContent = learned; $('#remaining-count').textContent = rawVideos.length - learned; $('#bookmark-count').textContent = bookmarked;
      $('#overall-percent').textContent = `${{percent}}%`; $('#overall-progress').style.width = `${{percent}}%`;
    }}

    function render() {{
      const filtered = filteredVideos(); const period = periodVideos(); const periodLearned = period.filter(isLearned).length;
      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize)); currentPage = Math.min(Math.max(currentPage, 1), totalPages);
      const start = (currentPage - 1) * pageSize; const pageVideos = filtered.slice(start, start + pageSize);
      $('#videos').innerHTML = pageVideos.map((video, pageIndex) => {{
        const record = recordFor(video['视频ID']); const id = escapeHtml(video['视频ID']); const learned = record.status === 'learned';
        return `<tr data-video-id="${{id}}" class="${{learned ? 'learned ' : ''}}${{highlightedVideoId === video['视频ID'] ? 'current-target' : ''}}">
          <td class="index">${{start + pageIndex + 1}}</td>
          <td><button class="bookmark ${{record.bookmarked ? 'active' : ''}}" type="button" aria-label="切换书签" title="切换书签">${{record.bookmarked ? '★' : '☆'}}</button></td>
          <td class="date-cell"><span class="date-main">${{escapeHtml(video['发布日期'])}}</span><br><span class="date-time">${{escapeHtml(video['发布时间（页面时区）'])}}</span></td>
          <td><a class="video-title" href="${{escapeHtml(video['视频链接'])}}" target="_blank" rel="noopener">${{escapeHtml(video['视频标题'])}}</a>
            <div class="video-meta"><details class="note" ${{record.note ? 'open' : ''}}><summary>${{record.note ? '📝 已有备注' : '＋ 添加备注'}}</summary><textarea placeholder="记录观点、问题或复盘…">${{escapeHtml(record.note)}}</textarea></details></div></td>
          <td><select class="status-select" aria-label="学习状态">${{Object.entries(statusLabels).map(([value, label]) => `<option value="${{value}}" ${{record.status === value ? 'selected' : ''}}>${{label}}</option>`).join('')}}</select></td>
          <td><button class="quick-toggle" type="button">${{learned ? '撤销完成' : '标记已学'}}</button></td>
        </tr>`;
      }}).join('') || '<tr><td colspan="6" class="empty">没有符合当前条件的视频，请调整筛选条件。</td></tr>';
      const rangeStart = filtered.length ? start + 1 : 0; const rangeEnd = Math.min(start + pageSize, filtered.length);
      $('#scope-progress').textContent = `${{scopeLabel()}}：已学 ${{periodLearned}} / ${{period.length}} · 当前筛选 ${{filtered.length}} 条`;
      $('#page-range').textContent = `显示 ${{rangeStart}}–${{rangeEnd}} / ${{filtered.length}}`;
      $('#page-input').value = currentPage; $('#page-input').max = totalPages; $('#page-total').textContent = `/ ${{totalPages}} 页`;
      $('#first-page').disabled = currentPage === 1; $('#previous-page').disabled = currentPage === 1; $('#next-page').disabled = currentPage === totalPages; $('#last-page').disabled = currentPage === totalPages;
      $('#continue-learning').disabled = !filtered.some((video) => !isLearned(video)); renderDashboard();
      if (highlightedVideoId) requestAnimationFrame(() => document.querySelector(`tr[data-video-id="${{CSS.escape(highlightedVideoId)}}"]`)?.scrollIntoView({{ behavior: 'smooth', block: 'center' }}));
    }}

    async function saveRecord(videoId, shouldRender = true) {{
      const record = compactRecord(recordFor(videoId)); const isDefault = !record.bookmarked && record.status === 'unlearned' && !record.note;
      if (isDefault) delete state.records[videoId]; else state.records[videoId] = record;
      $('#save-status').textContent = '正在保存…'; $('#save-status').classList.remove('error');
      try {{
        const response = await fetch(`/api/state/${{encodeURIComponent(videoId)}}`, {{ method: 'PUT', headers: {{ 'Content-Type': 'application/json' }}, body: JSON.stringify(isDefault ? null : record) }});
        if (!response.ok) throw new Error('保存失败'); $('#save-status').textContent = '✓ 已保存到本机';
      }} catch (error) {{ showSaveError('保存失败；当前内容仍保留在页面。'); }}
      if (shouldRender) render(); else renderDashboard();
    }}

    function showSaveError(message) {{ $('#save-status').textContent = message; $('#save-status').classList.add('error'); }}
    function resetPageAndRender() {{ currentPage = 1; highlightedVideoId = ''; render(); }}
    function updatePage(page) {{ currentPage = Number.isFinite(page) ? page : 1; highlightedVideoId = ''; render(); window.scrollTo({{ top: 0, behavior: 'smooth' }}); }}

    $('#year-filter').addEventListener('change', () => {{ populateMonths(); resetPageAndRender(); }}); $('#month-filter').addEventListener('change', resetPageAndRender);
    $('#search').addEventListener('input', resetPageAndRender); $('#sort-order').addEventListener('change', resetPageAndRender);
    $('#quick-filters').addEventListener('click', (event) => {{ const chip = event.target.closest('.chip'); if (!chip) return; quickFilter = chip.dataset.filter; document.querySelectorAll('.chip').forEach((item) => item.classList.toggle('active', item === chip)); resetPageAndRender(); }});
    $('#first-page').addEventListener('click', () => updatePage(1)); $('#previous-page').addEventListener('click', () => updatePage(currentPage - 1));
    $('#next-page').addEventListener('click', () => updatePage(currentPage + 1)); $('#last-page').addEventListener('click', () => updatePage(Number($('#page-input').max))); $('#page-input').addEventListener('change', (event) => updatePage(Number(event.target.value)));
    $('#continue-learning').addEventListener('click', () => {{ const filtered = filteredVideos(); const index = filtered.findIndex((video) => !isLearned(video)); if (index < 0) return; currentPage = Math.floor(index / pageSize) + 1; highlightedVideoId = filtered[index]['视频ID']; render(); }});
    $('#videos').addEventListener('click', (event) => {{
      const row = event.target.closest('tr[data-video-id]'); if (!row) return; const videoId = row.dataset.videoId;
      if (event.target.closest('.bookmark')) {{ const record = recordFor(videoId); record.bookmarked = !record.bookmarked; state.records[videoId] = record; saveRecord(videoId); return; }}
      if (event.target.closest('.quick-toggle')) {{ const record = recordFor(videoId); record.status = record.status === 'learned' ? 'unlearned' : 'learned'; state.records[videoId] = record; saveRecord(videoId); return; }}
      if (event.target.closest('.video-title')) {{ const record = recordFor(videoId); if (record.status !== 'learned') {{ record.status = 'learned'; state.records[videoId] = record; saveRecord(videoId); }} }}
    }});
    $('#videos').addEventListener('change', (event) => {{ if (!event.target.matches('.status-select')) return; const videoId = event.target.closest('tr').dataset.videoId; const record = recordFor(videoId); record.status = event.target.value; state.records[videoId] = record; saveRecord(videoId); }});
    $('#videos').addEventListener('input', (event) => {{
      if (!event.target.matches('textarea')) return; const videoId = event.target.closest('tr').dataset.videoId; const record = recordFor(videoId); record.note = event.target.value; state.records[videoId] = record;
      clearTimeout(noteTimers.get(videoId)); noteTimers.set(videoId, setTimeout(() => saveRecord(videoId, false), 650));
    }});
    loadState();
  </script>
</body>
</html>'''
    OUTPUT.write_text(page, encoding="utf-8")
    print(f"Created {OUTPUT} with {len(videos)} rows.")


if __name__ == "__main__":
    main()
