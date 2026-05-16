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
  - OCR 引擎：**PaddleOCR**（本地子进程，免费、中文识别好）
  - 拆分逻辑：正则识别 `A. B. C. D.` / `A)` / `①②③④` / `（A）（B）` 等常见格式；命中失败时让 LLM 兜底
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

### 3.6 导入 / 导出

- 自定义 **JSON** 格式
- 导入时按题目 UUID 判重，**默认跳过重复**（其他策略后续可加）
- 导出包含完整题目、选项、答案、标签、知识点摘要

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
| OCR | **PaddleOCR**（Python sidecar 子进程） | 中文识别效果显著好于 Tesseract |
| LaTeX 渲染 | **KaTeX** | Web 和 Electron 通用 |
| AI 模型 | **DeepSeek-V3** 默认 + Provider 抽象层 | 便宜、中文好 |
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

**默认模型**：DeepSeek-V3
- 输入约 ¥1/M token，对中文友好，性价比极高
- 海外服务器调用会有 ~200ms 跨境延迟，可接受

**抽象层**：定义 `LLMProvider` 接口，未来一键切换 OpenRouter / Qwen / GPT。

**三种调用场景**：

| 场景 | 时机 | 量级 | Prompt 要点 |
|---|---|---|---|
| 标签推荐 | 录入时 | 轻 | 题干 + 已有标签列表 → top-3 |
| 知识点摘要 | 录入时 | 轻 | 题干 → 1-2 句话摘要 |
| AI 出题 | 用户触发 | 重 | 种子题目 + 知识点 → N 道新题 JSON |

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
- 层级 + 多标签 + AI 推荐
- AI 知识点摘要
- 题库管理（增删改查、筛选、搜索）
- Flashcards 复习 + 错题自动收集
- AI 出题（5 道/次，预览编辑后入库）
- 云端同步（LWW + 软删除）
- JSON 导入导出
- DeepSeek 接入 + 服务端限流

**v2**

- 浮动桌宠球 + 自定义快捷键
- SRS 间隔重复算法
- OCR 数学公式识别（Pix2Text）
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

---

## 11. 后续待定事项

进入实现前需进一步确认：

1. 限流的具体阈值（每用户每日 token 上限、每分钟请求上限）
2. 服务器具体提供商（Vultr / Hetzner / DigitalOcean / AWS Lightsail …）和初始配置
3. 桌面端「主窗口 + 桌宠球」的具体 UI 草稿
4. JSON 导入导出的字段 schema 细节
5. 标签层级的最大深度限制（建议 5 层够用）
