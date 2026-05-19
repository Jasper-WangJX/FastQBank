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

| 阶段 | 状态 | 目标产物 |
|---|---|---|
| 0 脚手架 | ✅ 已完成 (2026-05-16) | 仓库结构、本地能起前后端 + DB |
| 1 数据底座 + 认证 | ✅ 已完成 (2026-05-16) | 注册登录、JWT、表迁移 |
| 2 题目 / 标签 CRUD（手动录入） | ✅ 已完成 (2026-05-16) | Web 端能手动建标签、录题、查看列表、LaTeX 渲染 |
| 3 云端同步 + 软删除 + 部署小环境 | ✅ 已完成 (2026-05-17) | 部署到 VPS、域名可访问、多端拉取一致 |
| 4 Electron 壳 | ✅ 已完成 (2026-05-17) | 桌面端能跑，复用 web 构建 + 托盘图标 |
| 5 OCR 录题链路 | ✅ 已完成 (2026-05-17) | 框选截屏 → OCR → 拆分 → 确认页入库 |
| 6 AI 接入 | ✅ 已完成 (2026-05-17) | 标签推荐 + 知识点摘要 + 限流；按需视觉 AI 做无标号拆分 + LaTeX |
| 7 Flashcards 复习 + 错题集 | ✅ 已完成 (2026-05-18) | 题目选择器 → 卡片式过题 → 持久错题集；含 7.1 标签/卡片视图 UX |
| 8 AI 出题 | ✅ 已完成 (2026-05-19) | 复习入口选种子 → 混合/仅AI过题 → 卡上"加入题库"（带tag+分析） |
| 9 JSON 导入导出 | ⬜ 待办 | 导出全量、导入按 UUID 跳过重复 |
| 10 打磨 + Windows 安装包 | ⬜ 待办 | electron-builder 打包、产品化收尾 |


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

> **状态：✅ 已完成 (2026-05-16)。** 退出标准已端到端验证：后端用 httpx ASGITransport 自动化走查（分页 / 关键词 / 标签子树 / 删父标签语义，23 项断言全过），前端浏览器 17 项走查全过（建树、录 10 道带 LaTeX 的题、筛选搜索、编辑删除）。

这阶段最大，但最有价值——之后所有功能都在这之上。

#### 实际实现说明（与原计划的差异）
- **无新迁移**：6 张表已在阶段 1 基线迁移建好，本阶段纯加 Pydantic schema + router + 前端三页，DB 结构未动。
- **标签 `path` 按 ID 存**（`父path/自身UUID`）：改名只改 `name`、path 与后代不变；仅「移动」重算子树 path，防环退化为纯前缀判断。最大深度 6 层。
- **删标签**：级联删整棵子树 + 解绑题目（清 `question_tags`），题目本身保留。阶段 2 物理删除，但所有读查询已带 `deleted_at IS NULL` —— 阶段 3 改软删零读路径改动。
- **题型校验**集中在 `QuestionIn` 的单个 `model_validator`（单选恰 1 / 多选 ≥1 / 判断 T·F 且恰 1 / label 唯一 / correct⊆labels），返回单条清晰 422，不依赖 DB CHECK 兜底。
- **标签筛选为子树匹配**（按 `path` 前缀，含后代标签的题），经用户确认非精确匹配；更新题目时 router 忽略 `source`，不改写 OCR/AI 来源。
- **LaTeX**：裸 `katex` + 自写 `Latex` 组件（按 `$…$`/`$$…$$` 切分，纯文本走 React 节点防 XSS，未闭合 `$` 不崩），CSS 全局 import 一次。
- **前端**：`lib/qbank.ts` 类型化封装复用既有 `apiFetch`（其 body 类型放宽为 `unknown` 以支持具名类型）；新增 `AppLayout` 导航壳 + `RequireAuth` 下嵌套路由；`/` 重定向到 `/questions`，移除已无用的 `HomePage`。每次变更后重拉，列表关键词防抖 300ms。

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

> **状态：✅ 已完成 (2026-05-17)。** 拆为 3a（软删 + 同步语义，本地可验）/ 3b（生产部署）。退出标准已在真实生产域名 `https://fastqbank.com` 上双端验收：增/改/删跨端传播、LWW、软删本质（psql 确认行仍在）全部通过；后端另有 httpx 自动化 39 项断言。

#### 实际实现说明（与原计划的差异）
- **软删除**：`tags`/`questions` 的 `deleted_at` 列阶段 1 已建，本阶段仅把删除端点改 `UPDATE deleted_at=now()`；读路径阶段 2 已全带 `deleted_at IS NULL`，零改动。`delete_tag` 软删整棵子树并**保留** `question_tags` 链接（`_tags_for`/子树筛选 join 已过滤软删标签 → 题目侧自动隐藏且可逆）。
- **LWW**：采用「服务端盖章，后到者胜」（`update/rename/move` 均 `updated_at=func.now()`），不做客户端时间戳比较。
- **同步**：采用「最小化——打开即全量重拉」，未实现 `?since=` 增量 / tombstone（前端各页挂载即拉，配合共享后端即多端一致）。
- **部署结构**：api 子域名方案——前端 `https://fastqbank.com`（Caddy 托管静态 SPA），后端 `https://api.fastqbank.com`（Caddy 反代 `server:8000`），后端路由零改动、无 SPA/API 路径冲突。
- **编排**：`apps/server/Dockerfile`（启动跑 `alembic upgrade head`）+ 多阶段前端镜像（node:22 构建 → caddy:2，烘焙 `VITE_API_BASE_URL`）+ `deploy/docker-compose.prod.yml`（postgres+server+caddy，Caddy 自动 HTTPS，证书卷持久化）。配置经 git 忽略的 `deploy/.env.prod`；CORS 经 `CORS_ORIGINS` JSON env 注入，**零代码**。
- **部署期修复**：`settings.py` 写死 `parents[3]` 推算仓库根 `.env`，镜像内目录层级浅 → 启动 `IndexError`；改为 `len(parents)>3` 才取、否则回退读环境变量（本地开发行为不变，已验证）。
- **验证**：本地 prod-shaped 演练（compose 起 postgres+server，迁移/健康/注册全绿）+ 生产 VPS 浏览器双端验收全部通过。

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

> **状态：✅ 已完成 (2026-05-17)。** 采用方案 A（自定义 `app://aqb` 协议加载 `apps/web` 生产构建）。构建 / 打包 / 无头启动已自动验证，用户 GUI 双端走查（登录生产后端、网页↔桌面数据互通、刷新不白屏、重启保登录、关窗到托盘 / 召回 / 退出、二次启动聚焦）全部通过。

#### 实际实现说明（与原计划的差异）
- **脚手架**：未用 electron-vite/electron-forge；`apps/desktop` 为独立 package（仍无 monorepo workspace —— 与阶段 1 备注里推迟的 `packages/shared` 一致，本阶段也未引入），渲染层零改造直接复用 `apps/web` 既有 Vite 构建。主 / 预加载用 `tsc` 编译（`module`/`moduleResolution: node16`，避开 TS6 弃用的 classic `node`）。
- **方案 A 加载**：主进程注册标准 + 安全的自定义 `app://` scheme，`protocol.handle` 从 `dist` 提供文件、未命中路径回退 `index.html`（等价 Caddy `try_files`），固定 origin `app://aqb`。由此保留 `BrowserRouter`、刷新 / 深链不白屏、localStorage 登录态持久、CORS 仅需放行单一固定 origin。Vite 默认 `base:"/"` 的绝对资源路径由 handler 按 URL pathname 映射天然兼容，**web 侧零改动**。
- **dev/prod 分支**：`ELECTRON_DEV=1` → 加载 `http://localhost:5173`（Vite dev server，origin 已在白名单）；否则 `app://aqb/`。
- **后端 CORS**：`settings.py` 默认列表 + `deploy/env.prod.example` 加 `app://aqb`；VPS 真实 `deploy/.env.prod` 已由用户改并验证（生产桌面端登录通过）。
- **托盘 / 生命周期**：`Tray` + 菜单（打开主窗 / 退出）、左键切换显隐、关闭窗口拦截改隐藏（`isQuitting` 标志区分真退出）、`requestSingleInstanceLock` + `second-instance` 聚焦已有窗。`window-all-closed` 故意空实现（托盘常驻）。
- **图标**：零依赖纯 `zlib` PNG 生成器（`scripts/gen-icons.cjs`）产占位 `icon.png`(256)/`tray.png`(32)，放 `apps/desktop/assets/`（非计划里的 `build/` —— 根 `.gitignore` 忽略 `build/`）。正式图标留阶段 10。
- **打包边界**：本阶段不出正式安装器；`electron-builder --dir` 仅用于验证「可双击」，`extraResources` 把 `apps/web/dist` 打进 `resources/web-dist`，主进程按 `app.isPackaged` 切换 dist 路径。正式 Windows 安装包留阶段 10。
- **环境坑（已固化修复）**：pnpm 11 拦截 Electron 二进制 postinstall → `package.json` `pnpm.onlyBuiltDependencies` + `apps/desktop/.npmrc` `verify-deps-before-run=false`，二进制经 `node node_modules/electron/install.js` 落地。
- **验证**：`pnpm build`（web 烘焙 `VITE_API_BASE_URL=https://api.fastqbank.com`、无 localhost 泄漏）+ `electron-builder --dir` + 打包 exe 无头启动无崩溃；用户 GUI 双端走查 4 项行为全过。

### 任务
- 新建 `apps/desktop`，electron-vite 或 electron-forge 起脚手架
- 加载 `apps/web` 的生产构建产物（开发期可指向 `localhost:5173`）
- 系统托盘图标 + 右键菜单（打开主窗 / 退出）
- 主窗口和 Web 完全一致

### 退出标准
双击桌面图标能打开桌面应用，功能和浏览器版一样，关闭窗口能最小化到托盘。

---

## 阶段 5 — OCR 录题链路（v1 最难的部分）

> **状态：✅ 已完成 (2026-05-17)。** dev 端到端验收通过（快捷键/按钮 → 遮罩框选 → OCR → 拆分 → 预填确认页 → 入库，`source='ocr'`）；sidecar 打包 exe 已**离线硬验**（`model_loaded:true`、test1/test3 识别正确、错 token 401、热路径 ~0.5s）。**完整 electron-builder 打包态端到端冒烟移交阶段 10**（见该阶段任务）。

#### 实际实现说明（与原计划的差异）
- **决策门 spike**：PaddleOCR 3.x 的 oneDNN 在新执行器崩溃 → 降级**钉版 paddlepaddle 2.6.2 + paddleocr 2.9.1**，`enable_mkldnn=True` 热路径 0.2–0.55s/张；`lang="en"`（目标用户为英文题，i18n 范围确定为**纯英文、不引入 i18n 框架**）。
- **sidecar**：`packages/ocr-sidecar/ocr_server.py`，本地 `127.0.0.1` HTTP（非 stdio —— paddle 日志会污染 stdio 分帧），`/healthz` + `/ocr`，随机 `X-OCR-Token`，后台线程预加载模型，输出按阅读序排序。
- **拆分**：放前端纯函数 `apps/web/src/lib/ocr/splitter.ts`（英文标号 `A.`/`A)`/`(A)`/`1.`，多题截图取首题，无可靠标号时**诚实回退** `matched:false` 整段进确认页 —— 不硬拆以免用户撤销错拆）；引入 **vitest** 14 用例全绿（`apps/web` pnpm-workspace 配置随之调整）。
- **Electron**：`main.ts` 拆出 `sidecar/capture/overlay/shortcut/ipc` 模块；全局快捷键三级回退 `Ctrl+Shift+Q → Alt+Q → F8`；截屏取物理像素、裁剪用**截图真实位图比例 + 边距**（修了选区/裁剪比例不一致导致丢末行）；遮罩窗**去透明、强制整屏**（修了 Windows 透明窗被限工作区导致的"双任务栏 / 整屏压缩"）；`preload.ts` 加 `ocr`/`overlay` IPC 桥（sandbox 保持开启）；托盘菜单中文 → 英文。
- **确认页**：复用阶段 2 `QuestionFormPage`，经 React Router `state` 预填（不进 URL，编辑/手动路径零影响），`source:'ocr'`，"Draft from OCR" 横幅 + 未命中提示。**唯一后端改动**：`schemas.py` 把 `source` 放开为 `Literal["manual","ocr","ai"]`（DB CHECK 早含三值，**无需迁移**）。
- **打包**：PyInstaller **onedir**（paddle 数百 MB，onedir 更稳更快），模型 staged 进包、运行时读 `sys._MEIPASS/models` —— 离线零下载；迭代补齐 PyInstaller 漏收（Cython 数据 / `tools`·`ppocr`·`ppstructure` 顶层包）；electron-builder `extraResources` + `package.json` `build:sidecar` 接好，路径与 `sidecar.ts` 打包态自洽。
- **延后项**：无标号自动拆分 + 公式/LaTeX 识别按既定计划由**阶段 6 的按需视觉 AI** 解决（本阶段只做正则 + 手改兜底）。

---

**强烈建议先做 30 分钟 spike**：单独写一段 Python 脚本，调 PaddleOCR 识别一张真实的题目截图，看文字识别效果。注意本阶段**只**解决"有标号、无公式"的常规题；**无 A/B/C/D 标号的自动拆分与公式 / LaTeX 识别不在本阶段范围**，统一延后到阶段 6 由"按需视觉 AI"处理（见阶段 6）。

### 任务
- `packages/ocr-sidecar`：Python 脚本，参数为图片路径，输出 JSON（识别文字 + 坐标）
- Electron 启动时 spawn 这个 Python 子进程，通过 stdio 或 localhost:port 通信
- 截屏遮罩：Electron 透明全屏窗口 + Canvas 画框选区域 + 调 `desktopCapturer.getSources()` 取屏幕图
- 全局快捷键：`globalShortcut.register('Ctrl+Shift+Q', ...)`
- 拆分逻辑：正则匹配 `A. B. C. D.` / `A)` / `(A)` / `1. 2.` 等**英文**常见格式（目标用户为英文题，去掉中文专属标号）；命中失败时整段文字塞进确认页让用户手改。**无标号自动拆分与 LaTeX 识别不在本阶段，延后到阶段 6 由按需视觉 AI 解决**
- 确认页：把识别结果填进阶段 2 的录题表单，让用户修改/选题型/打标签/入库

### 退出标准
屏幕上随便打开一道题的截图，按快捷键，框选，确认页能展示拆好的题干和选项，确认后入库。

---

## 阶段 6 — AI 接入

> **状态：✅ 已完成 (2026-05-17)。** 后端 5 个端点全部真实跑通：`/ai/suggest-tags`、`/ai/knowledge-summary`、`/ai/generate`、`/ai/parse-question`（视觉）、`/ai/usage`（计数器，为退出标准新增）。接入层落在 `apps/server/app/llm/`（**有意偏离**路线图字面的 `packages/llm_provider.py` —— 纯服务端消费、与 `app/security.py` 同构、可直接 import）：单一 `OpenAICompatProvider` 同时驱动 DeepSeek-V3（文本）与 Gemini（视觉，均走 OpenAI 兼容接口）；缺 key → 503，应用照常启动。**视觉模型偏离**：路线图的 `gemini-2.0-flash` 裸别名 Google 已对新 API key 停用（completions 调用 404），默认改用 `gemini-2.5-flash-lite`（最便宜、有免费额度、支持视觉），`VISION_MODEL` 可覆盖、无需改代码。计量与限流：新增 `ai_usage` 表（迁移 `0002`，按用户按天 PG `ON CONFLICT` 原子累加）+ 每日 token 上限 + slowapi 按用户每分钟限流，超额均 429。前端两个按钮均**点击触发、不自动花钱**：「AI: suggest tags + summary」回填可改字段；「Improve with AI」用桌面带过来的裁剪图调视觉端点拆无标号选项 + 恢复 LaTeX。Prompt 强制**严格 LaTeX**（除无变量无运算符的单独数字外，所有公式包 `$...$`）。`.env` 在仓库根目录；新增依赖 `openai`/`slowapi`/`Pillow`/`python-multipart`。验证：四文本 + 视觉端点真实 DeepSeek/Gemini 调通、token 累加、限流/每日上限 429、无 key 503 全实测；前端 `tsc`/`vitest`(16 绿)/`build`/`lint` 全过。**移交**：`/ai/generate` 仅建后端、出题预览 UI → 阶段 8；真实 GUI 点按钮 + 桌面截图链路走查 → 阶段 10 打磨态一并复核。

> 用户地理位置：**加拿大，无访问限制**（DeepSeek / OpenAI / Gemini 均可直连）。
> 设计原则：本地 PaddleOCR 仍是 OCR 默认（免费、离线、快）；**AI 仅按需介入**，把成本压到个人项目可忽略。

### 任务
- 后端：`packages` 里加 `llm_provider.py` 接口；**文本任务**用 DeepSeek-V3，**视觉任务**用预算视觉模型（默认 **Gemini 2.0 Flash**，有免费额度；备选 **GPT-4o-mini**）；API key 走环境变量
- 四个端点：
  - `POST /ai/suggest-tags`：传 `stem` + 用户的所有标签名 → 返回 top-3（文本）
  - `POST /ai/knowledge-summary`：传 `stem` + `options` → 返回摘要字符串（文本）
  - `POST /ai/generate`：传种子题目数组 → 返回 N 道新题 JSON（文本）
  - `POST /ai/parse-question`：传**裁剪截图**（降采样 + 灰度）+ PaddleOCR 文本作提示 → 返回结构化 `{stem, type, options[]}` 并**保留 LaTeX**。一次视觉调用同时解决：① 无 A/B/C/D 标号时的选项拆分；② OCR 丢失的公式 / LaTeX 识别
- **按需触发（成本核心）**：`/ai/parse-question` 仅在正则拆分失败（`matched=false`）、检测到疑似公式、或用户在确认页点 "Improve with AI" 时调用；普通题走本地 PaddleOCR + 正则，零 API 花费
- **成本控制**：发图前降采样 + 灰度（长边 ≤ ~1000px）；带 OCR 文本提示以缩短 token、无公式时可走纯文本调用；`max_tokens` 封顶；复用下方限流 + 每日 token 上限
- **限流**：slowapi（按用户 ID 限频）+ 自建表/Redis 累计每日 token 消耗
- 前端：录题表单提交前自动调 `suggest-tags` 和 `knowledge-summary`（用户可改）；确认页加 "Improve with AI" 按钮触发 `parse-question`，返回结果可编辑

### 退出标准
录入一道新题，AI 自动推荐标签和写知识点摘要，token 计数器在后端能看到累加；一张**无 ABCD 标号**或**含公式**的题截图，点 "Improve with AI" 后确认页能展示拆好的选项与正确 LaTeX。

---

## 阶段 7 — Flashcards 复习 + 错题集

> **状态：✅ 已完成 (2026-05-18)。** 走 brainstorming → spec → 计划 → subagent 驱动执行（逐任务实现 + spec/质量两阶段评审），后续叠加 7.1 UX 改进与若干精修。退出标准已由 `scripts/verify_review.py`（httpx ASGITransport，真实 Postgres，ALL PASS）+ 前端 `build`/`lint`/`vitest`(34) + 用户 GUI 走查共同验收。规格/计划见 `docs/superpowers/specs|plans/`。

#### 实际实现说明（与原计划的差异）
- **错题集语义升级**：路线图原写「`GET /questions?wrong=true` 聚合最近 N 条 ReviewLog」，经确认改为**持久、手动清除**：新增 `wrong_questions` 表（迁移 `0003`）+ `WrongQuestion` 模型。答错 → PG `ON CONFLICT` upsert 为活跃；答对 → **不动**；「Mark as mastered」→ 写 `cleared_at` 离集；再答错 → 复活同一行；软删题靠读查询 `deleted_at IS NULL` 排除。
- **专用 `/review` 路由**（非在 `/questions` 上加 `?wrong=true`）：`POST /review/deck`、`GET /review/tag-question-ids`（`tag_id` 可选，省略=全部存活题）、`POST /review/logs`、`GET /review/wrong`、`POST /review/wrong/{id}/master`。顺带抽出共享 `app/question_query.py`（去重 `questions.py` 的子树/标签加载逻辑）。后端无 committed pytest，沿用 1–6 阶段的 httpx 验证脚本范式。
- **「自动显示答案」开关 → 重命名 Fast mode**：关=选完点 Check（多选 Submit）才揭示；开=单选/判断**选中即揭示且不显示 Check 按钮**、多选仍需 Submit，且揭示后停留 **0.8s 自动切下一题**。两种模式都计分、都写 ReviewLog。
- **复习入口=题目选择器**（非路线图的「标签+数量」表单）：一个**跨标签全局选择集合**（多标签题安全）、标签栏 + 「All questions」+「⚠ Wrong questions」特殊条目、可选 Random pick 上限、Shuffle options、本轮有效不持久；每卡一条 ReviewLog（按 idx 幂等、失败非阻塞 + Retry）；结束小结含「Review wrong now」。前端纯逻辑 `lib/review/session.ts` 走 TDD（vitest）。
- **错题集两处可清**：错题集列表行内 `Mastered` + 刷错题卡片上 `Mark as mastered`（仅当**本次答对**才显示——重做仍错不显示）。
- **7.1 UX 叠加**：完整标签增删改（`TagManagePanel`，"⋯" 菜单，去除移动父节点）并入**题库页**，移除独立 `/tags` 页+导航+`TagManagerPage`；录题页改为层级标签勾选 + 「在某父标签下新增子标签（带确认）」；层级标签控件全站统一（共享 `components/tags/tagTree.ts`）；题库页与 review 选择器新增 List/Cards 预览视图（共享 `QuestionCard`）；review 默认选中「All questions」，单题选择按钮图标化；review 每页 10 题。
- **分支**：`phase-7-flashcards`，逐任务提交，验收通过后合并入 `main`。

### 任务
- 复习入口页：选标签过滤、选数量、开关（乱序选项 / 自动显示答案）
- 卡片组件：题干 + 选项 → 用户点选 → 揭示对错 → 下一张
- 答题后 POST 一条 `ReviewLog`
- "错题集"虚拟标签：`GET /questions?wrong=true`，后端聚合最近 N 条 ReviewLog 中答错的题

### 退出标准
一次过题 20 张卡，答错的能在错题集里看到。

---

## 阶段 8 — AI 出题 + 三种过题模式

> **状态：✅ 已完成 (2026-05-19)。** 走 brainstorming → spec → 计划 →
> subagent 驱动执行（逐任务实现 + spec/质量两阶段评审）。复用复习入口
> 选择集合作 AI 出题种子；扩展 `/ai/generate` 同时产出"仅限现有标签"的
> tag 与 knowledge_summary（分析）；AI 题为合成 id 的临时卡，过题时不写
> ReviewLog、不进错题集（答错也不入），卡上 "Add to question bank" 复用
> `POST /questions`（`source=ai`）。两个子选项：混合 / 仅 AI。无新表/新
> 端点/迁移。规格见
> `docs/superpowers/specs/2026-05-19-phase8-ai-generation-design.md`。

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
- **打包态端到端冒烟（阶段 5 移交）**：跑完整 `pnpm --dir apps/desktop package`，验证 ① electron-builder 把 onedir sidecar 拷进 `resources/ocr-sidecar`；② 打包应用经 `app.isPackaged` 路径成功拉起 sidecar（dev 走 venv python，此路径从未跑过）；③ 断网下截题 → OCR → 入库；④ 退出后无残留 `ocr_server.exe` 进程树
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
| LLM / 视觉 API 的延迟与成本 | 阶段 6 前各 curl 测一次 | 文本(DeepSeek-V3)与视觉(Gemini 2.0 Flash / GPT-4o-mini)各调一次，看 RTT、成功率、单题 token 成本 |
| 全局快捷键在不同 Windows 环境下被占用 | 阶段 5 | 测试 Ctrl+Shift+Q、Alt+Q、F8 等几个备选 |

