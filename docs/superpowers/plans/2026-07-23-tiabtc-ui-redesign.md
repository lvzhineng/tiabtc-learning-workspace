# TiaBTC 学习与复盘工作台 UI 界面全局升级实施计划 (UI Redesign Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全局重构 TiaBTC 视频学习工作台与 K 线复盘控制台的视觉展示，实现现代化沉浸式深浅双主题无缝切换，提升视觉品质且不改变任何既有业务逻辑与 API 接口。

**Architecture:** 构建基于 CSS Custom Properties (`--bg-app`, `--text-primary`, `--accent-blue` 等) 的设计系统变量。默认激活深色模式 (`[data-theme="dark"]`)，并支持浅色模式切换与 `localStorage` 偏好保存；在 `review_chart.js` 中捕获主题变更以同步重绘 Lightweight Charts 的配色背景。

**Tech Stack:** HTML5, CSS Custom Properties (CSS Tokens), Vanilla JavaScript, TradingView Lightweight Charts (v4.x), Python (`generate_tiabtc_html.py`)

---

### Task 1: 建立全局 CSS 设计系统与双主题变量 (`review_chart.css`)

**Files:**
- Modify: [review_chart.css](file:///c:/Users/23888/Documents/private/tiabtc-learning-workspace/review_chart.css)

- [ ] **Step 1: 在 `review_chart.css` 中引入 `:root` 与 `[data-theme="dark"]` / `[data-theme="light"]` 设计变量**

在 `review_chart.css` 头部添加完整的 Design Tokens 变量及平滑过渡通用类：

```css
:root,
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg-app: #0b0e14;
  --bg-card: #151922;
  --bg-card-hover: #1c2230;
  --border-color: rgba(255, 255, 255, 0.08);
  --border-focus: #3b82f6;

  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;

  --accent-blue: #3b82f6;
  --accent-blue-hover: #2563eb;
  --accent-cyan: #06b6d4;
  --accent-green: #10b981;
  --accent-amber: #f59e0b;

  --badge-unlearned-bg: rgba(51, 65, 85, 0.5);
  --badge-unlearned-text: #cbd5e1;
  --badge-learning-bg: rgba(245, 158, 11, 0.15);
  --badge-learning-text: #fbbf24;
  --badge-learned-bg: rgba(16, 185, 129, 0.15);
  --badge-learned-text: #34d399;

  --chart-bg: #0b0e14;
  --chart-grid: rgba(255, 255, 255, 0.04);
  --chart-text: #94a3b8;
  --shadow-card: 0 8px 32px rgba(0, 0, 0, 0.4);
}

:root[data-theme="light"] {
  color-scheme: light;
  --bg-app: #f8fafc;
  --bg-card: #ffffff;
  --bg-card-hover: #f1f5f9;
  --border-color: #e2e8f0;
  --border-focus: #2563eb;

  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-muted: #94a3b8;

  --accent-blue: #2563eb;
  --accent-blue-hover: #1d4ed8;
  --accent-cyan: #0891b2;
  --accent-green: #059669;
  --accent-amber: #d97706;

  --badge-unlearned-bg: #f1f5f9;
  --badge-unlearned-text: #475569;
  --badge-learning-bg: #fef3c7;
  --badge-learning-text: #b45309;
  --badge-learned-bg: #d1fae5;
  --badge-learned-text: #047857;

  --chart-bg: #ffffff;
  --chart-grid: rgba(0, 0, 0, 0.04);
  --chart-text: #475569;
  --shadow-card: 0 4px 20px rgba(0, 0, 0, 0.06);
}
```

- [ ] **Step 2: 验证样式变量兼容性**

保存文件并确保无语法错误。

- [ ] **Step 3: 提交代码**

```bash
git add review_chart.css
git commit -m "style: add CSS design tokens and dark/light dual theme variables"
```

---

### Task 2: 升级视频学习工作台生成器 (`generate_tiabtc_html.py`)

**Files:**
- Modify: [generate_tiabtc_html.py](file:///c:/Users/23888/Documents/private/tiabtc-learning-workspace/generate_tiabtc_html.py)
- Re-generate: [TiaBTC_学习视频清单.html](file:///c:/Users/23888/Documents/private/tiabtc-learning-workspace/TiaBTC_学习视频清单.html)

- [ ] **Step 1: 在 `generate_tiabtc_html.py` 中更新 CSS 样式与 Header 结构**

增加主题切换按钮 `#theme-toggle`、重构 Dashboard 玻璃卡片、微发光控件、置顶毛玻璃 Header 表格样式，以及添加 JS 主题初始化逻辑：

```javascript
// Theme init & toggle logic in HTML
const savedTheme = localStorage.getItem('tiabtc-theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('tiabtc-theme', newTheme);
  updateThemeButtonText(newTheme);
}
```

- [ ] **Step 2: 运行生成脚本重新创建 `TiaBTC_学习视频清单.html`**

运行: `python generate_tiabtc_html.py`

- [ ] **Step 3: 检查生成的 HTML 文件**

确保 `TiaBTC_学习视频清单.html` 成功更新且语法无误。

- [ ] **Step 4: 提交代码**

```bash
git add generate_tiabtc_html.py TiaBTC_学习视频清单.html
git commit -m "feat(ui): redesign video learning workstation with glassmorphism and theme toggle"
```

---

### Task 3: 重构 K 线复盘控制台弹窗与画图工具栏样式 (`review_chart.css`)

**Files:**
- Modify: [review_chart.css](file:///c:/Users/23888/Documents/private/tiabtc-learning-workspace/review_chart.css)
- Modify: [TiaBTC_K线复盘.html](file:///c:/Users/23888/Documents/private/tiabtc-learning-workspace/TiaBTC_K线复盘.html)

- [ ] **Step 1: 重构弹窗外壳 `.chart-shell` 与控制头 `.chart-header` 样式**

使用 `--bg-app` 与 `--bg-card`，并对回放控制按钮、周期按钮切换组 `.interval-buttons` 增加 Segmented Modern Toggle 样式。

- [ ] **Step 2: 重构浮动画图工具栏 `.drawing-tools` 样式**

使其在悬浮在左侧时呈现胶囊立体 Dock 效果，增加选中的发光环提示与 Hover 放大反馈。

- [ ] **Step 3: 重构悬浮 OHLC 面板 `#chart-candle-data`**

采用 `backdrop-filter: blur(8px)`，涨跌红绿使用鲜亮但不刺眼的渐变或发光标准色。

- [ ] **Step 4: 提交代码**

```bash
git add review_chart.css TiaBTC_K线复盘.html
git commit -m "style(ui): redesign review chart modal, replay bar, and floating drawing dock"
```

---

### Task 4: Lightweight Charts 图表主题动态联动 (`review_chart.js`)

**Files:**
- Modify: [review_chart.js](file:///c:/Users/23888/Documents/private/tiabtc-learning-workspace/review_chart.js)

- [ ] **Step 1: 在 `review_chart.js` 中增加图表主题更新方法**

创建 `updateChartTheme()` 方法：

```javascript
function updateChartTheme() {
  if (!state.chart) return;
  const isDark = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark';
  state.chart.applyOptions({
    layout: {
      background: { type: 'solid', color: isDark ? '#0b0e14' : '#ffffff' },
      textColor: isDark ? '#94a3b8' : '#475569',
    },
    grid: {
      vertLines: { color: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)' },
      horzLines: { color: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)' },
    },
  });
}
```

- [ ] **Step 2: 监听 `data-theme` 变化或 `MutationObserver` / CustomEvent，自动调用 `updateChartTheme()`**

- [ ] **Step 3: 提交代码**

```bash
git add review_chart.js
git commit -m "feat(chart): sync Lightweight Charts color options with active theme"
```

---

### Task 5: 全局功能验证与测试套件校验

**Files:**
- Test: [test_study_server.py](file:///c:/Users/23888/Documents/private/tiabtc-learning-workspace/test_study_server.py)

- [ ] **Step 1: 运行现有 Python 单元测试确保后端逻辑完全不受破坏**

运行: `python -m unittest test_study_server.py`
预期: ALL TESTS PASS

- [ ] **Step 2: 验证 HTML 文件与 JavaScript 语法合法性**

- [ ] **Step 3: 最终提交与记录**

```bash
git add .
git commit -m "chore: complete UI redesign verification"
```
