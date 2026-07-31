# Phase 1 Review Packet

> 阶段：Phase 1（React 壳和 API Adapter）  
> 日期：2026-07-30  
> 状态：准备提交 Review  

---

## 1. 改动文件清单

- [NEW] `web/package.json`
- [NEW] `web/tsconfig.json`
- [NEW] `web/tsconfig.node.json`
- [NEW] `web/vite.config.ts`
- [NEW] `web/index.html`
- [NEW] `web/src/main.tsx`
- [NEW] `web/src/styles/tokens.css`
- [NEW] `web/src/styles/app.css`
- [NEW] `web/src/domain/review-context.ts`
- [NEW] `web/src/domain/candle.ts`
- [NEW] `web/src/domain/timeframe.ts`
- [NEW] `web/src/domain/drawing.ts`
- [NEW] `web/src/domain/paper-trade.ts`
- [NEW] `web/src/api/http.ts`
- [NEW] `web/src/api/market-api.ts`
- [NEW] `web/src/api/drawing-api.ts`
- [NEW] `web/src/api/paper-trade-api.ts`
- [NEW] `web/src/api/video-api.ts`
- [NEW] `web/src/app/ErrorBoundary.tsx`
- [NEW] `web/src/app/AppShell.tsx`
- [NEW] `web/src/app/App.tsx`
- [NEW] `docs/superpowers/baselines/2026-07-30-phase1-review-packet.md`

## 2. 每个文件的职责

- `web/package.json`: 定义前端工程最小依赖（仅包含 React, Vite, TS, Lightweight-Charts, Lucide-React）。
- `web/vite.config.ts`: Vite 配置文件，配置 `/api` 代理到本地 Python 后端 (`http://127.0.0.1:8765`)。
- `web/src/domain/*`: 强类型领域模型（包含 `ReviewContext` 辨识联合、毫秒级 `Candlestick` 实体、`ReviewTimeframe` 等）。
- `web/src/api/*`: 封装式 API 适配器（实现与 Python 后端数据转换、snake_case/camelCase 隐蔽转换、参数校验）。
- `web/src/app/*`: 包含 `ErrorBoundary` 与 `AppShell` 交易终端 UI 框架，在页面加载时拉取后端 `symbols` 与 `config` 展现连接状态。

## 3. 核心逻辑说明

Phase 1 成功搭建了独立 React 开发壳 `web/`：
- 不依赖参考后端的 Vite 插件，也不在 Vite 中内嵌后端服务。
- 封装全部 API 请求到 `web/src/api/` 目录，防止组件直接调用 `fetch('/api/...')`。
- 统一固定时间单位：领域层全量采用 Unix 毫秒 `timestampMs`。

## 4. API 契约变化

**无**。适配现有 `study_server.py` 所有 13 个接口，无增删改。

## 5. 数据库变化

**无**。Python 后端与 SQLite 数据库零改动。

## 6. Bybit 数据流说明

- Market Data 保持 Bybit 格式。所有 Symbol 在前端均为 `BTCUSDT` 格式，不存在 OKX URL 或 OKX 字符串。

## 7. 已知风险

- 无。Vite 开发服务采用 3000 端口并代理 8765 端口 API，旧 `TiaBTC_学习视频清单.html` 依然完好可用。

## 8. 人工回归与验证说明

- 运行 `npx tsc --noEmit` 通过（0 错误）。
- 在 `web/` 中无违禁依赖（`better-sqlite3`, `xlsx`, `undici`, `okx`）。
- 可并行启动 `python study_server.py` 与 `npm run dev` 验证 AppShell 显示绿灯连通状态。

## 9. 是否新增依赖

- 新增依赖全量局限于 `web/node_modules` 中，未修改根项目环境。

## 10. 执行与验证状态

- 编译与类型检查已执行并全部通过。

## 11. git diff --stat 变化

```text
 web/package.json                 | 24 ++++++++++++++++++++++++
 web/tsconfig.json                | 24 ++++++++++++++++++++++++
 web/tsconfig.node.json           |  9 +++++++++
 web/vite.config.ts               | 19 +++++++++++++++++++
 web/index.html                   | 13 +++++++++++++
 web/src/domain/*                 | (5 files created)
 web/src/api/*                    | (5 files created)
 web/src/app/*                    | (3 files created)
 web/src/styles/*                 | (2 files created)
 22 files changed
```
