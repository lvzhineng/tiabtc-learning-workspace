# TiaBTC 学习与复盘工作台 UI 界面全局升级设计规范 (Dual-Theme Design Spec)

## 1. 背景与目标 (Context & Goal)

本设计旨在对 `tiabtc-learning-workspace` 项目的整体 UI 界面进行现代化升级重构。在**完全不影响任何现有业务逻辑、API 接口及数据存储**的前提下，将视频学习工作台 (`TiaBTC_学习视频清单.html`) 和 K 线复盘控制台 (`TiaBTC_K线复盘.html`) 打造为具有专业加密交易终端质感的界面，并支持深色暗黑（Dark）与浅色清爽（Light）双主题无缝切换。

## 2. 设计系统与主题规范 (Design System & Color Tokens)

### 2.1 CSS 变量与主题定义 (`[data-theme="dark"]` / `[data-theme="light"]`)

将在全局 CSS 中构建 CSS Design Tokens 变量系统，默认激活深色模式 (`[data-theme="dark"]`)。

```css
:root, :root[data-theme="dark"] {
  --bg-app: #0b0e14;
  --bg-card: #151922;
  --bg-card-hover: #1c2230;
  --border-color: rgba(255, 255, 255, 0.08);
  --border-focus: #3b82f6;

  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;

  --accent-blue: #3b82f6;
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
  --bg-app: #f8fafc;
  --bg-card: #ffffff;
  --bg-card-hover: #f1f5f9;
  --border-color: #e2e8f0;
  --border-focus: #2563eb;

  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-muted: #94a3b8;

  --accent-blue: #2563eb;
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

### 2.2 基础排版与微交互

- **字体栈**：`system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif`
- **平滑过渡**：所有颜色、背景、边框、阴影切换具备 `transition: all 0.2s ease`
- **高亮发光**：获得焦点的 Input、Select 以及激活的按钮均增加微发光效果（`box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25)`）。

---

## 3. 视频学习工作台重构设计 (`generate_tiabtc_html.py`)

### 3.1 导航 Header 与主题切换器
- 添加深浅主题切换控制按钮 (`#theme-toggle`)。
- JavaScript 读取并设置 `document.documentElement.setAttribute('data-theme', theme)`，并在 `localStorage` 中记忆。

### 3.2 Dashboard 动态看板
- 5 个看板卡片采用玻璃拟态 (Glassmorphism)，暗黑模式下呈现暗夜透光效果。
- 进阶进度条 (`.progress-fill`) 改为高质感蓝绿双色渐变，并加上微脉冲动画。

### 3.3 筛选与搜索控件
- 状态快速筛选栏（All, Unlearned, Learning, Learned）重写为 Segmented Chips（分段胶囊按钮组）。
- 搜索框与下拉选择框控件统一样式。

### 3.4 视频列表沉浸式数据表格
- 表头采用粘性置顶 (`position: sticky; top: 0`) 且包含毛玻璃模糊效果。
- 视频状态单元格采用专属状态 Badge。
- “K线复盘”按钮升级为亮蓝色渐变操作按钮。

---

## 4. K 线复盘控制台重构设计 (`review_chart.css`, `review_chart.js`, `TiaBTC_K线复盘.html`)

### 4.1 全屏弹窗与复盘 Header (`.chart-shell`)
- 复盘顶栏 (`.chart-header`) 风格与主系统统一。
- 回放控制组 (`#replay-controls`) 的日期输入框、播放/暂停、下一根、倍速选择器重构为科技感控制组。
- 合约选择与 K 线周期按钮（5m/15m/1h/4h/1d/1w）重构为分段选择器（Segmented Toggle Button Group）。

### 4.2 OHLC 信息悬浮卡片 (`#chart-candle-data`)
- 放置于图表左上角，带有 `backdrop-filter: blur(8px)` 毛玻璃背景。
- 红绿涨跌数据清晰鲜明，不遮挡 K 线主体。

### 4.3 悬浮画图工具栏 (`.drawing-tools`)
- 重构为图表左侧的 Vertical Floating Dock，带有拖拽句柄。
- 当前选中的画图工具图标带有蓝色发光环指示。
- 划分三个清晰功能组：绘图工具组、撤销/重做组、锁定/删除/清空组。

### 4.4 TradingView Lightweight Charts 图表主题联动
- 在 `review_chart.js` 中监听主题切换，调用 `chart.applyOptions()` 动态更新图表背景色、网格线色和文字颜色。

---

## 5. 无破坏保障 (Zero-Logic-Break Guarantee)

- 保留所有的 HTML DOM 元素 ID（如 `#start-replay`, `#toggle-replay`, `#chart-interval`, `#drawing-input-layer` 等）。
- 不更改任何 API 接口路径及数据传输格式。
- 所有现有的后端存储（`study_server.py` & `tiabtc-review.sqlite`）继续正常工作。
