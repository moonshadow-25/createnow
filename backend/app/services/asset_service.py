import json
import uuid
import time
from pathlib import Path
from typing import List, Dict, Optional, Any
from datetime import datetime

from app.models.project import Project, Character, Scene, Prop, Episode, Storyboard, ImageGeneration
from app.core.config import settings
from app.core.context import get_current_data_root


def _get_projects_dir() -> Path:
    """返回当前请求对应的 projects 目录。
    SaaS 模式下返回 data/users/{user_id}/projects/，
    selfhosted 模式下返回 data/projects/（不变）。
    """
    data_root = get_current_data_root()
    if data_root:
        return Path(data_root) / "projects"
    return settings.PROJECTS_DIR

# ── 进程级内存缓存 ────────────────────────────────────────────────────────────
# 首次访问时从磁盘加载，之后读写全走内存，磁盘仍保持同步写入。
# key: project_id -> List[Dict]
_images_cache: Dict[str, List[Dict]] = {}

# key: project_id -> asset_type -> List[Dict]
_assets_cache: Dict[str, Dict[str, List[Dict]]] = {}


class AssetService:
    """资产管理服务"""

    @staticmethod
    def save_asset(project_id: str, asset_type: str, asset: Dict) -> Dict:
        """保存资产到文件，并同步更新内存缓存"""
        project_dir = _get_projects_dir() / project_id
        asset_dir = project_dir / f"{asset_type}s"

        if not asset_dir.exists():
            asset_dir.mkdir(parents=True)

        asset_id = asset.get("asset_id") or str(uuid.uuid4())
        asset["asset_id"] = asset_id
        asset["updated_at"] = datetime.now().isoformat()

        file_path = asset_dir / f"{asset_id}.json"
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(asset, f, ensure_ascii=False, indent=2)

        # 更新缓存
        if project_id in _assets_cache and asset_type in _assets_cache[project_id]:
            cache = _assets_cache[project_id][asset_type]
            for i, a in enumerate(cache):
                if a.get("asset_id") == asset_id:
                    cache[i] = asset
                    break
            else:
                cache.append(asset)

        return asset

    @staticmethod
    def load_asset(project_id: str, asset_type: str, asset_id: str) -> Optional[Dict]:
        """加载资产，优先从内存缓存查找"""
        # 先查缓存
        if project_id in _assets_cache and asset_type in _assets_cache[project_id]:
            for a in _assets_cache[project_id][asset_type]:
                if a.get("asset_id") == asset_id:
                    return a

        # 缓存未命中。
        # 若该类型缓存尚未初始化，先触发全量磁盘加载（由 list_assets 负责），
        # 再从缓存中查找——避免只追加单条导致缓存不完整，使后续 list_assets 命中
        # 残缺缓存而漏返回其他资产（核心 bug 修复）。
        if project_id not in _assets_cache or asset_type not in _assets_cache.get(project_id, {}):
            AssetService.list_assets(project_id, asset_type, include_children=True)
            # list_assets 已将全量写入缓存，再从缓存查找
            cache = _assets_cache.get(project_id, {}).get(asset_type, [])
            for a in cache:
                if a.get("asset_id") == asset_id:
                    return a
            # 全量加载后仍未找到，说明磁盘上确实不存在该文件
            return None

        # 缓存已初始化但未命中（该资产是缓存初始化后新增的），从磁盘读取并追加
        project_dir = _get_projects_dir() / project_id
        file_path = project_dir / f"{asset_type}s" / f"{asset_id}.json"

        if not file_path.exists():
            return None

        with open(file_path, "r", encoding="utf-8") as f:
            asset = json.load(f)

        # 追加到已初始化的缓存中（避免重复）
        cache = _assets_cache[project_id][asset_type]
        if not any(a.get("asset_id") == asset_id for a in cache):
            cache.append(asset)

        return asset

    @staticmethod
    def list_assets(project_id: str, asset_type: str, include_children: bool = False) -> List[Dict]:
        """列出资产，首次从磁盘加载并缓存，后续直接走内存"""
        # 检查缓存
        if project_id in _assets_cache and asset_type in _assets_cache[project_id]:
            cache = _assets_cache[project_id][asset_type]
            if include_children:
                return list(cache)
            return [a for a in cache if not a.get("parent_id")]

        # 缓存未命中，从磁盘加载
        project_dir = _get_projects_dir() / project_id
        asset_dir = project_dir / f"{asset_type}s"

        if not asset_dir.exists():
            return []

        t0 = time.perf_counter()
        files = list(asset_dir.glob("*.json"))
        t1 = time.perf_counter()

        all_assets = []
        for file_path in files:
            with open(file_path, "r", encoding="utf-8") as f:
                all_assets.append(json.load(f))

        t2 = time.perf_counter()
        all_assets.sort(key=lambda x: x.get("created_at", ""))

        # 存入缓存（存全量，include_children 过滤在返回时做）
        if project_id not in _assets_cache:
            _assets_cache[project_id] = {}
        _assets_cache[project_id][asset_type] = all_assets

        print(
            f"[CACHE MISS] list_assets/{asset_type} | "
            f"files={len(files)} loaded={len(all_assets)} | "
            f"glob={1000*(t1-t0):.1f}ms read_json={1000*(t2-t1):.1f}ms"
        )

        if include_children:
            return list(all_assets)
        return [a for a in all_assets if not a.get("parent_id")]

    @staticmethod
    def delete_asset(project_id: str, asset_type: str, asset_id: str) -> bool:
        """删除资产（级联删除所有子资产），并同步更新缓存"""
        # 用 list_assets 获取全量（走缓存），找子资产
        all_assets = AssetService.list_assets(project_id, asset_type, include_children=True)

        child_assets = [a for a in all_assets if a.get("parent_id") == asset_id]
        for child in child_assets:
            AssetService.delete_asset(project_id, asset_type, child["asset_id"])

        # 删除主资产文件
        project_dir = _get_projects_dir() / project_id
        file_path = project_dir / f"{asset_type}s" / f"{asset_id}.json"
        if not file_path.exists():
            return False

        file_path.unlink()

        # 从缓存中移除
        if project_id in _assets_cache and asset_type in _assets_cache[project_id]:
            cache = _assets_cache[project_id][asset_type]
            _assets_cache[project_id][asset_type] = [
                a for a in cache if a.get("asset_id") != asset_id
            ]

        return True

    @staticmethod
    def update_asset_image(project_id: str, asset_type: str, asset_id: str, image_id: str) -> bool:
        """更新资产的主图"""
        asset = AssetService.load_asset(project_id, asset_type, asset_id)
        if not asset:
            return False

        asset["image_id"] = image_id
        asset["updated_at"] = datetime.now().isoformat()
        AssetService.save_asset(project_id, asset_type, asset)
        return True

    @staticmethod
    def create_child_asset(project_id: str, asset_type: str, parent_id: str, child_data: Dict) -> Dict:
        """创建子资产，继承父资产的属性和图片"""
        parent_asset = AssetService.load_asset(project_id, asset_type, parent_id)
        if not parent_asset:
            raise ValueError(f"Parent asset {parent_id} not found")

        child_asset = {
            **child_data,
            "parent_id": parent_id,
            "asset_id": str(uuid.uuid4()),
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
        }

        saved_child = AssetService.save_asset(project_id, asset_type, child_asset)

        if parent_asset.get("image_id"):
            from app.services.asset_service import ImageService

            parent_images = ImageService.list_images(project_id, parent_id)
            primary_image = next((img for img in parent_images if img.get("is_primary")), None)
            images_to_copy = [primary_image] if primary_image else parent_images

            for img in images_to_copy:
                new_image_record = {
                    "image_id": str(uuid.uuid4()),
                    "asset_id": saved_child["asset_id"],
                    "asset_type": asset_type,
                    "prompt": img.get("prompt", ""),
                    "negative_prompt": img.get("negative_prompt", ""),
                    "model": img.get("model", ""),
                    "width": img.get("width", 1024),
                    "height": img.get("height", 1024),
                    "image_path": img.get("image_path", ""),
                    "created_at": datetime.now().isoformat(),
                    "is_primary": img.get("is_primary", False),
                }
                ImageService.save_generation_record(project_id, new_image_record)

            if primary_image:
                new_images = ImageService.list_images(project_id, saved_child["asset_id"])
                new_primary = next((img for img in new_images if img.get("is_primary")), None)
                if new_primary:
                    saved_child["image_id"] = new_primary["image_id"]
                    AssetService.save_asset(project_id, asset_type, saved_child)

        return saved_child

    @staticmethod
    def get_asset_tree(project_id: str, asset_type: str) -> List[Dict]:
        """获取资产的树形结构（包含父子关系）"""
        all_assets = AssetService.list_assets(project_id, asset_type, include_children=True)

        main_assets = [a for a in all_assets if not a.get("parent_id")]
        child_assets = [a for a in all_assets if a.get("parent_id")]

        tree = []
        for main in main_assets:
            children = [c for c in child_assets if c.get("parent_id") == main["asset_id"]]
            tree.append({**main, "children": children})

        return tree


class ProjectService:
    """项目管理服务"""

    @staticmethod
    def create_project(name: str, description: str = "") -> Dict:
        """创建项目"""
        project_id = str(uuid.uuid4())
        project = Project(project_id, name, description)
        return project.to_dict()

    @staticmethod
    def get_project(project_id: str) -> Optional[Dict]:
        """获取项目信息"""
        try:
            project = Project.load(project_id)
            return project.to_dict()
        except FileNotFoundError:
            return None

    @staticmethod
    def list_projects() -> List[Dict]:
        """列出所有项目"""
        projects_dir = _get_projects_dir()
        if not projects_dir.exists():
            return []
        projects = []
        for project_dir in projects_dir.iterdir():
            if project_dir.is_dir():
                metadata_path = project_dir / "metadata.json"
                if metadata_path.exists():
                    with open(metadata_path, "r", encoding="utf-8") as f:
                        projects.append(json.load(f))
        return projects

    @staticmethod
    def update_project(project_id: str, **kwargs) -> Optional[Dict]:
        """更新项目"""
        try:
            project = Project.load(project_id)

            if "name" in kwargs:
                project.name = kwargs["name"]
            if "description" in kwargs:
                project.description = kwargs["description"]
            if "ai_config" in kwargs:
                existing_config = project.ai_config or {}
                new_config = kwargs["ai_config"]
                project.ai_config = {**existing_config, **new_config}

            for field in ["total_episodes", "minutes_per_episode",
                          "compute_budget_per_minute", "project_duration_days",
                          "budget_total"]:
                if field in kwargs:
                    setattr(project, field, kwargs[field])

            project.save_metadata()
            return project.to_dict()
        except FileNotFoundError:
            return None

    @staticmethod
    def delete_project(project_id: str) -> bool:
        """删除项目（移动到回收站），并清理缓存"""
        projects_dir = _get_projects_dir()
        project_dir = projects_dir / project_id
        if not project_dir.exists():
            return False

        trash_dir = projects_dir.parent / "trash"
        trash_dir.mkdir(exist_ok=True)

        import shutil
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        trash_project_dir = trash_dir / f"{project_id}_{timestamp}"
        shutil.move(str(project_dir), str(trash_project_dir))

        # 清理该项目的缓存
        _images_cache.pop(project_id, None)
        _assets_cache.pop(project_id, None)

        return True


class ImageService:
    """图片管理服务"""

    @staticmethod
    def _get_images_cache(project_id: str) -> List[Dict]:
        """返回项目图片缓存列表，首次访问时从磁盘加载"""
        if project_id not in _images_cache:
            project_dir = _get_projects_dir() / project_id
            images_dir = project_dir / "images"

            t0 = time.perf_counter()
            images = []
            if images_dir.exists():
                files = list(images_dir.glob("*.json"))
                for file_path in files:
                    with open(file_path, "r", encoding="utf-8") as f:
                        images.append(json.load(f))
                t1 = time.perf_counter()
                print(
                    f"[CACHE MISS] ImageService | project={project_id[:8]} | "
                    f"files={len(files)} | load={1000*(t1-t0):.1f}ms"
                )

            _images_cache[project_id] = images

        return _images_cache[project_id]

    @staticmethod
    def save_generation_record(project_id: str, record: Dict) -> Dict:
        """保存图片生成记录到磁盘，并同步更新内存缓存"""
        project_dir = _get_projects_dir() / project_id
        images_dir = project_dir / "images"
        images_dir.mkdir(exist_ok=True)

        image_id = record.get("image_id") or str(uuid.uuid4())
        record["image_id"] = image_id

        file_path = images_dir / f"{image_id}.json"
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)

        # 更新缓存（新增或替换）
        cache = ImageService._get_images_cache(project_id)
        for i, img in enumerate(cache):
            if img.get("image_id") == image_id:
                cache[i] = record
                break
        else:
            cache.append(record)

        return record

    @staticmethod
    def list_images(project_id: str, asset_id: Optional[str] = None) -> List[Dict]:
        """列出图片记录，直接走内存缓存"""
        cache = ImageService._get_images_cache(project_id)
        if asset_id is None:
            return cache
        return [img for img in cache if img.get("asset_id") == asset_id]

    @staticmethod
    def set_primary_image(project_id: str, asset_id: str, image_id: str) -> bool:
        """设置主图，写磁盘的同时更新缓存"""
        # 取消该资产其他主图
        images = ImageService.list_images(project_id, asset_id)
        for img in images:
            if img.get("is_primary"):
                img["is_primary"] = False  # 直接修改缓存中的 dict
                project_dir = _get_projects_dir() / project_id
                file_path = project_dir / "images" / f"{img['image_id']}.json"
                with open(file_path, "w", encoding="utf-8") as f:
                    json.dump(img, f, ensure_ascii=False, indent=2)

        # 设置新主图
        image = ImageService.get_image(project_id, image_id)
        if image:
            image["is_primary"] = True
            project_dir = _get_projects_dir() / project_id
            file_path = project_dir / "images" / f"{image_id}.json"
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(image, f, ensure_ascii=False, indent=2)

            # 同步到缓存（get_image 返回的是新 dict，需要替换缓存中的旧条目）
            cache = ImageService._get_images_cache(project_id)
            for i, img in enumerate(cache):
                if img.get("image_id") == image_id:
                    cache[i] = image
                    break

            # 更新资产的主图ID
            for asset_type in ["character", "scene", "prop", "storyboard"]:
                asset = AssetService.load_asset(project_id, asset_type, asset_id)
                if asset:
                    asset["image_id"] = image_id
                    asset["updated_at"] = datetime.now().isoformat()
                    AssetService.save_asset(project_id, asset_type, asset)
                    break

            return True
        return False

    @staticmethod
    def get_image(project_id: str, image_id: str) -> Optional[Dict]:
        """获取单张图片记录"""
        project_dir = _get_projects_dir() / project_id
        file_path = project_dir / "images" / f"{image_id}.json"

        if file_path.exists():
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return None

    @staticmethod
    def get_primary_image(project_id: str, asset_id: str) -> Optional[Dict]:
        """获取资产的主图"""
        images = ImageService.list_images(project_id, asset_id)
        for img in images:
            if img.get("is_primary"):
                return img
        return images[0] if images else None

    @staticmethod
    def create_image_from_file(
        project_id: str,
        asset_id: str,
        asset_type: str,
        local_file_path: str,
        prompt: str = "",
        is_primary: bool = False
    ) -> Dict:
        """从本地文件创建图片记录"""
        from PIL import Image

        image_id = str(uuid.uuid4())

        full_path = _get_projects_dir() / project_id / "images" / "files" / local_file_path
        with Image.open(full_path) as img:
            width, height = img.size

        image_record = {
            "image_id": image_id,
            "asset_id": asset_id,
            "asset_type": asset_type,
            "prompt": prompt,
            "negative_prompt": "",
            "model": "extracted_frame",
            "width": width,
            "height": height,
            "image_path": None,
            "local_path": local_file_path,
            "created_at": datetime.now().isoformat(),
            "is_primary": is_primary
        }

        ImageService.save_generation_record(project_id, image_record)
        return image_record

    @staticmethod
    def delete_image_thumbnail(project_id: str, local_path: str) -> bool:
        """删除图片对应的缩略图"""
        if not local_path:
            return False

        project_dir = _get_projects_dir() / project_id
        thumbnail_path = project_dir / "images" / "thumbnails" / local_path

        if thumbnail_path.exists():
            try:
                thumbnail_path.unlink()
                return True
            except Exception:
                return False
        return False

    @staticmethod
    def get_primary_images_batch(project_id: str, asset_ids: List[str]) -> Dict[str, Optional[Dict]]:
        """批量获取多个资产的主图"""
        all_images = ImageService.list_images(project_id)

        images_by_asset: Dict[str, List[Dict]] = {}
        asset_ids_set = set(asset_ids)
        for img in all_images:
            aid = img.get("asset_id")
            if aid in asset_ids_set:
                if aid not in images_by_asset:
                    images_by_asset[aid] = []
                images_by_asset[aid].append(img)

        result: Dict[str, Optional[Dict]] = {}
        for asset_id in asset_ids:
            images = images_by_asset.get(asset_id, [])
            primary = next((img for img in images if img.get("is_primary")), None)
            if not primary and images:
                primary = images[0]
            result[asset_id] = primary

        return result

    @staticmethod
    def get_primary_images_with_count_batch(project_id: str, asset_ids: List[str]) -> Dict[str, Dict]:
        """批量获取多个资产的主图和图片数量"""
        all_images = ImageService.list_images(project_id)

        images_by_asset: Dict[str, List[Dict]] = {}
        asset_ids_set = set(asset_ids)
        for img in all_images:
            aid = img.get("asset_id")
            if aid in asset_ids_set:
                if aid not in images_by_asset:
                    images_by_asset[aid] = []
                images_by_asset[aid].append(img)

        result: Dict[str, Dict] = {}
        for asset_id in asset_ids:
            images = images_by_asset.get(asset_id, [])
            primary = next((img for img in images if img.get("is_primary")), None)
            if not primary and images:
                primary = images[0]
            result[asset_id] = {
                "primary_image": primary,
                "image_count": len(images),
                "images": images,
            }

        return result
