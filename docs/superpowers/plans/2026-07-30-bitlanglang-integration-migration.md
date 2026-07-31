# BitLanglangReview 融入 TiaBTC 项目迁移实施方案

> 日期：2026-07-30
> 状态：待实施
> 主仓库：`C:\Users\23888\Documents\private\tiabtc-learning-workspace`
> 参考仓库：`C:\Users\23888\Documents\private\BitLanglangReview`

## 1. 目标

在不丢失当前项目视频学习、Bybit 行情、SQLite 缓存、画图记录和模拟交易数据的前提下，将前端逐步重构为 React + TypeScript，并吸收 `BitLanglangReview` 中较成熟的自由回放、图表视口、筛选、复盘队列和模拟交易领域逻辑。

最终形成一个统一的 Review Workspace，并按 Review Mode 区分：

1. Video Review：从学习视频进入，以视频发布时间为 Review Anchor。
2. Free Replay：用户选择 Symbol 和时间，逐根揭示未来 Candlestick。
3. Trade Review：可选能力，从只读交割单导入的 Imported Trade 进入。

本方案的核心不是合并两个页面，而是统一领域模型、图表工作区和数据边界。

## 2. 强制约束

实施 AI 必须遵守以下约束。

### 2.1 数据源约束

- Market Data Source 只能是 Bybit。
- 禁止引入任何 OKX URL、OKX Symbol、OKX 时间边界或 `BTC-USDT-SWAP` 格式。
- 前后端统一使用 Bybit Symbol，例如 `BTCUSDT`。
- Review Timeframe 的服务端值保持为 `5`、`15`、`60`、`240`、`D`、`W`。
- UI 可以显示 `5m`、`15m`、`1h`、`4h`、`1d`、`1w`，但转换只能发生在 API adapter。

### 2.2 数据安全约束

- 不删除、重建或替换 `tiabtc-review.sqlite`。
- 不删除 `learning-state.json`。
- 不丢弃现有 `market_candles`、`market_cache_ranges`、`chart_drawings`、`paper_trades` 数据。
- 数据库迁移只能采用新增表、增加 nullable 列、增加索引或数据复制校验。
- 禁止使用 `DROP TABLE` 作为常规 schema 兼容方式。
- 任何真实数据库迁移执行前必须先取得用户确认；实施阶段可提交迁移草稿和兼容代码。
- Source Workbook 如果引入，必须只读，不能回写复盘标签或笔记。

### 2.3 工程约束

- 当前仓库是主仓库，参考仓库只读。
- 不复制参考仓库的 `.git`、`.trellis`、`.agents`、`.codex`、`node_modules`、lockfile、SQLite、xlsx。
- 不直接复制参考仓库的 `src/server/app-plugin.ts`。
- 不把 `better-sqlite3`、`xlsx` 作为第一阶段前端依赖。
- 不改变现有 API 路径、请求参数和响应结构，除非进入单独的 API 版本迁移阶段。
- 不在一个提交中同时进行前端迁移、Python 后端拆分和数据库变更。
- 未经用户允许，不新增测试类，不执行编译、打包或部署。
- 不覆盖当前仓库未跟踪或未确认的用户文件。

## 3. 当前基线

### 3.1 当前项目资产

- `study_server.py`：HTTP、API、Bybit、SQLite、静态文件服务。
- `review_chart.js`：K 线、回放、画图、持久化、模拟交易。
- `generate_tiabtc_html.py`：将 CSV 数据内嵌生成视频学习页面。
- `TiaBTC_学习视频清单.html`：视频学习工作台。
- `TiaBTC_K线复盘.html`：复盘工作台。
- `tiabtc-review.sqlite` 当前包含：
  - `market_candles`：约 117633 行。
  - `market_cache_ranges`：232 行。
  - `chart_drawings`：3 行。
  - `paper_trades`：0 行。
- `learning-state.json`：视频学习状态。

这些都是迁移兼容基线，不是需要清理的遗留垃圾。

### 3.2 参考项目可吸收部分

优先参考、按当前项目语义改写：

- `src/ui/chart-time.ts`
- `src/ui/chart-viewport.ts`
- `src/ui/chart-navigation-anchor.ts`
- `src/ui/chart-autoload.ts`
- `src/ui/free-replay-chart.ts`
- `src/ui/free-replay-paper-trading.ts`
- `src/ui/candlestick-readout.ts`
- `src/ui/chart-price.ts`
- `src/ui/trade-markers.ts`
- `src/domain/build-review-queue.ts`
- `src/domain/review-queue.ts`
- `src/ui/ReviewEditor.tsx`
- `src/ui/DraggableDrawingToolbar.tsx`

只能参考思想、不能直接复制：

- `src/ui/App.tsx`：文件过大，应拆分。
- `src/ui/useChartDrawingEngine.ts`：增强画图没有完整接入服务端持久化。
- `src/server/candlestick-service.ts`：包含 OKX 请求及 OKX 时间边界。
- `src/server/okx-instrument-service.ts`
- `src/server/okx-fetch-json.ts`
- `src/server/app-plugin.ts`：API 依赖 Vite 开发服务生命周期。
- `src/server/candlestick-store.ts`：会形成第二套平行行情缓存。
- `src/server/drawing-store.ts`：只覆盖少量 drawing kind，无法承载当前丰富 tool JSON。

## 4. 目标架构

建议新增 `web/` 作为 React 前端根目录，避免迁移期污染现有 Python 根目录。

```text
tiabtc-learning-workspace/
├── web/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── app/
│       │   ├── App.tsx
│       │   ├── routes.ts
│       │   └── AppShell.tsx
│       ├── api/
│       │   ├── http.ts
│       │   ├── video-api.ts
│       │   ├── market-api.ts
│       │   ├── drawing-api.ts
│       │   └── paper-trade-api.ts
│       ├── domain/
│       │   ├── review-context.ts
│       │   ├── candle.ts
│       │   ├── timeframe.ts
│       │   ├── drawing.ts
│       │   └── paper-trade.ts
│       ├── features/
│       │   ├── learning/
│       │   ├── review-workspace/
│       │   ├── replay/
│       │   ├── drawings/
│       │   ├── paper-trading/
│       │   └── trade-review/
│       ├── chart/
│       │   ├── ChartCanvas.tsx
│       │   ├── chart-time.ts
│       │   ├── chart-viewport.ts
│       │   ├── chart-autoload.ts
│       │   └── chart-navigation-anchor.ts
│       └── styles/
│           ├── tokens.css
│           └── app.css
├── server/
│   ├── app.py
│   ├── routes/
│   ├── services/
│   │   └── market_data/
│   │       └── bybit.py
│   └── repositories/
├── study_server.py
├── review_chart.js
└── legacy html files
```

`server/` 目录不是第一阶段创建目标。先完成前端兼容迁移，再拆 Python；拆分期间 `study_server.py` 保留兼容启动入口。

## 5. 领域模型和类型契约

### 5.1 Review Context

前端必须使用 discriminated union，禁止使用大量布尔值组合模式。

```ts
type VideoReviewContext = {
  mode: 'video';
  videoId: string;
  title: string;
  symbol: BybitSymbol;
  anchorTimeMs: number;
};

type FreeReplayContext = {
  mode: 'free';
  symbol: BybitSymbol;
  anchorTimeMs: number;
};

type TradeReviewContext = {
  mode: 'trade';
  tradeId: string;
  symbol: BybitSymbol;
  anchorTimeMs: number;
  entryTimeMs: number;
  exitTimeMs: number;
};

type ReviewContext =
  | VideoReviewContext
  | FreeReplayContext
  | TradeReviewContext;
```

### 5.2 Candlestick

领域层时间单位必须固定为毫秒。

```ts
type Candlestick = {
  symbol: string;
  interval: ReviewTimeframe;
  timestampMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
```

只有 Lightweight Charts adapter 可以把 `timestampMs` 转为秒。禁止在组件内部反复出现 `/ 1000`、`* 1000`。

### 5.3 Timeframe

```ts
type ReviewTimeframe = '5' | '15' | '60' | '240' | 'D' | 'W';

const timeframeDisplay = {
  '5': '5m',
  '15': '15m',
  '60': '1h',
  '240': '4h',
  D: '1d',
  W: '1w',
};
```

禁止把参考项目的 `1H`、`4H`、`1D` 直接传给 Python API。

### 5.4 Drawing

现有 drawing wire contract 为主：

```ts
type PersistedDrawing = {
  id: string;
  videoId: string;
  symbol: string;
  interval: ReviewTimeframe;
  toolType: string;
  tool: unknown;
  createdAt?: string;
  updatedAt?: string;
};
```

要求：

- React drawing engine 必须支持加载服务端已有 `tool_json`。
- 用户创建、移动、锁定、删除、撤销后，服务端状态必须与画布一致。
- Drawing 的业务作用域按 Symbol 共享，不能因为切换 Review Mode 丢失。
- Timeframe 只记录创建上下文；绘制时间点在展示时映射到当前 timeframe。
- System Marker 不得写入 Chart Drawing 表。

### 5.5 Paper Trade

第一轮迁移保持当前表和 API 语义，不直接引入参考项目临时 session 的全部字段。

```ts
type PaperTrade = {
  id: string;
  contextId: string;
  symbol: string;
  interval: ReviewTimeframe;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  riskRewardRatio: number;
  status: 'OPEN' | 'CLOSED';
  pnlR: number;
  createdAt: string;
  closedAt: string | null;
};
```

市价单、限价单、账户权益、订单成交生命周期属于 Paper Trading V2，必须单独设计 schema，不得把临时页面状态假装成已持久化能力。

## 6. API 兼容策略

第一轮 React 前端必须通过 adapter 使用现有 API。

| 能力 | 现有 API | 第一轮处理 |
|---|---|---|
| 学习状态 | `GET /api/state` | 保留 |
| 更新学习状态 | `POST /api/state/{videoId}` | 保留 |
| Symbol 列表 | `GET /api/symbols` | 保留 |
| 新增 Symbol | `POST /api/symbols` | 保留 |
| 配置 | `GET/POST /api/chart/config` | 保留 |
| 初始 K 线 | `GET /api/chart/candles?symbol&interval&anchor` | 保留 |
| 更早 K 线 | `GET /api/chart/candles?symbol&interval&before&limit` | 保留 |
| 后续 K 线 | `GET /api/chart/candles?symbol&interval&after&limit&cutoff` | 保留 |
| 回放 K 线 | `GET /api/chart/candles?symbol&interval&replayCursor&limit` | 保留 |
| 画图 | `/api/chart/drawings` | 保留 |
| 模拟交易 | `/api/paper-trades` | 保留 |

API adapter 负责：

- snake_case 与 camelCase 转换。
- Bybit interval 与 UI label 转换。
- 毫秒与 Lightweight Charts 秒转换。
- HTTP 非 2xx 统一抛出领域错误。
- AbortController 和过期请求防护。

组件不得直接拼接这些 API URL。

### 6.1 视频列表 API

当前视频数据被内嵌进生成后的大 HTML。React 迁移时有两种步骤：

第一阶段：

- 生成一个只读 `public/videos.json`，由现有 CSV 构建脚本生成。
- 保留 CSV 为视频元数据源。
- 不在 React bundle 中硬编码视频数据。

第二阶段：

- 可增加 `GET /api/videos`，服务端读取 CSV 并提供查询。
- API 引入必须单独提交，不能与 React 初始迁移混在一起。

## 7. 核心行为规格

### 7.1 Video Review

- 从 Learning Video 打开。
- Review Anchor 为视频发布时间转换后的绝对时间。
- 初始展示 Anchor 之前的历史 Candlestick。
- Anchor 之后的 Candlestick 默认隐藏。
- 用户逐根、自动播放或倍速播放时才推进 Replay Cursor。
- 视频发布时间为 System Marker，不写入 `chart_drawings`。
- 切换 timeframe 后，Replay Progress 不后退；Cursor 映射到包含该进度时间的 Candlestick。

### 7.2 Free Replay

- 用户选择 Symbol、日期和分钟。
- 开始前不请求未来全部数据用于渲染。
- 可为了顺畅播放预取未来数据，但预取数据不能进入可见 series。
- 下一根只揭示一根 Candlestick。
- 上一根只隐藏最后揭示的一根，不能早于起点。
- 播放过程中切换倍速只影响定时器，不改变进度。
- 用户拖拽和缩放后的可见范围由用户控制；揭示下一根不能强制跳回末尾。
- 页面刷新后不要求恢复 Replay Progress。

### 7.3 On-demand Loading

- 接近已加载左边界时加载 earlier。
- 普通历史浏览允许加载 later。
- replay 模式下 later 请求结果只能进入预取缓存，不能越过 Replay Cursor 渲染。
- 同一 Symbol + timeframe + direction 同时只能有一个有效请求。
- 后返回的旧请求不得覆盖新上下文数据。
- 应保存并恢复 Chart Navigation Anchor，避免加载后图表跳动。

### 7.4 Drawing

- 切换视频、自由回放或交易复盘时，同 Symbol Drawing 可见。
- 切换 timeframe 时 Drawing 价格保持，时间归属到当前 timeframe 的包含 Candlestick。
- 切换 Symbol 时不得显示上一 Symbol Drawing。
- 删除和清空必须只影响当前 Symbol。
- 画图保存失败时 UI 明确提示，不能静默假装成功。
- React 卸载图表时必须解除 drawing manager 和事件订阅。

### 7.5 Paper Trading

- 第一轮保持当前做多/做空仓位工具生成 entry/tp/sl。
- 保存后刷新页面仍可读取记录。
- 统计只基于服务端持久化记录。
- 删除单条和清空所有属于破坏性 UI 操作，必须保留确认。
- Trade Review 的 Imported Trade 与 Paper Trade 必须使用不同类型、不同 API。

### 7.6 Learning

- 列表搜索、状态筛选、年份筛选、书签和备注行为不得回归。
- 更新状态后重新加载页面仍一致。
- 从列表打开 Video Review 时，视频 ID、标题和发布时间必须完整传递。
- React 页面迁移完成前，旧生成页面继续可用。

## 8. 分阶段实施

每个阶段独立提交、独立 Review。上一阶段 Review 通过后再开始下一阶段。

### Phase 0：冻结基线和记录兼容契约

目标：避免参考仓库未提交改动和当前未跟踪文件导致来源不清。

实施内容：

1. 记录两个仓库的 commit SHA 和 `git status --short`。
2. 明确参考来源是其当前 working tree，而不是只使用 `origin/master`。
3. 列出当前项目所有 API 请求和响应样例，敏感信息脱敏。
4. 只读记录 SQLite 表、列、索引和行数。
5. 列出 `review_chart.js` 使用的所有 drawing tool type。
6. 不修改业务代码。

交付：

- 基线说明。
- API contract 清单。
- 数据库 schema 快照。
- 参考代码来源清单。

验收：

- 没有业务文件改动。
- 明确哪些参考文件取 committed 版本，哪些取 working tree 版本。

### Phase 1：React 壳和 API Adapter

目标：建立不依赖参考后端的 React 开发入口。

实施内容：

1. 创建 `web/`。
2. 引入最小依赖：
   - `react`
   - `react-dom`
   - `typescript`
   - `vite`
   - `@vitejs/plugin-react`
   - `lightweight-charts`
   - `lucide-react`
3. 不引入 `better-sqlite3`、`xlsx`、`undici`。
4. Vite dev server 通过 proxy 访问 `http://127.0.0.1:8765/api`。
5. 创建 API adapter 和领域类型。
6. 创建 AppShell、错误边界、加载状态和主题 token。
7. 提供 `/new/` 或独立 Vite 地址，不替换旧 `/`。

验收：

- 页面壳可独立打开。
- API adapter 不出现 OKX。
- UI 组件中不直接 `fetch('/api/...')`。
- 未改 Python 和 SQLite。

Review 重点：

- 依赖是否最小。
- 时间单位是否统一。
- 是否把参考 App.tsx 整体搬入。
- 是否创建了第二套后端。

### Phase 2：统一 Chart Workspace 和 Bybit Candlestick

目标：在 React 中完成只读 K 线展示和稳定导航。

实施内容：

1. 创建 `ChartCanvas`，负责 chart/series 生命周期。
2. 将 reference 中纯函数按 Bybit timeframe 改写：
   - chart time
   - viewport
   - navigation anchor
   - autoload decision
   - candlestick readout
3. 通过现有 `/api/chart/candles` 加载初始、earlier、later。
4. 加入请求取消、context key 和 stale response 防护。
5. 实现 Symbol、timeframe 切换。
6. 实现 OHLC readout、主题、log price scale。

验收：

- BTCUSDT 六个现有 timeframe 均能正确显示。
- 切换 Symbol 不串数据。
- 加载更早 K 线时视口不跳。
- 重复加载不产生重复 Candlestick。
- Offline Mode 缺缓存时显示当前服务端 warning。

禁止：

- 新建 `candles` 表。
- 使用 OKX 时间边界补丁。
- 把图表 seconds 当作 API milliseconds。

### Phase 3：Free Replay

目标：迁移自由回放并统一 replay 状态机。

建议 reducer 状态：

```ts
type ReplayState =
  | { status: 'idle' }
  | {
      status: 'ready' | 'playing' | 'paused' | 'completed';
      context: VideoReviewContext | FreeReplayContext;
      startTimeMs: number;
      progressTimeMs: number;
      cursorTimeMs: number;
      speed: number;
    };
```

实施内容：

1. 改写 reference `free-replay-chart.ts` 为毫秒领域模型。
2. 实现开始、下一根、上一根、播放、暂停、倍速。
3. 实现 timeframe 切换后的 cursor 映射。
4. 实现未来预取与可见数据隔离。
5. 实现键盘左右方向键，但输入控件聚焦时不响应。
6. 保留用户 viewport，不自动追踪最新蜡烛。

验收：

- 任何时候都不能看到 Replay Cursor 之后的数据。
- rewind 不早于起点。
- timeframe 切换不泄露未来。
- 快速切换 Symbol/时间不会混入旧请求。
- 暂停后定时器完全停止，组件卸载后无残留定时器。

### Phase 4：Chart Drawing

目标：迁移当前丰富画图能力且不损坏持久化。

实施内容：

1. 迁移工具栏外观和交互，但不直接采用 reference 的无持久化 hook。
2. 创建 Drawing Engine adapter：
   - legacy line tools
   - enhanced drawing manager
   - server serialization
3. 加载现有 3 条 Drawing 进行兼容验证。
4. 处理 create/update/delete/replace。
5. 实现撤销、重做、锁定、磁吸、清空。
6. 处理组件卸载和 Symbol 切换。

验收：

- 现有 Drawing 可显示、选择、移动、保存。
- 刷新后状态一致。
- 所有当前 `VALID_DRAWING_TYPES` 要么支持，要么在兼容矩阵中明确标记“只读显示/暂不创建”，不得静默丢弃。
- 切换 timeframe 和 mode 不丢 Drawing。
- 清空只清当前 Symbol。

Review 必须提供：

- Drawing type 兼容矩阵。
- 每种 engine 的序列化样例。
- 保存失败行为说明。

### Phase 5：Learning Workspace

目标：用 React 替代大体积内嵌视频清单 HTML。

实施内容：

1. 从 CSV 生成 `videos.json`，保持 CSV 为元数据源。
2. 迁移统计卡、搜索、状态筛选、年份筛选、书签和备注。
3. 继续使用现有 learning state API。
4. 从视频列表打开统一 Review Workspace 的 Video Review。
5. 旧页面保持入口，直至人工回归通过。

验收：

- 视频数量及关键字段与 CSV 一致。
- 三种学习状态读写一致。
- 搜索和筛选组合结果一致。
- 视频发布时间时区转换一致。
- 旧链接仍能打开。

### Phase 6：Video Review 和 System Marker

目标：用统一 replay state machine 替换旧视频专用回放分支。

实施内容：

1. 用 VideoReviewContext 启动 Review Workspace。
2. Anchor 来自视频发布时间。
3. 显示视频 System Marker。
4. 复用 Free Replay 的 reveal/rewind/play/speed。
5. Video ID 只用于学习上下文，不再决定用户 Drawing 的可见性。

验收：

- 从任意视频进入均定位正确。
- 初始不泄露视频发布时间之后的 K 线。
- 同 Symbol Drawing 在不同视频之间共享。
- 关闭 Review Workspace 返回列表后状态不丢。

### Phase 7：Paper Trading V1 迁移

目标：保持当前模拟交易能力和持久化。

实施内容：

1. 迁移 long/short position drawing 到 Paper Trade 表单。
2. 继续使用现有 `/api/paper-trades`。
3. 迁移账本、统计、删除和清空确认。
4. 明确 Paper Trade 使用实际 Candlestick 触发还是用户手动结单，保持当前语义。

验收：

- 创建、读取、平仓、删除、统计与旧页面一致。
- 刷新后记录存在。
- 不把 reference 内存 PaperTradingSession 宣称为持久化记录。

### Phase 8：Python 内部模块化

目标：降低 `study_server.py` 职责，但不改变外部契约。

建议拆分顺序：

1. repositories：SQLite 查询和写入。
2. market service：Bybit fetch、pagination、range cache。
3. drawing service：validation、serialization。
4. paper trade service。
5. route handlers。
6. `study_server.py` 保留配置、组合和启动入口。

验收：

- API 路径及 JSON 不变。
- SQLite 表不变。
- Bybit 请求参数不变。
- DATABASE_LOCK 保护语义不变。
- 没有循环 import。

禁止：

- 在拆分同时“顺便”重命名 API。
- 在拆分同时迁移数据库。
- 用 Node/Vite 后端替换 Python。

### Phase 9：Trade Review（可选）

只有用户明确需要交割单复盘时实施。

实施内容：

1. 明确 workbook schema 和只读 sheet。
2. 将 Imported Trade 转成 Bybit Symbol。
3. 生成稳定 Trade ID，禁止使用 Excel 行号。
4. 增加独立 `trade_reviews` 表保存 tags/note/starred。
5. 增加 Review Queue 筛选和排序。
6. 在统一 Review Workspace 中显示 entry/exit System Marker。

不做：

- 不修改 Source Workbook。
- 不把 Imported Trade 写入 `paper_trades`。
- 不因为 workbook 中使用 OKX symbol 就切换 Market Data Source。

## 9. 数据库迁移策略

### 9.1 第一阶段

零 schema 变更。继续使用现有表。

### 9.2 后续迁移规范

如果需要 schema 变化：

1. 新增 `schema_migrations` 表。
2. 每个 migration 有唯一版本和名称。
3. migration 在事务内执行。
4. 执行前校验列和索引是否存在，保证幂等。
5. migration 不删除旧列和旧表。
6. 应用启动时如果 migration 失败，停止写入并显示错误。
7. 提供只读核对 SQL：
   - migration 前后行数。
   - 非空字段计数。
   - 主键重复检查。
   - Drawing JSON 可解析计数。
8. 正式运行 migration 前复制 SQLite 文件作为备份；备份动作需用户确认。

特别风险：

当前 `initialize_database()` 在 drawing schema 不匹配时会 `DROP TABLE chart_drawings`。后端模块化阶段必须把这一逻辑替换为非破坏性 migration，但不能未经确认对真实数据库执行。

## 10. 时间和行情边界规范

- API 和领域层使用 Unix milliseconds。
- Lightweight Charts 使用 Unix seconds。
- 视频 CSV 包含带 offset 的发布时间，解析后立即转换为绝对时间。
- UI 日期时间输入按用户本地时区解释，再转换为绝对时间。
- Bybit 日线和周线边界以 Bybit 返回 timestamp 为准，不复制 OKX 的 UTC+8 修正。
- Candlestick 是否可见由 `timestamp + intervalDuration <= replayProgress` 判断；D/W 必须使用明确的 timeframe 策略，不能把所有月度周期粗略按 30 天处理。
- 排序和去重 key 为 `symbol + interval + timestamp`。

必须人工验证的边界：

- 北京时间午夜附近的视频。
- 跨日、跨周 timeframe 切换。
- 夏令时 offset 的视频发布时间。
- Replay 起点不是周期整点。
- 当前尚未收盘的最新 Candlestick。

## 11. 样式和 UX 策略

- 保留当前 Design Tokens 和暗色交易终端风格。
- 可吸收 reference 的侧边栏、筛选区、Free Replay 面板和工具栏布局。
- 不复制 reference 全量 CSS 后覆盖当前样式。
- tokens、layout、feature styles 分层。
- 迁移时保留关键 DOM 行为，不要求保留旧 DOM ID。
- 移动端/窄屏先保证功能可用，不在迁移阶段做无关视觉重构。
- 所有 destructive action 必须二次确认。
- loading、empty、offline warning、Bybit error 必须有不同状态。

## 12. 提交与 Review 协议

另一个 AI 每完成一个 Phase，必须停止并提交 Review Packet，不继续跨阶段扩散修改。

Review Packet 必须包含：

1. 改动文件清单。
2. 每个文件的职责。
3. 核心逻辑说明。
4. API 契约变化；没有变化也要明确写“无”。
5. 数据库变化；没有变化也要明确写“无”。
6. Bybit 数据流说明。
7. 已知风险。
8. 人工回归建议。
9. 是否新增依赖。
10. 是否执行过测试、编译、启动；未经用户允许应为“未执行”。
11. `git diff --stat`。
12. 未确认用户改动是否与本阶段文件重叠。

建议一个 Phase 一个 commit。不要把格式化、依赖升级、无关 UI 改动混入功能 commit。

## 13. Codex Review 清单

后续 Review 按以下优先级检查。

### P0：数据安全

- 是否存在 DROP/DELETE/覆盖真实数据。
- 是否创建第二套行情数据库。
- 是否丢失 Drawing 或 learning state。
- 是否错误执行 migration。

### P1：行情正确性

- 是否仍然只使用 Bybit。
- Symbol 和 timeframe 是否正确转换。
- 时间单位是否混乱。
- replay 是否泄露未来。
- stale response 是否污染当前图表。
- 日线/周线边界是否正确。

### P1：持久化正确性

- Drawing create/update/delete 是否闭环。
- Paper Trade 是否刷新后存在。
- Offline Mode 是否真的阻止网络请求。
- API 失败是否有 UI 反馈。

### P2：架构边界

- App 是否重新膨胀成单文件。
- 组件是否直接 fetch。
- domain 是否依赖 React、DOM 或 API wire shape。
- chart lifecycle 和事件监听是否释放。
- Python 拆分是否保持 API 兼容。

### P2：回归

- 视频学习状态。
- 视频筛选和跳转。
- Symbol/timeframe 切换。
- 画图工具兼容矩阵。
- 回放步进、回退、播放、暂停、倍速。
- 账本统计。

## 14. 第一轮明确不做

- 不切换到 OKX。
- 不重写整个 Python 后端。
- 不迁移到 Electron。
- 不做账号、云同步和多人协作。
- 不引入新的状态管理框架，先使用 React state/reducer。
- 不引入 ORM。
- 不导入交割单，除非用户确认需要 Trade Review。
- 不做 Paper Trading V2 数据库。
- 不删除旧 HTML/JS。
- 不重建现有 SQLite。

## 15. 建议给实施 AI 的启动指令

```text
请先阅读：
1. AGENTS.md / 用户提供的仓库约束
2. CONTEXT.md
3. docs/adr/0001-evolve-current-system-with-react-and-bybit.md
4. docs/superpowers/plans/2026-07-30-bitlanglang-integration-migration.md

只实施 Phase 0，不要提前进入 Phase 1。
当前仓库是主仓库，BitLanglangReview 只读。
不得复制 OKX 服务、Vite API plugin、SQLite、xlsx、node_modules 或 lockfile。
不得修改业务代码、执行编译或新增测试。
完成后按“提交与 Review 协议”输出 Review Packet，并停止等待 Review。
```

## 16. 最终完成定义

只有同时满足以下条件，才能认为迁移完成：

- React 页面覆盖 Learning、Video Review、Free Replay、Drawing、Paper Trading V1。
- 市场数据全部来自 Bybit。
- 现有 SQLite 数据未丢失。
- 旧页面在迁移验收前一直可用。
- replay 不泄露未来数据。
- chart navigation 在按需加载后不跳动。
- Drawing 跨 mode/timeframe 正确持久化。
- 学习状态和 Paper Trade 刷新后仍存在。
- Python API 在迁移阶段保持兼容。
- 每个 Phase 都有独立 Review Packet 和人工回归结论。
