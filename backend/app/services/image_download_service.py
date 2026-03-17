"""图片下载服务 - 将外部图片下载到本地"""
import json
import aiohttp
import asyncio
import base64
from pathlib import Path
from typing import Dict, List, Optional, Callable, Union
from datetime import datetime
import uuid

from app.core.config import settings
from app.services import ImageService


class ImageDownloadService:
    """图片下载服务"""

    # 下载状态存储（内存中，用于跟踪进度）
    _download_tasks: Dict[str, Dict] = {}

    @staticmethod
    def get_images_dir(project_id: str) -> Path:
        """获取项目图片文件存储目录"""
        project_dir = settings.PROJECTS_DIR / project_id
        images_dir = project_dir / "images" / "files"
        images_dir.mkdir(parents=True, exist_ok=True)

        # 创建按类型分类的子目录
        for asset_type in ["character", "scene", "prop", "storyboard", "canvas_element"]:
            (images_dir / asset_type).mkdir(exist_ok=True)

        return images_dir

    @staticmethod
    def get_file_extension(url: str) -> str:
        """从URL获取文件扩展名"""
        url_lower = url.lower().split('?')[0]  # 去除查询参数
        if url_lower.endswith(('.png', '.jpg', '.jpeg', '.webp', '.gif')):
            return url_lower.rsplit('.', 1)[-1]
        # 默认使用 png
        return 'png'

    @staticmethod
    async def download_single_image(
        url: str,
        save_path: Path,
        timeout: int = 30
    ) -> bool:
        """下载单个图片"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout)) as response:
                    if response.status == 200:
                        content = await response.read()
                        save_path.write_bytes(content)
                        return True
                    return False
        except Exception as e:
            print(f"下载图片失败 {url}: {e}")
            return False

    @staticmethod
    def get_download_status(project_id: str) -> Dict:
        """获取项目的下载状态"""
        return ImageDownloadService._download_tasks.get(project_id, {
            "status": "idle",
            "total": 0,
            "downloaded": 0,
            "failed": 0,
            "current_image": "",
            "errors": []
        })

    @staticmethod
    def set_download_status(project_id: str, status: Dict):
        """设置项目的下载状态"""
        ImageDownloadService._download_tasks[project_id] = status

    @staticmethod
    async def download_all_images(
        project_id: str,
        progress_callback: Optional[Callable] = None
    ) -> Dict:
        """下载项目的所有图片

        Args:
            project_id: 项目ID
            progress_callback: 进度回调函数

        Returns:
            下载结果统计
        """
        # 初始化状态
        ImageDownloadService.set_download_status(project_id, {
            "status": "running",
            "total": 0,
            "downloaded": 0,
            "failed": 0,
            "current_image": "",
            "errors": [],
            "started_at": datetime.now().isoformat()
        })

        try:
            # 获取所有图片记录
            all_images = ImageService.list_images(project_id)

            # 过滤出有外部URL的图片
            images_to_download = [
                img for img in all_images
                if img.get("image_path") and img.get("image_path", "").startswith(("http://", "https://"))
            ]

            total = len(images_to_download)
            status = ImageDownloadService.get_download_status(project_id)
            status["total"] = total
            ImageDownloadService.set_download_status(project_id, status)

            if total == 0:
                status["status"] = "completed"
                ImageDownloadService.set_download_status(project_id, status)
                return {
                    "success": True,
                    "total": 0,
                    "downloaded": 0,
                    "failed": 0,
                    "message": "没有需要下载的图片"
                }

            images_dir = ImageDownloadService.get_images_dir(project_id)

            # 并发下载（限制并发数）
            semaphore = asyncio.Semaphore(5)  # 最多同时下载5个

            async def download_with_semaphore(image: Dict):
                async with semaphore:
                    image_id = image["image_id"]
                    asset_type = image.get("asset_type", "unknown")
                    url = image["image_path"]

                    # 更新当前状态
                    status = ImageDownloadService.get_download_status(project_id)
                    status["current_image"] = f"{asset_type}/{image_id[:8]}"
                    ImageDownloadService.set_download_status(project_id, status)

                    if progress_callback:
                        await progress_callback(status)

                    # 确定保存路径
                    ext = ImageDownloadService.get_file_extension(url)
                    filename = f"{image_id}.{ext}"
                    save_path = images_dir / asset_type / filename

                    # 如果文件已存在，跳过
                    if save_path.exists():
                        # 更新元数据
                        ImageDownloadService._update_image_metadata(project_id, image_id, f"{asset_type}/{filename}")
                        status = ImageDownloadService.get_download_status(project_id)
                        status["downloaded"] += 1
                        ImageDownloadService.set_download_status(project_id, status)
                        return {"image_id": image_id, "success": True, "skipped": True}

                    # 下载图片
                    success = await ImageDownloadService.download_single_image(url, save_path)

                    if success:
                        # 更新图片元数据
                        local_path = f"{asset_type}/{filename}"
                        ImageDownloadService._update_image_metadata(project_id, image_id, local_path)

                        status = ImageDownloadService.get_download_status(project_id)
                        status["downloaded"] += 1
                        ImageDownloadService.set_download_status(project_id, status)

                        if progress_callback:
                            await progress_callback(status)

                        return {"image_id": image_id, "success": True, "skipped": False}
                    else:
                        status = ImageDownloadService.get_download_status(project_id)
                        status["failed"] += 1
                        status["errors"].append(f"{image_id[:8]}: 下载失败")
                        ImageDownloadService.set_download_status(project_id, status)

                        if progress_callback:
                            await progress_callback(status)

                        return {"image_id": image_id, "success": False, "error": "下载失败"}

            # 执行所有下载任务
            results = await asyncio.gather(*[download_with_semaphore(img) for img in images_to_download])

            # 最终状态
            downloaded_count = sum(1 for r in results if r.get("success"))
            failed_count = sum(1 for r in results if not r.get("success"))

            status = ImageDownloadService.get_download_status(project_id)
            status["status"] = "completed"
            status["current_image"] = ""
            status["completed_at"] = datetime.now().isoformat()
            ImageDownloadService.set_download_status(project_id, status)

            return {
                "success": True,
                "total": total,
                "downloaded": downloaded_count,
                "failed": failed_count,
                "newly_downloaded": downloaded_count - sum(1 for r in results if r.get("skipped")),
                "errors": status["errors"][:10]  # 只返回前10个错误
            }

        except Exception as e:
            status = ImageDownloadService.get_download_status(project_id)
            status["status"] = "error"
            status["error"] = str(e)
            ImageDownloadService.set_download_status(project_id, status)

            return {
                "success": False,
                "error": str(e)
            }

    @staticmethod
    def _update_image_metadata(project_id: str, image_id: str, local_path: str):
        """更新图片元数据，添加本地路径"""
        project_dir = settings.PROJECTS_DIR / project_id
        file_path = project_dir / "images" / f"{image_id}.json"

        if file_path.exists():
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            data["local_path"] = local_path
            data["is_downloaded"] = True
            data["downloaded_at"] = datetime.now().isoformat()

            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

            # 同步更新内存缓存，避免下次请求仍返回旧的外链 URL
            from app.services.asset_service import _images_cache
            if project_id in _images_cache:
                cache = _images_cache[project_id]
                for i, img in enumerate(cache):
                    if img.get("image_id") == image_id:
                        cache[i] = data
                        break

    @staticmethod
    def get_local_image_path(project_id: str, image_id: str) -> Optional[str]:
        """获取图片的本地路径（如果已下载）"""
        image = ImageService.get_image(project_id, image_id)
        if image and image.get("local_path"):
            return image["local_path"]
        return None

    @staticmethod
    def get_download_statistics(project_id: str) -> Dict:
        """获取项目图片下载统计"""
        all_images = ImageService.list_images(project_id)

        total = len(all_images)
        downloaded = sum(1 for img in all_images if img.get("is_downloaded"))
        has_external_url = sum(1 for img in all_images if img.get("image_path") and img.get("image_path", "").startswith(("http://", "https://")))

        return {
            "total_images": total,
            "downloaded_images": downloaded,
            "external_images": has_external_url,
            "local_only_images": total - has_external_url,
            "download_progress": round(downloaded / has_external_url * 100, 1) if has_external_url > 0 else 100
        }

    @staticmethod
    async def download_and_save_image(
        project_id: str,
        image_id: str,
        url: str,
        asset_type: str = "character"
    ) -> bool:
        """
        下载单个图片并更新元数据（用于生成成功后自动下载）

        Args:
            project_id: 项目ID
            image_id: 图片ID
            url: 图片URL
            asset_type: 资产类型（character/scene/prop/storyboard）

        Returns:
            bool: 下载是否成功
        """
        try:
            # 1. 获取图片存储目录
            images_dir = ImageDownloadService.get_images_dir(project_id)

            # 2. 确定文件扩展名和保存路径
            ext = ImageDownloadService.get_file_extension(url)
            filename = f"{image_id}.{ext}"
            save_path = images_dir / asset_type / filename

            # 3. 下载图片
            success = await ImageDownloadService.download_single_image(url, save_path)

            if success:
                # 4. 更新元数据
                local_path = f"{asset_type}/{filename}"
                ImageDownloadService._update_image_metadata(project_id, image_id, local_path)
                print(f"[自动下载] 成功下载图片 {image_id}: {local_path}")
                return True
            else:
                print(f"[自动下载] 下载图片失败 {image_id}")
                return False

        except Exception as e:
            print(f"[自动下载] 下载图片时出错 {image_id}: {e}")
            return False

    @staticmethod
    def image_to_base64_url(image_path: Union[str, Path]) -> str:
        """
        将本地图片文件转换为base64 data URL格式

        Args:
            image_path: 图片文件路径（支持字符串或Path对象）

        Returns:
            格式为 data:image/{format};base64,{base64_data} 的字符串

        Raises:
            FileNotFoundError: 文件不存在
            IOError: 文件读取失败
        """
        image_path = Path(image_path)

        if not image_path.exists():
            raise FileNotFoundError(f"Image file not found: {image_path}")

        # 读取图片文件
        with open(image_path, "rb") as f:
            image_data = f.read()

        # 转换为base64
        base64_data = base64.b64encode(image_data).decode('utf-8')

        # 根据文件扩展名确定MIME类型
        ext = image_path.suffix.lower()
        mime_type_map = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp',
            '.gif': 'image/gif'
        }
        mime_type = mime_type_map.get(ext, 'image/png')  # 默认png

        # 返回data URL格式
        return f"data:{mime_type};base64,{base64_data}"

