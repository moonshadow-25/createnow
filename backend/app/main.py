import sys
# Windows 兼容：强制 stdout/stderr 使用 UTF-8，遇到无法编码字符时替换为 ? 而非崩溃
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
import logging
from pathlib import Path

# 配置日志 - 显示所有级别的日志
logging.basicConfig(
    level=logging.DEBUG,
    format='[%(levelname)s] %(name)s: %(message)s'
)
# 压制第三方库的 DEBUG 噪音
for _noisy in ("hpack", "h11", "h2", "asyncio", "hypercorn.access", "multipart"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

# 添加 backend 目录到 sys.path，确保能找到 app 模块
BACKEND_DIR = Path(__file__).parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
import re

from app.core.config import settings
from app.core.context import set_current_project_id, set_current_data_root
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
from app.api.global_prompts import router as global_prompts_router
from app.api.version import router as version_router
from app.api.auth import router as auth_router
from app.api.admin_auth import router as admin_auth_router
from app.api.user_auth import router as user_auth_router
from app.api.full_script import router as full_script_router

def _ensure_ssl_cert():
    """启动时自动生成自签名证书（若不存在），有效期 10 年"""
    ssl_dir = BACKEND_DIR / ".ssl"
    cert_file = ssl_dir / "cert.pem"
    key_file = ssl_dir / "key.pem"
    if cert_file.exists() and key_file.exists():
        return str(cert_file), str(key_file)
    ssl_dir.mkdir(exist_ok=True)
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    import datetime
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject).issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.utcnow())
        .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=3650))
        .add_extension(x509.SubjectAlternativeName([
            x509.DNSName("localhost"), x509.IPAddress(__import__("ipaddress").ip_address("127.0.0.1"))
        ]), critical=False)
        .sign(key, hashes.SHA256())
    )
    cert_file.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_file.write_bytes(key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption()
    ))
    print(f"[INFO] 已生成自签名证书: {ssl_dir}")
    return str(cert_file), str(key_file)


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
    print(f"Deploy mode: {settings.DEPLOY_MODE}")
    # 初始化全局提示词 JSON（首次启动时从代码常量生成）
    from app.services.global_prompt_service import load_global_prompts, save_global_prompts, _get_json_path
    json_path = _get_json_path()
    if not json_path.exists():
        print("[INFO] 生成 default_prompt_templates.json ...")
        data = load_global_prompts()
        save_global_prompts(data)
        print(f"[INFO] 已创建: {json_path}")
    else:
        load_global_prompts()  # 预热缓存
    # selfhosted 模式：初始化默认管理员账号
    if settings.DEPLOY_MODE == "selfhosted":
        from app.services.user_service import ensure_default_admin
        ensure_default_admin()
    # saas 模式：初始化 Redis 连接
    if settings.DEPLOY_MODE == "saas":
        from app.core.redis_client import get_redis
        await get_redis()
        settings.USERS_DIR.mkdir(parents=True, exist_ok=True)
    yield
    # 关闭时
    if settings.DEPLOY_MODE == "saas":
        from app.core.redis_client import close_redis
        await close_redis()
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


# ==================== 项目上下文中间件 ====================
class ProjectContextMiddleware(BaseHTTPMiddleware):
    """自动提取 URL 中的 project_id 并注入到上下文中"""

    async def dispatch(self, request: Request, call_next):
        # 提取 URL 路径中的 project_id
        path = request.url.path
        # 匹配 /api/projects/{project_id}/... 格式
        match = re.match(r'/api/projects/([^/]+)/', path)
        if match:
            project_id = match.group(1)
            set_current_project_id(project_id)

        # SaaS 模式：将用户数据根目录注入到 context（供 asset_service 使用）
        if settings.DEPLOY_MODE == "saas":
            data_root = getattr(request.state, "saas_data_root", None)
            set_current_data_root(data_root)
        else:
            set_current_data_root(None)

        response = await call_next(request)
        return response


# 注册项目上下文中间件
app.add_middleware(ProjectContextMiddleware)


# ==================== 管理员认证中间件 ====================
class AdminAuthMiddleware(BaseHTTPMiddleware):
    """验证所有 /api/ 路由（白名单除外）必须携带有效的管理员 JWT"""

    # 无需 token 即可访问的路径前缀 / 完整路径
    _WHITELIST_PREFIXES = (
        "/api/admin/login",
        "/api/auth/",
        "/api/user/auth/",
        "/api/user/logout",
        "/api/health",
        "/api/config",
    )
    # 图片/视频/音频直接访问路径（<img src> / <video src> / <audio src> 无法携带 token）
    _WHITELIST_CONTAINS = (
        "/images/files/",
        "/images/thumbnails/",
        "/thumbnails/",
        "/videos/files/",
        "/audios/files/",
        "/generate/audios/",
        "/generate/media/files/",
    )

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        method = request.method

        # 放行：OPTIONS 预检
        if method == "OPTIONS":
            return await call_next(request)

        # 放行：非 /api/ 路径
        if not path.startswith("/api/"):
            return await call_next(request)

        # 放行：白名单（路径前缀）
        for prefix in self._WHITELIST_PREFIXES:
            if path.startswith(prefix):
                return await call_next(request)

        # 放行：图片访问路径（img src 无法携带 token）
        for substr in self._WHITELIST_CONTAINS:
            if substr in path:
                return await call_next(request)

        # 验证 Bearer token
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            from starlette.responses import JSONResponse
            return JSONResponse(
                status_code=401,
                content={"detail": "Not authenticated"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        token = auth_header[len("Bearer "):]
        from app.core.security import decode_access_token
        payload = decode_access_token(token)
        if not payload:
            from starlette.responses import JSONResponse
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or expired token"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        # 项目级授权：子账号仅可访问 assigned_project_ids
        if payload.get("role") == "user":
            project_match = re.match(r"^/api/projects/([^/]+)(?:/|$)", path)
            if project_match:
                project_id = project_match.group(1)
                from app.services.user_service import get_user_by_username
                user = get_user_by_username(payload.get("sub", ""))
                allowed = set((user or {}).get("assigned_project_ids") or [])
                if project_id not in allowed:
                    from starlette.responses import JSONResponse
                    return JSONResponse(
                        status_code=403,
                        content={"detail": "无权访问该项目"},
                    )

        request.state.admin_user = payload  # {"sub": "username", "role": "admin"}
        return await call_next(request)


if settings.DEPLOY_MODE != "saas":
    app.add_middleware(AdminAuthMiddleware)


# ==================== SaaS 用户认证中间件 ====================
class SaasAuthMiddleware(BaseHTTPMiddleware):
    """
    SaaS 模式下的用户鉴权中间件（DEPLOY_MODE=saas）。

    - 解析 SaaS JWT，注入 request.state.saas_user 和 request.state.saas_data_root
    - data_root 指向该用户的数据目录：data/users/{user_id}/
    - /api/user/auth/poll 白名单（登录流程）
    - /api/auth/ 白名单（设备注册，兼容保留）
    - 媒体文件路径白名单（img/video src 无法携带 token）
    """
    _WHITELIST_PREFIXES = (
        "/api/user/auth/",
        "/api/auth/",
        "/api/health",
        "/api/config",
    )
    _WHITELIST_CONTAINS = (
        "/images/files/",
        "/images/thumbnails/",
        "/thumbnails/",
        "/videos/files/",
        "/audios/files/",
        "/generate/audios/",
        "/generate/media/files/",
    )

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        method = request.method

        if method == "OPTIONS":
            return await call_next(request)
        if not path.startswith("/api/"):
            return await call_next(request)
        for prefix in self._WHITELIST_PREFIXES:
            if path.startswith(prefix):
                return await call_next(request)
        for substr in self._WHITELIST_CONTAINS:
            if substr in path:
                return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            from starlette.responses import JSONResponse
            return JSONResponse(
                status_code=401,
                content={"detail": "Not authenticated"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        token = auth_header[len("Bearer "):]
        from app.core.saas_security import decode_saas_token
        from app.services.user_saas_service import get_session_user_id, get_user_by_id

        payload = decode_saas_token(token)
        if not payload:
            from starlette.responses import JSONResponse
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or expired token"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        # 验证 Session 是否已被撤销
        jti = payload.get("jti", "")
        user_id = await get_session_user_id(jti)
        if not user_id:
            from starlette.responses import JSONResponse
            return JSONResponse(
                status_code=401,
                content={"detail": "Session revoked or expired"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        user = await get_user_by_id(user_id)
        if not user:
            from starlette.responses import JSONResponse
            return JSONResponse(status_code=401, content={"detail": "User not found"})

        # 注入用户信息和数据根路径
        request.state.saas_user = user
        request.state.saas_token_payload = payload
        request.state.saas_data_root = settings.USERS_DIR / user_id

        return await call_next(request)


if settings.DEPLOY_MODE == "saas":
    app.add_middleware(SaasAuthMiddleware)


async def _get_project_dir_saas(project_id: str) -> Path:
    """SaaS 模式下通过 project_id 反查 Redis 找到用户数据根路径"""
    from app.core.redis_client import get_redis
    r = await get_redis()
    user_id = await r.get(f"project_owner:{project_id}")
    if user_id:
        return settings.USERS_DIR / user_id / "projects" / project_id
    # 兜底：遍历 data/users/ 目录查找（用于历史项目）
    users_dir = settings.USERS_DIR
    if users_dir.exists():
        for user_dir in users_dir.iterdir():
            candidate = user_dir / "projects" / project_id
            if candidate.exists():
                # 补写索引，下次直接命中
                await r.set(f"project_owner:{project_id}", user_dir.name)
                return candidate
    return settings.PROJECTS_DIR / project_id


def _get_project_dir(request: Request, project_id: str) -> Path:
    """根据部署模式返回项目目录路径"""
    if settings.DEPLOY_MODE == "saas":
        data_root = getattr(request.state, "saas_data_root", None)
        if data_root:
            return Path(data_root) / "projects" / project_id
    return settings.PROJECTS_DIR / project_id


# ==================== 本地图片访问路由 ====================
# 注意：此路由在API路由注册前定义，用于直接访问本地下载的图片文件

@app.get("/api/projects/{project_id}/images/files/{asset_type}/{filename}")
async def get_local_image(request: Request, project_id: str, asset_type: str, filename: str):
    """获取本地下载的图片文件"""
    project_dir = _get_project_dir(request, project_id)
    image_path = project_dir / "images" / "files" / asset_type / filename
    if not image_path.exists() and settings.DEPLOY_MODE == "saas":
        project_dir = await _get_project_dir_saas(project_id)
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


@app.get("/api/projects/{project_id}/audios/files/{filename}")
async def get_local_audio(request: Request, project_id: str, filename: str):
    """获取本地下载的音频文件"""
    project_dir = _get_project_dir(request, project_id)
    audio_path = project_dir / "audios" / "files" / filename
    if not audio_path.exists() and settings.DEPLOY_MODE == "saas":
        project_dir = await _get_project_dir_saas(project_id)
        audio_path = project_dir / "audios" / "files" / filename

    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")

    # 根据扩展名确定媒体类型
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else 'mp3'
    media_type = {
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'opus': 'audio/opus',
        'aac': 'audio/aac',
        'flac': 'audio/flac',
        'ogg': 'audio/ogg'
    }.get(ext, 'audio/mpeg')

    return FileResponse(
        audio_path,
        media_type=media_type,
        headers={
            "Cache-Control": "public, max-age=31536000",  # 缓存1年
        }
    )


@app.get("/api/projects/{project_id}/thumbnails/{asset_type}/{filename}")
async def get_thumbnail(request: Request, project_id: str, asset_type: str, filename: str):
    """获取缩略图（自动生成，短边360px）

    Args:
        project_id: 项目ID
        asset_type: 资产类型（character/scene/prop/storyboard等）
        filename: 文件名

    Returns:
        缩略图文件（JPEG格式，短边360px，质量75%）
    """
    from PIL import Image

    project_dir = _get_project_dir(request, project_id)

    # 原图路径
    original_path = project_dir / "images" / "files" / asset_type / filename
    # SaaS 模式：若路径不含 saas_data_root（白名单请求），通过 Redis 反查
    if not original_path.exists() and settings.DEPLOY_MODE == "saas":
        project_dir = await _get_project_dir_saas(project_id)
        original_path = project_dir / "images" / "files" / asset_type / filename

    # 缩略图路径（与原图结构一致）
    thumbnail_path = project_dir / "images" / "thumbnails" / asset_type / filename

    # 如果缩略图已存在，直接返回
    if thumbnail_path.exists():
        return FileResponse(
            thumbnail_path,
            media_type="image/jpeg",
            headers={
                "Cache-Control": "public, max-age=31536000",  # 缓存1年
            }
        )

    # 检查原图是否存在
    if not original_path.exists():
        raise HTTPException(status_code=404, detail="Original image not found")

    # 生成缩略图
    try:
        thumbnail_path.parent.mkdir(parents=True, exist_ok=True)

        with Image.open(original_path) as img:
            # 获取原图尺寸
            width, height = img.size

            # 计算缩放比例：短边360px，长边按比例计算
            if width <= height:
                # 竖图或正方形：宽度为短边
                new_width = 360
                new_height = int(height * (360 / width))
            else:
                # 横图：高度为短边
                new_height = 360
                new_width = int(width * (360 / height))

            # 等比缩放
            img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)

            # 转换为RGB（处理RGBA、P模式等）
            if img.mode in ('RGBA', 'LA', 'P'):
                rgb_img = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                rgb_img.paste(img, mask=img.split()[-1] if img.mode in ('RGBA', 'LA') else None)
                img = rgb_img
            elif img.mode != 'RGB':
                img = img.convert('RGB')

            # 保存为JPEG，质量75%
            img.save(thumbnail_path, 'JPEG', quality=75, optimize=True)

        # 返回生成的缩略图
        return FileResponse(
            thumbnail_path,
            media_type="image/jpeg",
            headers={
                "Cache-Control": "public, max-age=31536000",  # 缓存1年
            }
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate thumbnail: {str(e)}")


# ==================== 本地视频访问路由 ====================
# 用于直接访问本地下载的视频文件

@app.get("/api/projects/{project_id}/videos/files/{filename}")
async def get_local_video(request: Request, project_id: str, filename: str):
    """获取本地下载的视频文件"""
    project_dir = _get_project_dir(request, project_id)
    video_path = project_dir / "videos" / "files" / filename
    if not video_path.exists() and settings.DEPLOY_MODE == "saas":
        project_dir = await _get_project_dir_saas(project_id)
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


@app.get("/api/projects/{project_id}/videos/thumbnails/{filename}")
async def get_video_thumbnail(request: Request, project_id: str, filename: str):
    """获取视频首帧缩略图"""
    project_dir = _get_project_dir(request, project_id)
    thumb_path = project_dir / "videos" / "thumbnails" / filename
    if not thumb_path.exists() and settings.DEPLOY_MODE == "saas":
        project_dir = await _get_project_dir_saas(project_id)
        thumb_path = project_dir / "videos" / "thumbnails" / filename

    if not thumb_path.exists():
        raise HTTPException(status_code=404, detail="Video thumbnail not found")

    return FileResponse(
        thumb_path,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "public, max-age=31536000",
        }
    )


@app.get("/api/projects/{project_id}/generate/media/files/{filename}")
async def get_local_media(request: Request, project_id: str, filename: str):
    """获取上传的参考视频/音频文件"""
    project_dir = _get_project_dir(request, project_id)
    media_path = project_dir / "generate" / "media" / filename
    if not media_path.exists() and settings.DEPLOY_MODE == "saas":
        project_dir = await _get_project_dir_saas(project_id)
        media_path = project_dir / "generate" / "media" / filename

    if not media_path.exists():
        raise HTTPException(status_code=404, detail="Media file not found")

    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    media_type_map = {
        'mp4': 'video/mp4', 'webm': 'video/webm',
        'mov': 'video/quicktime', 'avi': 'video/x-msvideo',
        'mp3': 'audio/mpeg', 'wav': 'audio/wav',
        'm4a': 'audio/mp4', 'ogg': 'audio/ogg', 'aac': 'audio/aac',
    }
    return FileResponse(media_path, media_type=media_type_map.get(ext, 'application/octet-stream'))


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


@app.head("/")
async def root_head():
    from fastapi.responses import Response
    return Response(status_code=200)


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
app.include_router(global_prompts_router, prefix="/api")
app.include_router(version_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(admin_auth_router, prefix="/api")
app.include_router(user_auth_router, prefix="/api")
app.include_router(full_script_router, prefix="/api")


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
    import asyncio
    from hypercorn.config import Config
    from hypercorn.asyncio import serve

    ssl_certfile, ssl_keyfile = _ensure_ssl_cert()

    print("="*60)
    print("启动模式: 生产环境（HTTP/2 + HTTPS）")
    print("="*60)
    print("[OK] 高性能配置：")
    print("   - 协议：HTTP/2（hypercorn）")
    print("   - HTTPS：自签名证书")
    print("   - 热重载：关闭")
    print("\n如需开发模式（热重载），请运行:")
    print("   cd backend && ../env/python.exe -m app.main_dev")
    print("="*60 + "\n")

    config = Config()
    config.bind = [f"{settings.API_HOST}:{settings.API_PORT}"]
    config.certfile = ssl_certfile
    config.keyfile = ssl_keyfile
    config.keep_alive_timeout = 120
    config.worker_class = "asyncio"

    asyncio.run(serve(app, config))
