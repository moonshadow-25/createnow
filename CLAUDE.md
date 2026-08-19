# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# CreateNow 项目指南

AI 短视频生成平台，单仓库：FastAPI 后端 + React 前端。开发环境为 Windows，Python 环境内置在仓库根目录 `env\`（venv），不要使用系统 Python。

## 常用命令

- 后端开发（热重载）：`cd backend && set PYTHONPATH=%CD% && ..\env\python.exe -m app.main_dev`（默认端口 8501）
- 后端生产（高并发，无热重载）：`..\env\python.exe -m app.main_prod`
- 一键启动（生产，同时提供 API 与 `frontend/dist` 静态文件，端口 8508，启动时自动生成 SSL 证书）：根目录 `start.bat`
- 前端开发：`cd frontend && npm run dev`（端口 5173，API 请求指向 `http://localhost:8501/api`）
- 前端构建验证：`cd frontend && npm run build`（tsc + vite build）——**修改前端代码后必须构建通过再汇报完成**
- 后端测试：`backend\` 根目录的 `test_*.py` 独立脚本，用 `..\env\python.exe test_xxx.py` 直接运行（非 pytest，无统一测试框架）
- 发布打包：根目录 `build-release.bat`（自动递增 `version.json` → 构建前端 → 打 zip）
- SaaS 部署：根目录 `start-server.bat`（本地 8501 + SSH 反向隧道至公网服务器）

## 架构

### 后端 `backend/`

- FastAPI 应用在 `backend/app/`。生产入口 `app/main.py`（加 `--serve-frontend` 同时服务 `/api/*` 与前端静态文件）；`app/main_dev.py`（热重载）与 `app/main_prod.py`（高并发）通过 `python -m` 启动。
- 分层：`app/api/` 路由层（projects / assets / materials / conversation / generation / silicon_platform 等 router）→ `app/services/` 业务逻辑层（`*_service.py`）。
- AI 厂商以适配器接入：`app/services/ai/adapters/`（openai、dashscope、byteseed、byteseed_image、createnow、local），`base.py` 定义统一接口；聚合调用在 `app/services/ai/`（llm / image / video）。
- 硅星人平台 SDK：`app/services/silicon_sdk/client.py`；官方视频 API 协议见 `api/createnow-official-video-api.md`。
- 提示词以目录存放于 `app/prompts/<名称>/`（内为 `.md` 文件），经 `get_prompt_content()`（`global_prompt_service.py`）加载；可编辑的提示词预设配置在 `data/config/global.json`。
- 工具调用：OpenAI 原生 Function Calling（`tools=` 参数），工具 JSON schema 集中在 `app/api/tools/`（definitions.py 及分域文件）。
- 配置：`app/core/config.py`（pydantic-settings，根目录 `.env`）。`DEPLOY_MODE`：`selfhosted`（默认）| `saas`（启用 Redis、按用户分数据目录）。

### 前端 `frontend/`

React 18 + Vite 5 + TypeScript + Zustand + Tailwind。页面在 `src/pages/`，状态在 `src/store/`（zustand），API 封装在 `src/services/api.ts`（dev 指向 `localhost:8501/api`，生产用相对路径 `/api`；拦截器注入 JWT）。`version.json` 由构建脚本递增，vite 构建时注入为 `__APP_VERSION__`。

### 数据

`data/` 为数据根目录（本机开发环境是到 `C:/createnow_dist/data` 的符号链接）：项目数据在 `data/projects/`，全局配置在 `data/config/`。

## 项目规则

## 工具调用

本项目使用 OpenAI 原生 Function Calling（`tools=` 参数），LLM 通过 JSON schema 定义的工具直接发起函数调用。

- **禁止在提示词中手写 TOOL:/END_TOOL 格式**。这是史前遗留的虚拟 function call 做法，本项目已全面切换到原生 tools 注入。
- 工具参数 schema 由 `tools=` 注入，无需在提示词中复述；提示词只描述跨工具规则、工作流编排、行为约束。
- 工具描述（原 `conversation_tools_desc`）已合并进 `conversation_system_prompt`，不再存在独立的 tools_desc 文件——不要创建或引用它。

## 对话系统提示词职责

| 文件 | 职责 |
|------|------|
| `app/prompts/conversation_system_prompt/` | AI 角色 + 铁律（违反则系统崩溃）+ 跨工具规则/工作流/行为约束 |

## 代码组织要求

- 单个源代码文件行数不得超过 1500 行。
- 如果发现现有文件或计划修改后的文件会超过 1500 行，必须主动提示用户应拆分或重构，并说明推荐拆分方向。
- 自己编写代码时必须提前规划模块边界、组件拆分和职责划分，避免新增或继续扩大超过 1500 行的文件。

## 提交与验证要求

- 完成功能、修复或其他代码改动后，必须立即提交 git commit，不要等待额外提醒。
- 提交信息使用中文，遵循 `feat:` / `fix:` / `refactor:` / `chore:` 前缀惯例。
- 修改前端代码后，必须至少执行前端构建验证（如 `npm run build`）再汇报完成。
