# Phase 0 基线与契约快照

> 日期：2026-07-30  
> 状态：Phase 0 完成  
> 主仓库：`C:\Users\23888\Documents\private\tiabtc-learning-workspace`  
> 参考仓库：`C:\Users\23888\Documents\private\BitLanglangReview`

---

## 1. 仓库 Git 状态快照

### 1.1 主仓库 (`tiabtc-learning-workspace`)
- **HEAD Commit**: `be393129365e0e16931f6b4f92676838563249cc`
- **未提交文件 (Untracked / Modified)**:
  - `CONTEXT.md`
  - `agent.md`
  - `analyze_lunar_btc.py`
  - `dedupe_epub.ps1`
  - `docs/adr/0001-evolve-current-system-with-react-and-bybit.md`
  - `docs/superpowers/plans/2026-07-30-bitlanglang-integration-migration.md`
  - `lunar_btc_report.md`

### 1.2 参考仓库 (`BitLanglangReview`)
- **HEAD Commit**: `5785bb7ba7ef84969ae89fb0b8a0061de11bb98d`
- **参考来源模式**: 只读使用其当前 **Working Tree** 版本（含未提交修改），不限于 `origin/master`。
- **Working Tree 修改清单**:
  - `index.html`, `package.json`, `package-lock.json`
  - `src/domain/build-review-queue.ts`, `src/domain/review-queue.ts`
  - `src/server/app-plugin.ts`, `src/server/candlestick-service.ts`, `src/server/okx-instrument-service.ts`
  - `src/ui/App.tsx`, `src/ui/styles.css`, `tests/review-queue.test.ts`
  - `src/server/okx-fetch-json.ts`, `src/ui/DraggableDrawingToolbar.tsx`, `src/ui/useChartDrawingEngine.ts`

---

## 2. 数据库 Schema 与数据快照 (`tiabtc-review.sqlite`)

数据库只读核对结果：共 6 张表，数据完整无损。

### 2.1 表结构与行数

| 表名 | 当前行数 | 主键约束 | 备注 |
|---|---|---|---|
| `app_settings` | 2 | `key` | 包含 `offlineMode` 等配置 |
| `market_candles` | 117,633 | `(symbol, interval, timestamp)` | Bybit K线持久化缓存 |
| `market_cache_ranges` | 232 | `(symbol, interval, start_timestamp, end_timestamp)` | 缓存时间段索引 |
| `chart_drawings` | 3 | `id` | 画图记录（含索引 `idx_chart_drawings_scope`） |
| `custom_symbols` | 1 | `symbol` | 用户新增自定义 Symbol |
| `paper_trades` | 0 | `id` | 模拟交易记录 |

### 2.2 建表 DDL 快照

```sql
CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE market_candles (
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL NOT NULL,
    PRIMARY KEY (symbol, interval, timestamp)
);

CREATE TABLE market_cache_ranges (
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    start_timestamp INTEGER NOT NULL,
    end_timestamp INTEGER NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (symbol, interval, start_timestamp, end_timestamp)
);

CREATE TABLE chart_drawings (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    tool_type TEXT NOT NULL,
    tool_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_chart_drawings_scope ON chart_drawings (symbol);

CREATE TABLE custom_symbols (
    symbol TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    added_at TEXT NOT NULL
);

CREATE TABLE paper_trades (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    direction TEXT NOT NULL,
    entry_price REAL NOT NULL,
    tp_price REAL NOT NULL,
    sl_price REAL NOT NULL,
    rr_ratio REAL NOT NULL,
    status TEXT NOT NULL,
    pnl_r REAL DEFAULT 0,
    created_at TEXT NOT NULL,
    closed_at TEXT
);
```

---

## 3. API 契约清单 (`study_server.py`)

现有 Python 后端提供以下 13 个 REST 接口：

| 方法 | 路径 | 查询参数 / Body | 说明 & 响应类型 |
|---|---|---|---|
| `GET` | `/api/state` | 无 | 获取视频学习状态 `{"records": {videoId: stateObj}}` |
| `PUT` | `/api/state/{videoId}` | Body: `{status, updatedAt, notes, bookmarked}` | 更新/删除指定视频学习状态 |
| `GET` | `/api/symbols` | 无 | 获取全部 Symbol 列表 `{"symbols": ["BTCUSDT", ...]}` |
| `POST` | `/api/symbols` | Body: `{"symbol": "ETHUSDT"}` | 添加自定义 Symbol |
| `GET` | `/api/chart/config` | 无 | 获取系统配置 `{"offlineMode": false}` |
| `PUT` | `/api/chart/config` | Body: `{"offlineMode": true}` | 修改系统配置 `{"offlineMode": true}` |
| `GET` | `/api/chart/candles` | `symbol`, `interval`, `anchor` | 加载以 Anchor 为边界的历史 K 线组 |
| `GET` | `/api/chart/candles` | `symbol`, `interval`, `before`, `limit` | 加载早于 `before` 的历史 K 线 |
| `GET` | `/api/chart/candles` | `symbol`, `interval`, `after`, `limit`, `cutoff` | 加载晚于 `after` 且受限于 `cutoff` 的 K 线 |
| `GET` | `/api/chart/candles` | `symbol`, `interval`, `replayCursor`, `limit` | 加载用于 Replay 的 K 线段 |
| `GET` | `/api/chart/drawings` | `videoId`, `symbol`, `interval` | 获取画图记录 `{"drawings": [...]}` |
| `POST` | `/api/chart/drawings` | Body: `{id, videoId, symbol, interval, toolType, tool}` | 保存单条画图 |
| `PUT` | `/api/chart/drawings` | Body: `[{id, videoId, symbol, interval, toolType, tool}, ...]` | 批量替换/更新画图 |
| `DELETE` | `/api/chart/drawings` | `id`, `videoId`, `symbol`, `clearAll` | 删除指定画图或清空 Symbol 画图 |
| `GET` | `/api/paper-trades` | `symbol` | 获取模拟交易列表 `{"trades": [...]}` |
| `POST` | `/api/paper-trades` | Body: `{id, videoId, symbol, interval, direction, ...}` | 创建模拟交易记录 |
| `DELETE` | `/api/paper-trades` | `id` | 删除/清空模拟交易记录 |

---

## 4. Drawing 工具与 System Marker 矩阵

基于 `review_chart.js` 定义：

### 4.1 Legacy Line Tools (10 种)
- `TrendLine`（趋势线）
- `HorizontalLine`（水平线）
- `HorizontalRay`（水平射线）
- `VerticalLine`（垂直线）
- `FibRetracement`（斐波那契回调）
- `Ray`（射线）
- `ExtendedLine`（延长线）
- `Arrow`（箭头线）
- `Rectangle`（矩形框）
- `ParallelChannel`（平行通道）

### 4.2 Enhanced Tools (10 种)
- `ShortPosition` (`short-position`, 锚点数: 3)
- `LongPosition` (`long-position`, 锚点数: 3)
- `DatePriceRange` (`date-price-range`, 锚点数: 2)
- `Path` (`path`, 锚点数: 2+)
- `TextAnnotation` (`text-annotation`, 锚点数: 1)
- `FixedRangeVolumeProfile` (`fixed-range-volume-profile`, 锚点数: 2)
- `ArrowMarkUp` (`arrow-mark-up`, 锚点数: 1)
- `ArrowMarkDown` (`arrow-mark-down`, 锚点数: 1)
- `Brush` (`brush`, 锚点数: 2)
- `RotatedRectangle` (`rotated-rectangle`, 锚点数: 3)

### 4.3 System Marker
- `__system__:video-published`（视频发布时间线，**禁止**写入 `chart_drawings` 数据库）

---

## 5. 业务代码无修改确认

已验证：
- 零 `.py` 业务逻辑修改
- 零 `.js` 业务逻辑修改
- 零 SQLite 数据变更或结构修改
- 零包依赖变动 (package.json / requirements)
