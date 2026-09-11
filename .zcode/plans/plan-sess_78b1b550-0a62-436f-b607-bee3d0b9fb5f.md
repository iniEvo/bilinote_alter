## 性能优化实施计划（前后端）

### 探查结论
数据规模：video_tasks 538 行、最大 batch 224 任务、json_results 88MB（1374 文件，平均 62KB）。SQLite 查询本身 0.5ms 不是瓶颈，真正的瓶颈：
- **后端每轮轮询 ~585 次磁盘 stat+open**（每任务读 status JSON），无缓存层
- **前端每 10s 轮询致全组件树重渲染**（NoteForm `useTaskStore()` 无选择器、多处订阅 `state.tasks` 全数组、`TaskHistoryCard` 未 memo、`reconcileBatchStatus` 每 batch 一次 set）
- **首页 bundle 巨大**（MarkdownViewer 拖 react-syntax-highlighter 全量 Prism 2-3MB，HomePage 未懒加载）
- **轮询风暴**：batch_status 已含每任务状态却仍逐个 task_status 轮询；hydrateHistory 首步非 light、与 NoteHistory 补拉重复

### 后端改动（4 项）
1. **B1 status 读取加 TTL 缓存**（`backend/app/routers/note.py`）：`_load_task_status` 加时间戳 LRU 缓存（2s），消除每轮 585 次 stat+open；`_update_status` 写入时清对应缓存
2. **B2 补索引**（`backend/app/db/init_db.py` + `models/video_tasks.py`）：幂等创建 `(video_id, platform)` 与 `(created_at)` 索引
3. **B3 启动恢复按 DB 非终态行扫描**（`backend/main.py:84-118`）：替代 glob 扫 790 个 status 文件
4. **B4 列表接口裁剪 request_payload**（`video_task_dao.py`）：with_entities 只取列表必需列

### 前端改动（7 项）
1. **F1 NoteForm 订阅收窄**（`NoteForm.tsx:215-227`）：`useTaskStore()` 无选择器 → 按字段订阅，消除最重组件轮询重渲染
2. **F2 MarkdownViewer 订阅修正**（`MarkdownViewer.tsx:328`）：避免 selector 每 store 更新调用，让 memo 生效
3. **F3 TaskHistoryCard 包 memo()**：父组件轮询重渲染时避免 20+ 卡片全量重渲
4. **F4 refreshHistoryList 合并多次 set 为一次**（`taskStore/index.ts:1112-1187`）：收集所有 batch 结果单次 set，buildBatchGroups 降为一次
5. **F5 useTaskPolling 收敛 task_status**（`useTaskPolling.ts`）：batch 内任务由 batch_status 覆盖，仅对无 batchId 的 pending 单任务保留轻量轮询
6. **F6 hydrateHistory 首步 light + 去重 __none__**（`taskStore/index.ts:983-1110`）+ NoteHistory 挂载补拉去重
7. **F7 首页 lazy 加载 + Prism 轻量化**（`App.tsx` + `MarkdownViewer.tsx`）：HomePage React.lazy，react-syntax-highlighter 改 prism-light 按需注册语言

### 验证
- 后端：起服务 curl 测 /history、/batch_status 响应时间；EXPLAIN QUERY PLAN 确认索引生效
- 前端：vitest run 全绿；tsc 无新增类型错误；dev 起服务验证列表滚动/点击流畅

### 风险
- B1 缓存须正确失效（写状态即清缓存），否则状态不更新
- F5 仅对 batch 内任务安全，非 batch 任务保留轮询
- B2 索引在 538 行数据下收益有限但零成本，为数据增长铺路
- F7 懒加载改动隔离可回退