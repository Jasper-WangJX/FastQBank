# AI-assisted-question-bank
# 本地命令
## 开docker
docker compose up -d postgres
docker compose ps 

## 开后端
cd "D:\jasper\Documents\Coding\my_projects\AI-assisted question bank\apps\server"
.venv\Scripts\uvicorn.exe main:app --reload --port 8000

## 进入虚拟环境
.venv\Scripts\activate.bat

# VPS下的命令
## 更新
git pull && docker compose -f deploy/docker-compose.prod.yml up -d --build

## 关站
docker compose -f deploy/docker-compose.prod.yml stop caddy

## 恢复
docker compose -f deploy/docker-compose.prod.yml start caddy

## 清除数据
docker exec aqb-prod-postgres psql -U aqb -d aqb -c "TRUNCATE users, tags, questions, question_tags, review_logs, gen_sessions RESTART IDENTITY CASCADE;"

# 阶段 6 — AI 接入

## 环境变量（写在仓库根目录 `.env`，模板见 `.env.example`）
- `DEEPSEEK_API_KEY`：文本任务（标签推荐 / 知识点摘要 / AI 出题），https://platform.deepseek.com/
- `VISION_API_KEY`：视觉任务（parse-question：拆无标号选项 + 恢复公式 LaTeX），填 Gemini key，https://aistudio.google.com/apikey
- 两个都留空也能跑：阶段 0-5 不受影响，AI 端点返回 503 "AI not configured"。
- 可选覆盖：`DEEPSEEK_MODEL` / `VISION_MODEL` / `AI_DAILY_TOKEN_LIMIT`(默认 200000) / `AI_RATE_LIMIT_PER_MIN`(默认 20) / `AI_MAX_TOKENS`(默认 1024)。

## 模型说明（对路线图的必要偏离）
路线图写的视觉模型 `gemini-2.0-flash` 裸别名已被 Google 对**新 API key 停用**（completions 调用 404，虽仍出现在 /models 列表）。默认改用 `gemini-2.5-flash-lite`（当前最便宜、支持视觉、有免费额度）。换模型只改 `VISION_MODEL` 环境变量，无需改代码。

## 数据库迁移（新增 `ai_usage` 表，按用户按天计 token）
本地：
```
cd apps/server
.venv\Scripts\python.exe -m alembic upgrade head
```
VPS：**无需手动迁移** —— server 容器 Dockerfile 的 `CMD` 在每次启动时自动 `alembic upgrade head`，`git pull && docker compose -f deploy/docker-compose.prod.yml up -d --build` 后 `ai_usage` 表会自动建好。AI key 加到 `deploy/.env.prod`（模板见 `deploy/env.prod.example`，留空则线上 AI 返回 503、其余不受影响）。

## 端点与成本控制
- `POST /ai/suggest-tags`、`POST /ai/knowledge-summary`、`POST /ai/generate`、`POST /ai/parse-question`、`GET /ai/usage`
- 全部需登录；缺对应 key → 503；超每分钟请求数 → 429；超每日 token 上限 → 429（次日 00:00 UTC 重置）。
- 前端：录题页「AI: suggest tags + summary」「Improve with AI」均为**点击触发**，不自动花钱；视觉调用前服务端降采样+灰度（长边≤1024、JPEG）。
- 后端 token 计数：`GET /ai/usage` 看今日 `total_tokens / request_count / limit`。