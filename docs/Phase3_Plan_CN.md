# 阶段 3 实施方案 — 云端同步 + 软删除 + 部署小环境

> 配套文档：`Roadmap_CN.md`（阶段总览）、`Proposal_CN.md`（功能与技术栈基线）。
> 本文档把路线图阶段 3 拆成可逐步执行的实施流程，记录已确认决策与差异。
> 约定：本文用中文；写入代码的注释/说明默认英文。

---

## Context（为什么 / 目标）

阶段 0–2 已完成（脚手架、认证、题目/标签 CRUD 全链路）。阶段 3 要让**多端
共享一份云端数据**：删除可跨端传播（软删除）、打开应用能看到别处的改动
（同步），并把后端真正部署到带 HTTPS 的生产环境。

**退出标准**（来自 `Roadmap_CN.md`）：从两台电脑的浏览器打开生产域名，登录同
一账号，A 端建题 B 端刷新能看到；A 端删题 B 端刷新也消失。

经决策，阶段 3 拆为两段：

- **3a**：软删除 + 同步语义 —— **现在就能做，且无需部署即可本地验收**
- **3b**：生产部署 —— **待 VPS + 域名就绪后再做**，本文先列大纲

---

## 已确认的设计决策

| 决策 | 选择 | 影响 |
|---|---|---|
| LWW 冲突解决 | **服务端盖章，后到者胜** | `update_question`/`rename_tag`/`move_tag`/题目标签更新**已全部** `updated_at=func.now()` → **零代码改动**，仅在 docstring 写明语义（并发编辑后到者覆盖，自用可接受） |
| 同步深度 | **最小化：打开即全量重拉** | 不加 `?since=`/tombstone。前端各页 `useEffect` 挂载即拉，刷新=重挂载=重拉 → **同步轨基本零代码**，依赖 3b 提供共享后端；可选「窗口聚焦自动重拉」做润色 |
| 部署就绪度 | **拆 3a / 3b** | 3a 本地双 profile 即可验收「增删跨端传播」；3b 待 VPS+域名 |
| 软删除范围 | 仅 `tags` / `questions` | 两表 Phase 1 已建 `deleted_at`（可空 TIMESTAMPTZ）；`users`/`review_logs`/`gen_sessions` 不软删。**无新迁移** |
| 标签解绑 | 软删标签**不**删 `question_tags` | `_tags_for` 与列表子树筛选的 join 已过滤 `Tag.deleted_at IS NULL`，链接行保留即可隐藏且**可逆** |

### 与阶段 3 相关的代码现状（无需再勘察）

- `apps/server/app/models.py`：`tags`/`questions` 已有 `deleted_at`；其余表没有
- Phase 2 所有读查询已带 `deleted_at IS NULL`；`_tags_for` join、`list_questions`
  子树筛选 join 均已过滤软删标签
- 删除端点目前是**物理删除**：`routers/tags.py::delete_tag`、
  `routers/questions.py::delete_question`
- 更新/改名/移动已写 `updated_at = func.now()`（LWW 已就位）
- 部署：`docker-compose.yml` 只有 postgres；server 靠手动 uvicorn；无 server
  Dockerfile；CORS 来自 settings（localhost:5173/5174）；前端 `API_BASE` 来自
  `VITE_API_BASE_URL`

---

## 阶段 3a — 软删除 + 同步语义（现在做，本地可验收）

无新 Alembic 迁移（`deleted_at` 列已存在，schema 不变）。

### A1 — `apps/server/app/routers/tags.py`：`delete_tag` 改软删
- 把对子树的物理 `DELETE` 改为
  `UPDATE tags SET deleted_at=now() WHERE (path=:p OR path LIKE :p||'/%')
  AND user_id=:u AND deleted_at IS NULL`（幂等：已删的不再盖章）
- **移除**原 `delete(QuestionTag)` 解绑逻辑——`_tags_for`/子树筛选 join 已过滤
  软删标签，题目侧自动看不到，且保留链接行可逆
- 返回码不变（204）

### A2 — `apps/server/app/routers/questions.py`：`delete_question` 改软删
- 物理 `DELETE` → `UPDATE questions SET deleted_at=now() WHERE id=:id
  AND user_id=:u AND deleted_at IS NULL`
- `question_tags` 行保留（题已被 `deleted_at` 过滤隐藏，无害）；204 不变

### A3 — 读路径与语义审计（基本已就位，确认无遗漏）
- 复核 tags/questions 所有查询均带 `deleted_at IS NULL`（Phase 2 已全带）
- 确认软删后同级/同名可重建（同名校验已排除软删行）
- 在 `delete_tag`/`delete_question`/`update_*` 的 docstring 写明：**软删除**
  + **LWW = 服务端盖章后到者胜** 的语义

### A4 — 自动化验证（httpx ASGITransport，沿用 Phase 2 方式）
- 删标签 → 子树标签 + 题目 tag 列表隐藏，但 DB 行仍在；重建同名通过
- 删题 → 列表/单查不可见，DB 行仍在
- **双客户端模拟**：同一 user 两个 token，A 建/删，B 重新拉取即见变化
  （API 层验证「同步」语义，不依赖部署）

### 3a 浏览器验收（不需部署）
本地起 `docker compose up -d postgres` + 后端 uvicorn + 前端 `pnpm dev`，开
**两个浏览器 profile**（或正常 + 无痕）都登录**同一账号**：

1. A 建题 → B 刷新可见
2. A 删题 → B 刷新消失
3. A 建/删标签 → B 刷新树同步
4. 同一题 A、B 先后编辑 → 后提交者覆盖（LWW 语义符合预期）

满足退出标准里「增删跨端传播 + LWW」，仅差「真实生产域名」一环（留 3b）。

**3a 顺序**：A1 → A2 → A3 → A4 → 浏览器验收。

---

## 阶段 3b — 生产部署（待 VPS + 域名就绪，届时细化）

仅大纲，就绪后逐步展开并细化为分步流程：

- **C1** `apps/server/Dockerfile`：装 `requirements.txt`，跑 uvicorn；容器启动
  前 `alembic upgrade head`
- **C2** 生产 `docker-compose`（与本地分开或加 profile）：`server` +
  `postgres` + `caddy`。Caddyfile 反代域名 → server，自动 HTTPS（Let's
  Encrypt），并托管 `apps/web/dist` 静态产物
- **C3** 生产配置：强随机 `JWT_SECRET`、`DATABASE_URL` 指向 compose 内
  postgres 服务名、CORS 加生产 web 域名；前端用
  `VITE_API_BASE_URL=https://<域名>` 重新 `pnpm build`
- **C4** VPS 开通（Hetzner/Vultr 等，Proposal §11 待定项）+ DNS A 记录 →
  VPS IP + 放行 80/443 + `docker compose up -d`
- **C5** 生产库 `alembic upgrade head`
- **退出验证**：两台电脑访问生产域名，同账号增删跨端一致、删除会消失

---

## 关键文件

- `apps/server/app/routers/tags.py`（A1，改 `delete_tag`）
- `apps/server/app/routers/questions.py`（A2，改 `delete_question`）
- 3b：`apps/server/Dockerfile`（新建）、生产 compose、Caddyfile、前端构建配置

## 实施顺序

3a：A1 → A2 → A3 → A4 → 浏览器验收（独立、零部署）。
3b：C1 → C2 → C3 → C4 → C5 → 生产验收（VPS+域名就绪后启动）。
