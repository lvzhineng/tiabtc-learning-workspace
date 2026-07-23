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
  <link rel="stylesheet" href="/review_chart.css?v=20260723-1">
  <style>
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; background: var(--bg-app); color: var(--text-primary); transition: background-color .2s ease, color .2s ease; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif; }}
    main {{ max-width: 1360px; margin: auto; padding: 28px 20px 56px; }}
    button, input, select, textarea {{ font: inherit; color: inherit; }} button, select {{ cursor: pointer; }}
    button {{ border: 1px solid var(--border-color); border-radius: 9px; padding: 8px 14px; background: var(--bg-card); color: var(--text-primary); transition: all .18s ease; }}
    button:hover:not(:disabled) {{ border-color: var(--border-hover); background: var(--bg-card-hover); box-shadow: var(--shadow-glow); }} button:disabled {{ opacity: .42; cursor: not-allowed; }}
    input, select, textarea {{ border: 1px solid var(--border-color); border-radius: 9px; padding: 9px 12px; background: var(--bg-card); color: var(--text-primary); transition: all .18s ease; }}
    input:focus, select:focus, textarea:focus {{ outline: 0; border-color: var(--border-focus); box-shadow: var(--shadow-glow); }}
    
    .hero {{ display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 24px; }}
    .eyebrow {{ margin: 0 0 6px; color: var(--accent-cyan); font-weight: 700; letter-spacing: .08em; font-size: 13px; text-transform: uppercase; }}
    h1 {{ margin: 0; font-size: clamp(26px, 3.2vw, 38px); letter-spacing: -.03em; font-weight: 800; color: var(--text-primary); }}
    .subtitle {{ margin: 8px 0 0; color: var(--text-secondary); line-height: 1.6; font-size: 14px; }}
    .hero-actions {{ display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; align-items: center; }}
    .primary {{ background: var(--accent-blue); color: #fff; border-color: var(--accent-blue); font-weight: 700; padding: 10px 18px; box-shadow: var(--shadow-glow); }}
    .primary:hover:not(:disabled) {{ background: var(--accent-blue-dark); border-color: var(--accent-blue-dark); }}
    .replay-primary {{ border-color: var(--accent-blue); color: var(--accent-blue-light); font-weight: 700; padding: 10px 18px; }}
    
    .dashboard {{ display: grid; grid-template-columns: repeat(4, minmax(130px, 1fr)) 2fr; gap: 14px; margin-bottom: 20px; }}
    .metric, .progress-card {{ background: var(--bg-card-glass); border: 1px solid var(--border-color); border-radius: 14px; padding: 16px 18px; box-shadow: var(--shadow-card); backdrop-filter: blur(10px); transition: all .2s ease; }}
    .metric:hover, .progress-card:hover {{ border-color: var(--border-hover); transform: translateY(-2px); }}
    .metric-label, .progress-label {{ color: var(--text-secondary); font-size: 13px; font-weight: 500; }}
    .metric-value {{ display: block; margin-top: 6px; font-size: 26px; font-weight: 800; color: var(--text-primary); font-variant-numeric: tabular-nums; }}
    .progress-head {{ display: flex; justify-content: space-between; gap: 12px; margin-bottom: 10px; align-items: baseline; }} .progress-head strong {{ font-size: 20px; font-weight: 800; color: var(--text-primary); }}
    .progress-track {{ height: 10px; background: var(--bg-app); border-radius: 999px; overflow: hidden; border: 1px solid var(--border-color); }}
    .progress-fill {{ height: 100%; width: 0; border-radius: inherit; background: linear-gradient(90deg, var(--accent-blue), var(--accent-green)); transition: width .3s ease; box-shadow: var(--shadow-glow); }}
    
    .filters {{ background: var(--bg-card-glass); border: 1px solid var(--border-color); border-radius: 14px; padding: 16px; margin-bottom: 16px; box-shadow: var(--shadow-card); backdrop-filter: blur(10px); }}
    .filter-row {{ display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }} .filter-row + .filter-row {{ margin-top: 12px; }}
    #search {{ flex: 1 1 320px; min-width: 220px; }} .filter-select {{ min-width: 132px; background: var(--bg-card); color: var(--text-primary); }}
    .quick-filters {{ display: flex; gap: 8px; flex-wrap: wrap; }}
    .chip {{ border-radius: 999px; padding: 7px 14px; font-size: 13px; font-weight: 500; background: var(--bg-card); border-color: var(--border-color); color: var(--text-secondary); transition: all .16s ease; }}
    .chip:hover {{ border-color: var(--accent-blue); color: var(--text-primary); }}
    .chip.active {{ background: var(--accent-blue); color: #fff; border-color: var(--accent-blue); font-weight: 700; box-shadow: var(--shadow-glow); }}
    
    .context-bar {{ display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 14px 4px; color: var(--text-secondary); font-size: 13px; }}
    #scope-progress {{ font-weight: 700; color: var(--text-primary); }} #save-status {{ font-size: 13px; color: var(--accent-green); font-weight: 600; }} #save-status.error {{ color: #ef4444; }}
    
    .table-wrap {{ max-height: calc(100vh - 160px); overflow: auto; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 14px; box-shadow: var(--shadow-card); }}
    table {{ width: 100%; border-collapse: separate; border-spacing: 0; min-width: 1030px; }}
    th, td {{ padding: 12px 14px; border-bottom: 1px solid var(--border-color); text-align: left; vertical-align: top; }}
    th {{ position: sticky; top: 0; z-index: 2; background: var(--bg-card); color: var(--text-secondary); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; backdrop-filter: blur(8px); }}
    tbody tr {{ transition: background-color .15s ease; }}
    tbody tr:hover {{ background: var(--bg-card-hover); }}
    tr.learned {{ background-image: linear-gradient(90deg, rgba(16, 185, 129, .06), transparent 36%); }}
    tr.current-target {{ outline: 2px solid var(--accent-amber); outline-offset: -2px; background: rgba(245, 158, 11, 0.08); }}
    
    .index {{ width: 64px; color: var(--text-muted); font-variant-numeric: tabular-nums; font-weight: 600; }}
    .date-cell {{ width: 136px; white-space: nowrap; }}
    .date-main {{ font-weight: 700; color: var(--text-primary); }} .date-time, .muted {{ color: var(--text-muted); font-size: 12px; }}
    .video-title {{ color: var(--accent-blue-light); text-decoration: none; font-weight: 700; line-height: 1.55; transition: color .16s ease; }} .video-title:hover {{ color: var(--accent-cyan); text-decoration: underline; }}
    .video-meta {{ display: flex; align-items: center; gap: 8px; margin-top: 8px; }}
    
    .bookmark {{ width: 34px; height: 32px; padding: 2px; font-size: 18px; border-radius: 8px; display: grid; place-items: center; border-color: var(--border-color); background: var(--bg-card); }}
    .bookmark.active {{ color: var(--accent-amber); background: rgba(245, 158, 11, 0.12); border-color: var(--accent-amber); }}
    
    .status-select {{ min-width: 104px; padding: 6px 10px; font-weight: 700; border-radius: 8px; }}
    .status-select option {{ background: var(--bg-card); color: var(--text-primary); }}
    
    .quick-toggle {{ white-space: nowrap; padding: 6px 10px; font-size: 13px; font-weight: 600; }}
    
    details.note summary {{ cursor: pointer; color: var(--text-secondary); font-size: 13px; user-select: none; transition: color .16s ease; }}
    details.note[open] summary {{ color: var(--accent-blue); font-weight: 700; }}
    .note textarea {{ display: block; width: min(520px, 48vw); min-height: 86px; margin-top: 8px; resize: vertical; line-height: 1.55; background: var(--bg-app); border-color: var(--border-color); border-radius: 8px; padding: 8px 10px; font-size: 13px; }}
    
    .pagination {{ display: flex; justify-content: center; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 22px; color: var(--text-secondary); }}
    #page-input {{ width: 70px; text-align: center; font-weight: 700; }}
    .empty {{ padding: 48px 20px; text-align: center; color: var(--text-muted); font-size: 15px; }}
    
    @media (max-width: 960px) {{ .dashboard {{ grid-template-columns: repeat(2, 1fr); }} .progress-card {{ grid-column: 1 / -1; }} .table-wrap {{ max-height: none; }} }}
    @media (max-width: 680px) {{
      main {{ padding: 20px 12px 38px; }} .hero {{ flex-direction: column; }} .hero-actions, .hero-actions button {{ width: 100%; }}
      .dashboard {{ grid-template-columns: repeat(2, 1fr); }} .metric, .progress-card {{ padding: 14px; }}
      .filter-row > input, .filter-row > select {{ width: 100%; }} .quick-filters {{ width: 100%; }} .context-bar {{ align-items: flex-start; flex-direction: column; }}
      th, td {{ padding: 10px 11px; }} .note textarea {{ width: min(520px, 75vw); }}
    }}
  </style>
</head>
<body data-theme="dark">
  <main>
    <section class="hero">
      <div>
        <p class="eyebrow">TIA BTC · SYSTEMATIC LEARNING</p>
        <h1>顺序学习工作台</h1>
        <p class="subtitle">从最早的视频开始按年月推进。书签、学习状态与笔记将持久化保存在本地。</p>
      </div>
      <div class="hero-actions">
        <button id="theme-toggle" class="theme-toggle-btn" type="button" aria-label="切换主题">🌙 暗黑模式</button>
        <button id="open-market-replay" class="replay-primary" type="button">📈 行情复盘</button>
        <button id="continue-learning" class="primary" type="button">继续学习 →</button>
      </div>
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
    // Theme Manager
    const savedTheme = localStorage.getItem('tiabtc-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.body.setAttribute('data-theme', savedTheme);
    
    function updateThemeToggleUI(theme) {{
      const btn = document.getElementById('theme-toggle');
      if (btn) btn.textContent = theme === 'dark' ? '🌙 暗黑模式' : '☀️ 浅色模式';
    }}
    updateThemeToggleUI(savedTheme);

    document.getElementById('theme-toggle')?.addEventListener('click', () => {{
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      document.body.setAttribute('data-theme', next);
      localStorage.setItem('tiabtc-theme', next);
      updateThemeToggleUI(next);
    }});

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
          <td><div class="quick-actions"><button class="review-open" type="button">K 线复盘</button><button class="quick-toggle" type="button">${{learned ? '撤销完成' : '标记已学'}}</button></div></td>
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
    $('#open-market-replay').addEventListener('click', () => {{
      const reviewTab = window.open('/TiaBTC_K%E7%BA%BF%E5%A4%8D%E7%9B%98.html?mode=replay', '_blank');
      if (reviewTab) reviewTab.focus(); else showSaveError('浏览器阻止了打开新标签页，请允许此页面打开链接。');
    }});
    $('#videos').addEventListener('click', (event) => {{
      const row = event.target.closest('tr[data-video-id]'); if (!row) return; const videoId = row.dataset.videoId;
      if (event.target.closest('.review-open')) {{
        const video = rawVideos.find((item) => item['视频ID'] === videoId); if (!video) return;
        const params = new URLSearchParams({{ videoId: video['视频ID'], title: video['视频标题'], date: video['发布日期'], time: video['发布时间（页面时区）'] }});
        const reviewTab = window.open(`/TiaBTC_K%E7%BA%BF%E5%A4%8D%E7%9B%98.html?${{params}}`, '_blank');
        if (reviewTab) reviewTab.focus(); else showSaveError('浏览器阻止了打开新标签页，请允许此页面打开链接。');
        return;
      }}
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

