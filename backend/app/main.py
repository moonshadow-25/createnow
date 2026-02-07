import sys
import logging
from pathlib import Path

# 配置日志 - 显示所有级别的日志
logging.basicConfig(
    level=logging.DEBUG,
    format='[%(levelname)s] %(name)s: %(message)s'
)

# 添加 backend 目录到 sys.path，确保能找到 app 模块
BACKEND_DIR = Path(__file__).parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager

from app.core.config import settings
from app.api import (
    projects_router,
    assets_router,
    conversation_router,
    generation_router
)
from app.api.storyboards import router as storyboards_router
from app.api.videos import router as videos_router
from app.api.validation import router as validation_router
from app.api.scripts import router as scripts_router
from app.api.canvas import router as canvas_router

# 检查启动参数：--serve-frontend 表示同时服务前端静态文件
SERVE_FRONTEND = "--serve-frontend" in sys.argv

# 前端构建产物目录
FRONTEND_DIST = Path(__file__).parent.parent.parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时
    print(f"Data directory: {settings.DATA_DIR}")
    print(f"Projects directory: {settings.PROJECTS_DIR}")
    yield
    # 关闭时
    print("Application shutting down...")


# 创建FastAPI应用
app = FastAPI(
    title="AI短片生成软件",
    description="AI Short Video Generation Platform",
    version="1.0.3",  # Bump version to trigger reload
    lifespan=lifespan
)

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== 本地图片访问路由 ====================
# 注意：此路由在API路由注册前定义，用于直接访问本地下载的图片文件

@app.get("/api/projects/{project_id}/images/files/{asset_type}/{filename}")
async def get_local_image(project_id: str, asset_type: str, filename: str):
    """获取本地下载的图片文件"""
    project_dir = settings.PROJECTS_DIR / project_id
    image_path = project_dir / "images" / "files" / asset_type / filename

    if not image_path.exists():
        raise HTTPException(status_code=404, detail="Image file not found")

    # 根据扩展名确定媒体类型
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else 'png'
    media_type = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'webp': 'image/webp',
        'gif': 'image/gif'
    }.get(ext, 'image/png')

    return FileResponse(
        image_path,
        media_type=media_type,
        headers={
            "Cache-Control": "public, max-age=31536000",  # 缓存1年
        }
    )


# ==================== 本地视频访问路由 ====================
# 用于直接访问本地下载的视频文件

@app.get("/api/projects/{project_id}/videos/files/{filename}")
async def get_local_video(project_id: str, filename: str):
    """获取本地下载的视频文件"""
    project_dir = settings.PROJECTS_DIR / project_id
    video_path = project_dir / "videos" / "files" / filename

    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")

    # 根据扩展名确定媒体类型
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else 'mp4'
    media_type = {
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'mov': 'video/quicktime',
        'avi': 'video/x-msvideo'
    }.get(ext, 'video/mp4')

    return FileResponse(
        video_path,
        media_type=media_type,
        headers={
            "Cache-Control": "public, max-age=31536000",  # 缓存1年
        }
    )


@app.get("/")
async def root():
    """根路径"""
    if SERVE_FRONTEND and FRONTEND_DIST.exists():
        return FileResponse(FRONTEND_DIST / "index.html")
    return {
        "status": "ok",
        "message": "AI Short Video Generation API is running",
        "version": "1.0.3",
        "mode": "production" if SERVE_FRONTEND else "development"
    }


@app.get("/api/health")
async def health():
    """API健康检查"""
    return {"status": "healthy", "version": "1.0.3", "mode": "production" if SERVE_FRONTEND else "development"}


# ==================== 注册路由 ====================
# 所有API路由使用 /api 前缀（与前端API_BASE_URL一致）
app.include_router(projects_router, prefix="/api")
app.include_router(assets_router, prefix="/api")
app.include_router(conversation_router, prefix="/api")
app.include_router(generation_router, prefix="/api")
app.include_router(storyboards_router, prefix="/api")
app.include_router(videos_router, prefix="/api")
app.include_router(validation_router, prefix="/api")
app.include_router(scripts_router, prefix="/api")
app.include_router(canvas_router, prefix="/api")


# ==================== 前端静态文件服务 ====================
if SERVE_FRONTEND:
    if FRONTEND_DIST.exists():
        # 挂载静态资源目录 (JS, CSS, 图片等)
        app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

        @app.get("/{full_path:path}")
        async def serve_spa(full_path: str):
            """
            SPA 路由支持：
            - 非 /api 开头的路径都返回 index.html，让前端路由处理
            - /api 开头的路径由API路由处理器处理
            """
            # 排除 /api 路径
            if full_path.startswith("api/"):
                raise HTTPException(status_code=404, detail="API endpoint not found")

            # 检查是否是静态文件
            requested_file = FRONTEND_DIST / full_path
            if requested_file.exists() and requested_file.is_file():
                return FileResponse(requested_file)

            # 其他所有路径返回 index.html
            return FileResponse(FRONTEND_DIST / "index.html")

        print(f"[INFO] Frontend static files served from: {FRONTEND_DIST}")
        print("[INFO] Running in PRODUCTION mode - API + Frontend served by Python")
    else:
        print(f"[WARNING] Frontend dist directory not found at: {FRONTEND_DIST}")
        print("[WARNING] Running in API-only mode. Please run 'npm run build' in frontend directory first.")
else:
    print("[INFO] Running in DEVELOPMENT mode - API only (frontend served by npm dev)")
    print("[INFO] Start with --serve-frontend flag to serve frontend: python -m app.main --serve-frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.API_HOST,
        port=settings.API_PORT,
        reload=True
    )
