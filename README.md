# AI短片生成软件

[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

基于AI的短片创作和管理平台。

## 功能特性

- 对话式创作：通过自然对话生成剧本、角色、场景、道具等资产
- 剧本解析：自动从完整剧本中提取角色、场景、道具
- 资产管理：按剧集管理资产，支持角色/场景的继承和复用
- AI图片生成：自动生成优化的文生图提示词
- 分镜管理：创建和管理分镜，关联角色、场景、道具
- AI视频生成：根据分镜生成视频
- 项目管理：支持多项目管理
- 配置灵活：支持OpenAI兼容的各种LLM、文生图、图生视频API

## 技术栈

### 后端
- Python 3.10+
- FastAPI
- httpx（异步HTTP客户端）
- 文件存储（无需数据库）

### 前端
- Node.js 18+
- React 18
- TypeScript
- Vite
- Tailwind CSS
- Zustand（状态管理）

## 安装运行

### 后端

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# 编辑 .env 文件，配置API密钥
python -m app.main
```

后端将运行在 http://localhost:8000

### 前端

```bash
cd frontend
npm install
npm run dev
```

前端将运行在 http://localhost:5173

## 项目结构

```
createnow/
├── backend/              # Python后端
│   ├── app/
│   │   ├── api/         # API路由
│   │   ├── core/        # 配置
│   │   ├── models/      # 数据模型
│   │   ├── services/    # 业务逻辑
│   │   └── main.py      # 应用入口
│   └── requirements.txt
├── frontend/            # Node.js前端
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── hooks/
│   │   ├── store/
│   │   └── types/
│   └── package.json
└── data/               # 文件存储
    ├── projects/
    └── config/
```

## 使用说明

1. 创建项目
2. 通过对话描述你的创意，AI会提取并创建资产
3. 或上传完整剧本，系统自动解析提取资产
4. 在资产管理中查看和组织角色、场景、道具
5. 为资产生成图片
6. 创建分镜并关联资产
7. 生成分镜图片
8. 最终生成视频

## 配置说明

在项目的AI配置中，可以设置：
- LLM API：用于对话、资产提取、提示词生成
- 文生图API：用于生成角色、场景、道具图片
- 图生视频API：用于根据分镜图生成视频

所有API都使用OpenAI兼容格式。

## 许可证

本项目采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 协议。

**这意味着您可以：**
- ✅ 自由分享和修改本项目
- ✅ 用于学习和研究

**但必须遵守：**
- ⚠️ 署名：必须注明原作者
- ⚠️ 非商业性使用：不得用于商业目的
- ⚠️ 相同方式共享：修改后的作品必须使用相同协议

详见 [LICENSE](LICENSE) 文件。

