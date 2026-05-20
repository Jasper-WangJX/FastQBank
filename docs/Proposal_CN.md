# AI 辅助选择题题库 — 策划案 v2

> 对应英文版：`Proposal_v2_EN.md`。

---

## 1. 项目概述

一款帮助用户快速**收集、整理、复习选择题**的多端工具，核心特色：

- **屏幕框选 OCR** 录题（仅桌面端）
- **AI 辅助标签与知识点摘要**
- **AI 出题扩展**，基于已有题目生成同类新题
- 云端同步，多端互通

MVP 目标平台：**Windows 桌面端 + 网页端**。其他平台后续规划。

---

## 2. 用户画像

- 学生 / 备考人群 / 自学者
- 主要使用场景：PC 端录入与刷题；移动端（未来）做错题复习
- 规模定位：**自用 + 小范围分享**，不做大规模公开服务

---

## 3. 核心功能

### 3.1 录题（仅桌面端）

- **屏幕框选 OCR**
  - 入口：托盘图标 / 浮动桌宠球 / 全局快捷键（默认 `Ctrl+Shift+Q`）
  - 流程：唤起截屏遮罩 → 用户框选 → OCR 提取文字 → 正则拆分题干 / 选项 → 进入「确认页」让用户校验、修改、选择题型
  - OCR 引擎：**PaddleOCR**（本地子进程，免费、离线、快；目标用户为英文题，用英文识别模型）
  - 拆分逻辑：正则识别 `A. B. C. D.` / `A)` / `(A)` / `1. 2.` 等**英文**常见格式；命中失败先整段进确认页手改。**无标号自动拆分与公式 / LaTeX 识别由"按需视觉 AI"兜底**（见 §7，阶段 6）
- **手动输入**：标准录题表单，支持 LaTeX 字符串（`$...$`）
- **题型**：单选 / 多选 / 判断（不支持填空）
- **不做**（v1）：易错选项标记、AI 题目解析、选项中插图

### 3.2 标签系统

- **层级 + 多标签**：标签按层级组织（如 `数学/微积分/极限`），**一道题可同时挂载多个层级路径**
- **AI 推荐标签**：录入时基于题干内容自动从已有标签中推荐 top-3
- **AI 知识点摘要**：录入时由 AI 自动生成 `knowledge_summary` 字段（约 1-2 句话），用于后续 AI 出题，避免每次现场分析

### 3.3 复习

- **Flashcards 模式**
  - 从题库筛选题集（按标签 / 状态 / 来源）→ 进入卡片式过题
  - 选项乱序开关
  - 显示/隐藏答案开关
  - v1：简单乱序遍历；**SRS 间隔重复列入 v2**
- **错题集**：答错的题自动归入「错题集」虚拟集合，可单独复习

### 3.4 AI 出题

- 用户在题库**选定一批题作为「种子」** → 点确认进入生成预览页
- 一次默认生成 5 道（数量可调）
- 预览页允许编辑、勾选要保留的题 → 批量入库
- 入库时打 `source: "ai"` 标签，便于事后筛选 / 删除
- 三种过题模式：**仅题库题 / 仅 AI 题 / 混合**

### 3.5 多端同步

- **海外云服务器** 单点存储
- **同步策略**：每次打开应用拉取最新；编辑冲突按 `updated_at` 最迟者获胜（LWW）
- **软删除**：删除写 `deleted_at` 字段，避免一端删除另一端覆盖回来
- **不支持离线录入**：断网时桌面端禁用录入按钮，避免本地同步队列的复杂度

### 3.6 跨账号传题（链接分享 / 导入）

- 在题库页**多选**任意题目 → 一键**打包成链接**（服务端短链，形如 `https://fastqbank.com/s/<token>`），可以发给任何人/自己换号导入
- 链接为**值快照**：发出后原题被改/删都不影响该链接的内容
- **永久不过期**，**无访问统计**，创建者可在"My shares"撤销（已撤销 → 410）
- 单条链接**硬上限 99 题**；payload 自包含（题干 / 选项 / 答案 / `knowledge_summary` / `source` / 标签按 name 列表）
- 导入时按题目 **UUID** 判重，重复跳过；标签按 **name** 在导入者账号下 match-or-create
- **本地 JSON 导入导出在 v1 不做**（跨账号传题的需求由短链承载）

---

## 4. 平台支持路线

| 平台 | v1 | v2+ |
|---|---|---|
| Windows 桌面 | ✅ | |
| 网页 | ✅ | |
| macOS 桌面 | | ✅ |
| Android | | ✅ |
| iOS | | ✅ |
| Chrome 插件 | | 选做（非必要） |

---

## 5. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 前端 UI | React + TypeScript + Vite | Web 与 Electron 共用同一套代码 |
| 桌面壳 | **Electron** | 截屏 / 桌宠 / 子进程支持成熟 |
| 后端 | **FastAPI (Python)** | 异步、生态好、自动 OpenAPI |
| 数据库 | **PostgreSQL** | JSON 字段 + 全文检索 + 关系建模 |
| OCR | **PaddleOCR**（Python sidecar，英文模型）+ **按需视觉 AI 兜底** | 本地免费离线；无标号 / 公式题转视觉模型（见 AI 模型行） |
| LaTeX 渲染 | **KaTeX** | Web 和 Electron 通用 |
| AI 模型 | 文本 **DeepSeek-V3**；视觉 **Gemini 2.5 Flash-Lite**（默认，有免费额度）/ **GPT-4o-mini**（备选）；统一 Provider 抽象 | 视觉模型按需调用做 OCR 兜底 + LaTeX，预算友好 |
| 限流 | **slowapi** + Redis（或 Postgres 计数表） | 每用户每日 token + 每分钟请求 |
| 认证 | **JWT + bcrypt**，邮箱+密码 | MVP 不强制邮箱验证 |
| 部署 | 海外 VPS + Docker Compose + Caddy | 自动 HTTPS |

### 桌面端架构要点

- **主管理窗口**：题库浏览、编辑、标签管理、复习入口
- **系统托盘图标**：常驻
- **浮动桌宠球**（可开关）：始终置顶的圆形按钮，拖动定位
- **全局快捷键**：触发框选 OCR
- **OCR 子进程**：Electron 启动时拉起 Python PaddleOCR 进程，通过 stdio 或本地 HTTP 通信

### 项目结构建议

```
ai-question-bank/
├── apps/
│   ├── web/          # React + Vite Web 端入口
│   ├── desktop/      # Electron 壳，复用 web 构建产物
│   └── server/       # FastAPI 后端
├── packages/
│   ├── shared/       # 共享 TS 类型 + API client
│   └── ocr-sidecar/  # Python PaddleOCR 服务
└── Docs/
```

---

## 6. 数据模型概览

核心表：

```
User        (id, email, password_hash, created_at)
Tag         (id, user_id, name, parent_id, path, created_at, updated_at, deleted_at)
Question    (id, user_id, stem, type, options[], correct[], knowledge_summary,
             source, created_at, updated_at, deleted_at)
QuestionTag (question_id, tag_id)
ReviewLog   (id, user_id, question_id, correct, answered_at)
GenSession  (id, user_id, seed_question_ids[], created_at)
```

字段说明：

- `Question.type`：`single` / `multi` / `judge`
- `Question.options`：JSON 数组，`[{"label":"A","content":"..."}, ...]`
- `Question.correct`：正确选项 label 数组（多选可多个）
- `Question.source`：`manual` / `ocr` / `ai`
- `Tag.path`：物化路径（如 `数学/微积分/极限`），便于前缀查询
- `ReviewLog`：每次答题记录，错题集由此聚合

---

## 7. AI 策略

> 用户在**加拿大，无访问限制**，DeepSeek / OpenAI / Gemini 均可直连。

**文本默认模型**：DeepSeek-V3 —— 便宜、性价比高，用于标签推荐 / 知识点摘要 / AI 出题。

**视觉模型**：**Gemini 2.5 Flash-Lite**（默认，最便宜档、个人使用有免费额度）/ **GPT-4o-mini**（备选），用于 `parse-question`：无标号选项拆分 + 公式 / LaTeX 识别（这是本地 PaddleOCR 解决不了的部分）。
> 说明：原计划用 Gemini 2.0 Flash，但其裸别名已被 Google 对新 API key 停用（completions 调用 404），故默认改为 `gemini-2.5-flash-lite`；换模型只改 `VISION_MODEL` 环境变量。

**抽象层**：单一 `OpenAICompatProvider`（位于 `apps/server/app/llm/`，纯服务端 —— 有意偏离路线图字面的 `packages/llm_provider.py`），文本 / 视觉各自配置 `*_API_KEY`/`*_BASE_URL`/`*_MODEL` 环境变量、一键切换（DeepSeek / OpenRouter / Qwen / GPT 等）。

**预算原则**：本地 PaddleOCR 仍是 OCR 默认（免费 / 离线），视觉 AI **仅按需触发**（正则拆分失败 / 疑似公式 / 用户点 "Improve with AI"）；发图前降采样 + 灰度、带 OCR 文本提示、`max_tokens` 封顶、复用每日 token 限额 → 个人使用成本可忽略。

**实现纪要（阶段 6 已完成 2026-05-17）**：5 个端点上线 —— `/ai/suggest-tags`、`/ai/knowledge-summary`、`/ai/generate`、`/ai/parse-question`、`/ai/usage`（token 计数器）。标签推荐 / 知识点摘要改为录题页**显式按钮**触发（用户可改后再保存），不在提交时自动调用，进一步压成本。`/ai/generate` 本阶段**仅建后端**，出题预览 UI 留到阶段 8。计量与限流：`ai_usage` 表（按用户按天）+ 每日 token 上限 + slowapi 按用户每分钟限频，超额 429；缺 key → 503（应用照常启动）。Prompt 强制**严格 LaTeX**：除"无变量无运算符的单独数字"外，所有公式 / 变量 / 表达式一律包 `$...$`（如 `$(x+1)^3$`），文本与视觉端点一致。

**四种调用场景**：

| 场景 | 时机 | 量级 | Prompt 要点 |
|---|---|---|---|
| 标签推荐 | 录入时 | 轻（文本） | 题干 + 已有标签列表 → top-3 |
| 知识点摘要 | 录入时 | 轻（文本） | 题干 → 1-2 句话摘要 |
| AI 出题 | 用户触发 | 重（文本） | 种子题目 + 知识点 → N 道新题 JSON |
| 题目解析 / 兜底 | 确认页按需（无标号 / 含公式） | 中（视觉，按需） | 裁剪截图（降采样+灰度）+ OCR 文本提示 → 结构化题目 + LaTeX |

---

## 8. 限流与安全

- **API key 永远不下发到客户端**，所有 AI 调用由服务端代理
- **限流维度**：每用户每日 token 配额 + 每分钟请求数
- **密码**：bcrypt 哈希存储
- **HTTPS**：Caddy 自动签证书
- **CORS**：白名单（前端域名 + Electron 协议）

---

## 9. 路线图

**v1 (MVP)**

- Windows + Web 双端
- 录题（手动 + 屏幕框选 OCR）
- 扁平多标签 + AI 推荐
- AI 知识点摘要
- 题库管理（增删改查、筛选、搜索、批量操作）
- Flashcards 复习 + 错题自动收集
- AI 出题（5 道/次，预览编辑后入库）
- 云端同步（LWW + 软删除）
- 跨账号传题：链接分享 + 粘贴导入（UUID 跳重）
- AI 接入：文本（DeepSeek-V3）+ 按需视觉（Gemini 2.5 Flash-Lite / GPT-4o-mini）做 OCR 兜底与公式 / LaTeX 识别 + 服务端限流

**v2**

- 浮动桌宠球 + 自定义快捷键
- SRS 间隔重复算法
- 进阶 / 离线公式识别（如本地 Pix2Text，作为 v1 云端视觉 AI 的离线补充）
- 错题专项复习模式
- macOS 桌面端

**v3**

- Android / iOS
- 题集分享 / 公开题库
- Chrome 插件
- 团队协作 / 公开服务能力

---

## 10. v1 明确不做

- 填空题
- 选项内含图片
- 易错选项标记
- AI 题目解析
- 离线录入
- 多人协作
- 邮箱强制验证
- 移动端
- SRS 算法
- 本地 JSON 文件导入导出（跨账号传题改用链接分享）
- 分享链接的访问统计 / 过期时间 / 密码保护

---

## 11. 后续待定事项

进入实现前需进一步确认：

1. 限流的具体阈值（每用户每日 token 上限、每分钟请求上限）
2. 服务器具体提供商（Vultr / Hetzner / DigitalOcean / AWS Lightsail …）和初始配置
3. 桌面端「主窗口 + 桌宠球」的具体 UI 草稿
