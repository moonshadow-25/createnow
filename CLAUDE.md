# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CreateNow is an AI-powered short video generation platform that helps users create and manage video assets through conversational AI interaction. Users can describe their ideas naturally, and the system automatically extracts and organizes assets (characters, scenes, props), generates images, creates storyboards, and produces final videos.

**Tech Stack:**
- **Backend**: Python 3.10+ with FastAPI, file-based JSON storage (no database)
- **Frontend**: React 18 + TypeScript with Vite, Zustand for state management, Tailwind CSS
- **Architecture**: REST API with WebSocket for streaming, OpenAI-compatible API integrations

## Development Commands

### IMPORTANT: Conda Environment
**This project uses a conda virtual environment named `createnow`**

When starting the backend, you MUST activate the conda environment first:

```bash
# Windows
conda activate createnow
cd backend
python -m app.main

# Or use the provided script
start.bat
```

### Quick Start (Recommended)
Use the provided scripts for initial setup:
- Windows: `install.bat` then `start.bat`
- Mac/Linux: `./install.sh` then `./start.sh`

### Backend (Python/FastAPI)
```bash
# MUST activate conda environment first!
conda activate createnow

cd backend
pip install -r requirements.txt
cp .env.example .env  # Configure API keys
python -m app.main
# Runs on http://localhost:8001
# API docs at http://localhost:8001/docs
```

### Frontend (Node.js/React)
```bash
cd frontend
npm install
npm run dev       # Development server on http://localhost:5173
npm run build     # Production build (runs TypeScript check + Vite build)
```

## Architecture

### File-Based Data Storage

The application uses **no database** - all data is stored as JSON files in a structured directory hierarchy:

```
data/
├── projects/
│   ├── {project_id}/
│   │   ├── episodes/      # Episode scripts
│   │   ├── characters/    # Character data
│   │   ├── scenes/        # Scene data
│   │   ├── props/         # Prop data
│   │   ├── storyboards/   # Storyboard data
│   │   ├── videos/        # Generated videos
│   │   ├── images/        # Generated images
│   │   └── metadata.json  # Project metadata + AI config
│   └── ...
└── config/
    └── global.json        # Global configuration
```

### Backend Structure (`backend/app/`)

**API Layer** (`/app/api/`): REST endpoints for each domain
- `projects.py` - Project CRUD
- `assets.py` - Asset management (characters, scenes, props)
- `conversation.py` - WebSocket chat for conversational creation
- `storyboards.py` - Storyboard management
- `generation.py` - Image/video generation endpoints

**Services Layer** (`/app/services/`): Business logic
- `ai_service.py` - OpenAI-compatible API integrations (LLM, image, video)
- `asset_service.py` - Asset CRUD operations with file storage
- `prompt_service.py` - AI prompt engineering utilities

**Models** (`/app/models/`): Pydantic models defining data structures
- `project.py` - Project, Asset, Character, Scene, Prop, Episode, Storyboard, ImageGeneration, VideoGeneration

**Configuration** (`/app/core/config.py`): Environment-based settings
- API URLs/keys for LLM, image generation, video generation
- File storage paths
- CORS settings

### Frontend Structure (`frontend/src/`)

**State Management** (`/store/`): Zustand stores
- `projectStore.ts` - Project state and operations
- `assetStore.ts` - Asset state management

**Services** (`/services/`):
- `api.ts` - Axios HTTP client with organized API methods
- `chat.ts` - WebSocket chat service for streaming

**Pages** (`/pages/`):
- `HomePage.tsx` - Project listing and creation
- `ProjectPage.tsx` - Main project workspace with tabs (Chat, Assets, Storyboard)

### Key Architectural Patterns

1. **Asset Inheritance**: Characters and scenes support `parent_id` for creating variants (e.g., same character in different costumes) while maintaining relationship to parent asset.

2. **Episode-Based Asset Management**: Episodes bind scripts, while characters/scenes/props are shared across episodes in a common asset pool.

3. **Image Generation Workflow**:
   - Generate multiple image options per asset
   - User selects primary image (`is_primary: true`)
   - All generated images preserved for re-selection

4. **Storyboard to Video Pipeline**:
   - Storyboards link to characters, scenes, props, and episodes
   - Generate storyboard images first
   - Use storyboard's primary image to generate final video

5. **Per-Project AI Configuration**: Each project can override default AI APIs (LLM, image, video) configured in `.env`, enabling different API providers per project.

6. **Streaming Responses**: Chat endpoints use WebSocket (`/projects/{id}/chat`) for real-time streaming of AI responses and thinking process.

### API Configuration

All APIs use OpenAI-compatible format. Configure in `backend/.env`:

```env
# LLM (chat, script analysis, prompt generation)
DEFAULT_LLM_API_URL=https://api.openai.com/v1
DEFAULT_LLM_API_KEY=sk-xxx
DEFAULT_LLM_MODEL=gpt-4

# Text-to-Image (character, scene, prop images)
DEFAULT_IMAGE_API_URL=https://api.openai.com/v1
DEFAULT_IMAGE_API_KEY=sk-xxx
DEFAULT_IMAGE_MODEL=dall-e-3

# Image-to-Video (storyboard to video)
DEFAULT_VIDEO_API_URL=https://api.openai.com/v1
DEFAULT_VIDEO_API_KEY=sk-xxx
DEFAULT_VIDEO_MODEL=sora
```

Projects can override these defaults via their AI config in `metadata.json`.

### Working with Assets

When modifying asset logic:
- **Character/Scene inheritance**: Respect `parent_id` relationships - child assets should inherit parent's settings but allow overrides
- **Image selection**: Each asset has one `image_id` pointing to the primary image; always update this when user changes selection
- **File operations**: Use the services layer (`asset_service.py`) for all file operations - never manipulate JSON files directly in API routes

### WebSocket Chat Flow

The chat system (`/app/api/conversation.py`) handles conversational asset creation:
1. Receives user message via WebSocket
2. Calls LLM with conversation context
3. Streams response back in real-time
4. Extracts assets (characters, scenes, props) from LLM response
5. Creates asset files and returns to frontend

## Common Patterns

- **Creating new API endpoints**: Add router to `/app/api/`, register in `main.py`, create corresponding service method
- **Adding new asset types**: Extend models in `/app/models/project.py`, add CRUD methods in `asset_service.py`, add API routes
- **Frontend state updates**: Use Zustand store actions; avoid direct state mutations outside stores
- **Error handling**: Backend returns structured error responses; frontend handles via axios interceptors if needed

## Frontend-Backend Component Mapping

### 1. Chat Module (对话模块)
**Frontend:** `components/chat/` - ChatTab, MessageList, MessageBubble, ChatInput
**Backend:** `api/conversation.py` - POST `/projects/{id}/conversation` (WebSocket), POST `/upload-script`

### 2. Script Module (剧本模块)
**Frontend:** `components/script/` - ScriptTab, ScriptImportModal, SceneCard, ScriptCharacterPanel
**Backend:** `api/scripts.py` - CRUD `/projects/{id}/scripts`, episodes, scenes, lines, characters

### 3. Assets Module (资产模块)
**Frontend:** `components/assets/` - AssetsTab, AssetCard, CreateAssetDialog, ImageGallery, ImageEditDialog
**Backend:** `api/assets.py` - CRUD `/projects/{id}/assets/{type}/{id}`, children variants

### 4. Storyboard Module (分镜模块)
**Frontend:** `components/storyboard/` - StoryboardTab, StoryboardDetail, VideoGenerateDialog, VideoGallery
**Backend:** `api/storyboards.py` - CRUD `/projects/{id}/storyboards`, generate, renumber, reorder

### 5. Generation Module (生成模块)
**Backend:** `api/generation.py` - `/projects/{id}/generate/`
- Image: `/image-prompt`, `/image`, `/image-edit`, `/images/{asset_id}`, `/images/upload`, `/images/{id}/set-primary`
- Video: `/video-prompt`, `/video`, `/videos`, `/videos/{id}`, `/videos/{id}/poll`, `/videos/{id}/set-primary`
- Batch: `/images/download-all`, `/videos/download-all`, `/videos/export`

### 6. Settings Module (设置模块)
**Frontend:** `components/settings/` - SettingsModal, ApiConfigPanel, PromptPanel, LogsPanel
**Backend:** `api/generation.py` - `/prompt-templates` (GET/PUT/reset), `/ai-logs` (GET/DELETE)
**Backend:** `api/validation.py` - `/validate/llm`, `/validate/image`, `/validate/video`

### 7. Project Management (项目管理)
**Frontend:** `pages/HomePage.tsx` (project list), `pages/ProjectPage.tsx` (workspace)
**Backend:** `api/projects.py` - CRUD `/projects`, `/projects/{id}`

## Key Data Flows

1. **Conversational Asset Creation**: User message → WebSocket → LLM → Extract assets → Create JSON files → Return to frontend
2. **Image Generation**: Asset → Generate prompt → Call image API → Download → Save to `images/files/{type}/` → Update metadata
3. **Video Generation**: Storyboard → Generate prompt → Call video API → Poll status → Download → Save to `videos/`
4. **Image Upload**: Local file → Upload → Save to `images/files/{type}/` → Create record with `local_path`

## Important Technical Notes

- **Image Storage**: All images saved to `images/files/{asset_type}/{filename}`, with `local_path` field storing `{asset_type}/{filename}`
- **Video Polling**: VideoGallery uses `useRef` + `useEffect` pattern to avoid React closure trap in polling intervals
- **Primary Selection**: Each asset/storyboard has one `image_id` pointing to primary image; videos have `is_primary` flag
- **Asset Variants**: Use `parent_id` to create child assets that inherit parent properties
- **Auto-Polling**: Video library polls pending videos every 30 seconds, with immediate first poll on mount
