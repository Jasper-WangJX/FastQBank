# MVP 实现路线 v1

> 配套文档：`Proposal_CN.md`（功能与技术栈基线）。
> 对应英文版：`Roadmap_EN.md`。

本文档按"端到端最小可用切片"的思路，把 MVP 拆成 11 个阶段。每个阶段都是一条能跑通的链路，结束时都有可演示的产物。

---

## 核心原则

1. **纵切片优先**：每阶段都是端到端能跑通的功能，不要先把所有后端写完再写前端
2. **风险大的提前验证**：OCR 与 AI 接入各做一个 30 分钟 spike，确认可行再纳入主线
3. **Web 先于 Electron**：所有 UI 先在浏览器里调好，Electron 只是个壳
4. **尽早上线最小生产环境**（域名 + HTTPS + DB），避免最后阶段集中爆雷

---

## 阶段总览

| 阶段 | 状态 | 目标产物 | 大致工作量\* |
|---|---|---|---|
| 0 脚手架 | ✅ 已完成 (2026-05-16) | 仓库结构、本地能起前后端 + DB | 1-2 天 |
| 1 数据底座 + 认证 | ✅ 已完成 (2026-05-16) | 注册登录、JWT、表迁移 | 2-3 天 |
| 2 题目 / 标签 CRUD（手动录入） | ⬜ 待办 | Web 端能手动建标签、录题、查看列表、LaTeX 渲染 | 4-6 天 |
| 3 云端同步 + 软删除 + 部署小环境 | ⬜ 待办 | 部署到 VPS、域名可访问、多端拉取一致 | 2-3 天 |
| 4 Electron 壳 | ⬜ 待办 | 桌面端能跑，复用 web 构建 + 托盘图标 | 2-3 天 |
| 5 OCR 录题链路 | ⬜ 待办 | 框选截屏 → OCR → 拆分 → 确认页入库 | 5-7 天 |
| 6 AI 接入 | ⬜ 待办 | 标签推荐 + 知识点摘要 + 限流 | 3-4 天 |
| 7 Flashcards 复习 + 错题集 | ⬜ 待办 | 卡片式过题、显隐答案、乱序、错题自动归集 | 3-4 天 |
| 8 AI 出题 | ⬜ 待办 | 种子选择 → 预览页 → 入库 + 三种过题模式 | 3-4 天 |
| 9 JSON 导入导出 | ⬜ 待办 | 导出全量、导入按 UUID 跳过重复 | 1-2 天 |
| 10 打磨 + Windows 安装包 | ⬜ 待办 | electron-builder 打包、产品化收尾 | 2-3 天 |

\*工作量按"专注全职"估算，且假设对该层框架已上手；不熟悉的层（如第一次用 FastAPI/Electron）翻倍是正常的。

---

## 阶段 0 — 项目脚手架

> **状态：✅ 已完成 (2026-05-16)。** 采用"简单子目录"monorepo（`apps/web`、`apps/server`；`packages/` 预留）。前端 Vite + React 19 + TS + Tailwind 4，后端 FastAPI，Postgres 16（docker-compose），`/health` 探针端到端打通。

### 任务
- 建 monorepo（pnpm workspaces 或简单 git 仓库三个子目录）：`apps/web`、`apps/server`、`packages/shared`
- `apps/web`：Vite + React + TypeScript + Tailwind（或 shadcn/ui）
- `apps/server`：FastAPI + uvicorn + pydantic + SQLAlchemy + Alembic
- `docker-compose.yml`：本地起 Postgres
- 写一个 `/health` 接口，前端首页调通

### 退出标准
本地 `pnpm dev` + `uvicorn` + `docker compose up postgres` 全部能启，前端首页能从后端拿到健康状态。

---

## 阶段 1 — 数据底座 + 认证

> **状态：✅ 已完成 (2026-05-16)。** 退出标准已端到端验证（注册 → 刷新仍登录 → 受鉴权 `/me` 返回邮箱），基于真实 Postgres + 浏览器走查。

#### 实际实现说明（与原计划的差异）
- **后端技术栈**：异步 SQLAlchemy + asyncpg；依赖钉在 `apps/server/requirements.txt`（未引入 pyproject / pnpm workspace —— `packages/shared` 推迟到阶段 4）。
- **Schema**：单个手写 Alembic 基线迁移（`0001_initial_schema`）建全部 6 表 —— UUID 主键（`gen_random_uuid()`）、JSONB 的 `options`/`correct`、`ARRAY(UUID)`、`type`/`source` 的 CHECK 约束、`question_tags` 复合主键。异步 Alembic 环境（`alembic init -t async`），DB URL 从 `.env` 注入（不落进 `alembic.ini`）。
- **认证**：直接用 `bcrypt`（弃 passlib）+ `PyJWT` HS256，24h 过期，密钥来自 `.env`。登录用 **JSON body**（非 OAuth2 表单）。**注册即签发 token**（注册=自动登录）。`/me` 用 **HTTPBearer** 安全方案保护，使 Swagger 的 Authorize 按钮可用；所有鉴权失败统一返回 401。
- **前端**：`react-router-dom` v7；`lib/api.ts` fetch 封装（Authorization 拦截器 + 401→window 事件）；`AuthContext` 从 localStorage（键 `aqb_token`）复水 token，刷新保持登录；`RequireAuth` 守卫 + `PublicOnly` 重定向。

### 任务
- 写 Alembic migration，建出策划案第六节列的全部表（User / Tag / Question / QuestionTag / ReviewLog / GenSession），即使本阶段只用到 User
- 后端：`POST /auth/register`、`POST /auth/login`，bcrypt + JWT，依赖注入 `current_user`
- 前端：登录/注册页，token 存 localStorage，axios/fetch 拦截器自动塞 Authorization 头

### 退出标准
浏览器里能注册账号，刷新后仍登录态，调一个需要鉴权的 `/me` 接口返回邮箱。

---

## 阶段 2 — 题目 / 标签 CRUD（手动录入）

这阶段最大，但最有价值——之后所有功能都在这之上。

### 任务
- 后端：`Tag` 增删改查（带 `parent_id` 树形）；`Question` 增删改查（含 options、correct、type 三种）
- 前端三个页：
  - **标签管理**：树形展示、新建、改名、移动、删除
  - **录题表单**：题型选择器（单选/多选/判断）、动态增减选项、选正确答案、标签多选挂载、LaTeX 输入框（输入 `$...$` 字符串，预览区用 KaTeX 渲染）
  - **题库列表**：分页、按标签筛选、按关键词搜索、行操作（编辑/删除）

### 退出标准
能在 Web 上从零建好一个标签体系，录入 10 道带 LaTeX 的题，并在列表里筛选搜索到。

---

## 阶段 3 — 云端同步 + 软删除 + 小生产环境

### 任务
- 数据模型加 `deleted_at` 列，所有查询带 `WHERE deleted_at IS NULL`
- 删除接口改为 `UPDATE deleted_at = now()`
- 同步策略：前端"打开应用 → 拉最新"，即 `GET /questions?since=<timestamp>` 增量拉
- LWW：更新接口里若客户端发送的 `updated_at` 早于 DB 的 `updated_at` 则拒绝（或服务端直接 `updated_at = now()` 简单粗暴）
- **关键**：买一台海外 VPS（Hetzner 最便宜，€4/月起；Vultr 也行），用 Docker Compose 把 server + Postgres + Caddy 跑起来，绑域名拿到 HTTPS

### 退出标准
从两台电脑的浏览器打开生产域名，登录同一账号，A 端建题，B 端刷新能看到；A 端删题，B 端刷新也消失。

---

## 阶段 4 — Electron 壳

### 任务
- 新建 `apps/desktop`，electron-vite 或 electron-forge 起脚手架
- 加载 `apps/web` 的生产构建产物（开发期可指向 `localhost:5173`）
- 系统托盘图标 + 右键菜单（打开主窗 / 退出）
- 主窗口和 Web 完全一致

### 退出标准
双击桌面图标能打开桌面应用，功能和浏览器版一样，关闭窗口能最小化到托盘。

---

## 阶段 5 — OCR 录题链路（v1 最难的部分）

**强烈建议先做 30 分钟 spike**：单独写一段 Python 脚本，调 PaddleOCR 识别一张真实的题目截图，看效果。如果效果不好，立刻评估替代（如直接调 GPT-4o 视觉 API）。

### 任务
- `packages/ocr-sidecar`：Python 脚本，参数为图片路径，输出 JSON（识别文字 + 坐标）
- Electron 启动时 spawn 这个 Python 子进程，通过 stdio 或 localhost:port 通信
- 截屏遮罩：Electron 透明全屏窗口 + Canvas 画框选区域 + 调 `desktopCapturer.getSources()` 取屏幕图
- 全局快捷键：`globalShortcut.register('Ctrl+Shift+Q', ...)`
- 拆分逻辑：正则匹配 `A. B. C. D.` / `①②③④` / `（A）（B）` 等几种常见格式，命中失败时整段文字塞进去让用户手改
- 确认页：把识别结果填进阶段 2 的录题表单，让用户修改/选题型/打标签/入库

### 退出标准
屏幕上随便打开一道题的截图，按快捷键，框选，确认页能展示拆好的题干和选项，确认后入库。

---

## 阶段 6 — AI 接入

### 任务
- 后端：`packages` 里加 `llm_provider.py` 接口 + DeepSeek 实现；环境变量配 API key
- 三个端点：
  - `POST /ai/suggest-tags`：传 `stem` + 用户的所有标签名 → 返回 top-3
  - `POST /ai/knowledge-summary`：传 `stem` + `options` → 返回摘要字符串
  - `POST /ai/generate`：传种子题目数组 → 返回 N 道新题 JSON
- **限流**：slowapi（按用户 ID 限频）+ 自建表/Redis 累计每日 token 消耗
- 前端：录题表单提交前自动调 `suggest-tags` 和 `knowledge-summary`，结果填到对应字段（用户可改）

### 退出标准
录入一道新题，AI 自动推荐标签和写知识点摘要，token 计数器在后端能看到累加。

---

## 阶段 7 — Flashcards 复习 + 错题集

### 任务
- 复习入口页：选标签过滤、选数量、开关（乱序选项 / 自动显示答案）
- 卡片组件：题干 + 选项 → 用户点选 → 揭示对错 → 下一张
- 答题后 POST 一条 `ReviewLog`
- "错题集"虚拟标签：`GET /questions?wrong=true`，后端聚合最近 N 条 ReviewLog 中答错的题

### 退出标准
一次过题 20 张卡，答错的能在错题集里看到。

---

## 阶段 8 — AI 出题 + 三种过题模式

### 任务
- 题库列表加多选；底部按钮"用选中作为种子生成"
- 生成预览页：调用 `/ai/generate`，逐题展示，每题可编辑、可勾选；"批量导入勾选项"按钮
- 复习入口加模式选择：仅题库 / 仅 AI / 混合（按比例）

### 退出标准
选 3 道种子题 → 生成 5 道 → 编辑两道 → 勾选 4 道入库；过题时能纯选 AI 题。

---

## 阶段 9 — 导入导出

### 任务
- 定下 JSON schema（建议单独写一篇 `Docs/JSON_Schema.md`）
- 后端导出端点：流式或一次性返回完整 JSON
- 导入端点：解析 + 按 UUID 查重 + 跳过重复 + 批量插入
- 前端：题库页加"导出"和"导入"按钮

### 退出标准
导出一份 JSON，删掉数据库的题，再导入，所有题完整恢复。

---

## 阶段 10 — 打磨 + Windows 安装包

### 任务
- electron-builder 配置 → 出 `.exe` 安装包（代码签名个人项目可先跳过）
- 错误兜底（API 失败 toast、网络断开提示）
- 简单 onboarding（第一次登录引导建第一个标签和录第一道题）
- README 写好（开发、部署、环境变量列表）

### 退出标准
能把 `.exe` 发给朋友，他装上后能登录、录题、复习。

---

## 风险点与早期验证建议

| 风险 | 何时验证 | 怎么验证 |
|---|---|---|
| PaddleOCR 对常用题源的识别率 | 阶段 0-1 期间挤 30 分钟做 spike | 找 10 张真实题目截图，本地跑一次看准确率 |
| Electron spawn Python 子进程在打包后是否稳定 | 阶段 4 末尾跑一个最小 echo demo | 子进程返回 "hello" 即可，先验通信而非业务 |
| DeepSeek API 在海外服务器的延迟 | 阶段 6 前用 curl 测一次 | 单次 `curl` 调 API，看 RTT 和成功率 |
| 全局快捷键在不同 Windows 环境下被占用 | 阶段 5 | 测试 Ctrl+Shift+Q、Alt+Q、F8 等几个备选 |

---

## 推荐第一步

1. 生成阶段 0 的脚手架（monorepo 结构、`docker-compose.yml`、空的 FastAPI + React app、健康检查接口）
2. 同时启动 PaddleOCR 的 spike（独立 Python 脚本 + 几张测试图），尽早确认 OCR 可行
