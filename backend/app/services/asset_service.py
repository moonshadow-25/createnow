import json
import uuid
from pathlib import Path
from typing import List, Dict, Optional, Any
from datetime import datetime

from app.models.project import Project, Character, Scene, Prop, Episode, Storyboard, ImageGeneration
from app.core.config import settings


class AssetService:
    """资产管理服务"""

    @staticmethod
    def save_asset(project_id: str, asset_type: str, asset: Dict) -> Dict:
        """保存资产到文件"""
        project_dir = settings.PROJECTS_DIR / project_id
        asset_dir = project_dir / f"{asset_type}s"

        if not asset_dir.exists():
            asset_dir.mkdir(parents=True)

        asset_id = asset.get("asset_id") or str(uuid.uuid4())
        asset["asset_id"] = asset_id
        asset["updated_at"] = datetime.now().isoformat()

        file_path = asset_dir / f"{asset_id}.json"
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(asset, f, ensure_ascii=False, indent=2)

        return asset

    @staticmethod
    def load_asset(project_id: str, asset_type: str, asset_id: str) -> Optional[Dict]:
        """加载资产"""
        project_dir = settings.PROJECTS_DIR / project_id
        file_path = project_dir / f"{asset_type}s" / f"{asset_id}.json"

        if not file_path.exists():
            return None

        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def list_assets(project_id: str, asset_type: str, include_children: bool = False) -> List[Dict]:
        """列出资产

        Args:
            project_id: 项目ID
            asset_type: 资产类型
            include_children: 是否包含子资产，默认为False（只返回顶级资产）
        """
        project_dir = settings.PROJECTS_DIR / project_id
        asset_dir = project_dir / f"{asset_type}s"

        if not asset_dir.exists():
            return []

        assets = []
        for file_path in asset_dir.glob("*.json"):
            with open(file_path, "r", encoding="utf-8") as f:
                asset = json.load(f)
                # 根据参数决定是否包含子资产
                if include_children or not asset.get("parent_id"):
                    assets.append(asset)

        # 按创建时间排序
        assets.sort(key=lambda x: x.get("created_at", ""))
        return assets

    @staticmethod
    def delete_asset(project_id: str, asset_type: str, asset_id: str) -> bool:
        """删除资产（级联删除所有子资产）"""
        project_dir = settings.PROJECTS_DIR / project_id
        asset_dir = project_dir / f"{asset_type}s"

        # 先找到并删除所有子资产
        all_assets = []
        if asset_dir.exists():
            for file_path in asset_dir.glob("*.json"):
                with open(file_path, "r", encoding="utf-8") as f:
                    all_assets.append(json.load(f))

        # 找出所有子资产（parent_id指向要删除的资产）
        child_assets = [
            asset for asset in all_assets
            if asset.get("parent_id") == asset_id
        ]

        # 递归删除所有子资产
        for child in child_assets:
            child_id = child["asset_id"]
            AssetService.delete_asset(project_id, asset_type, child_id)

        # 删除主资产文件
        file_path = asset_dir / f"{asset_id}.json"
        if file_path.exists():
            file_path.unlink()
            return True
        return False

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
        # 加载父资产
        parent_asset = AssetService.load_asset(project_id, asset_type, parent_id)
        if not parent_asset:
            raise ValueError(f"Parent asset {parent_id} not found")

        # 创建子资产，设置parent_id
        child_asset = {
            **child_data,
            "parent_id": parent_id,
            "asset_id": str(uuid.uuid4()),
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
        }

        # 保存子资产
        saved_child = AssetService.save_asset(project_id, asset_type, child_asset)

        # 如果父资产有图片，复制图片记录到子资产
        if parent_asset.get("image_id"):
            from app.services.asset_service import ImageService

            # 获取父资产的所有图片
            parent_images = ImageService.list_images(project_id, parent_id)

            # 复制主图或所有图片到子资产
            primary_image = next((img for img in parent_images if img.get("is_primary")), None)
            images_to_copy = [primary_image] if primary_image else parent_images

            for img in images_to_copy:
                # 创建新的图片记录，关联到子资产
                new_image_record = {
                    "image_id": str(uuid.uuid4()),
                    "asset_id": saved_child["asset_id"],
                    "asset_type": asset_type,
                    "prompt": img.get("prompt", ""),
                    "negative_prompt": img.get("negative_prompt", ""),
                    "model": img.get("model", ""),
                    "width": img.get("width", 1024),
                    "height": img.get("height", 1024),
                    "image_path": img.get("image_path", ""),  # 复用同一图片文件
                    "created_at": datetime.now().isoformat(),
                    "is_primary": img.get("is_primary", False),
                }
                ImageService.save_generation_record(project_id, new_image_record)

            # 如果有主图，设置为子资产的主图（使用新创建的图片记录ID）
            if primary_image:
                # 找到新创建的对应图片记录，使用其ID作为子资产的image_id
                new_images = ImageService.list_images(project_id, saved_child["asset_id"])
                new_primary = next((img for img in new_images if img.get("is_primary")), None)
                if new_primary:
                    saved_child["image_id"] = new_primary["image_id"]
                    AssetService.save_asset(project_id, asset_type, saved_child)

        return saved_child

    @staticmethod
    def get_asset_tree(project_id: str, asset_type: str) -> List[Dict]:
        """获取资产的树形结构（包含父子关系）"""
        assets = AssetService.list_assets(project_id, asset_type)

        # 分离主资产和子资产
        main_assets = [a for a in assets if not a.get("parent_id")]
        child_assets = [a for a in assets if a.get("parent_id")]

        # 构建树形结构
        tree = []
        for main in main_assets:
            children = [c for c in child_assets if c.get("parent_id") == main["asset_id"]]
            tree.append({
                **main,
                "children": children
            })

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
        projects = []
        for project_dir in settings.PROJECTS_DIR.iterdir():
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
                # 合并 ai_config，保留 prompt_templates 等其他字段
                existing_config = project.ai_config or {}
                new_config = kwargs["ai_config"]
                project.ai_config = {**existing_config, **new_config}

            project.save_metadata()
            return project.to_dict()
        except FileNotFoundError:
            return None

    @staticmethod
    def delete_project(project_id: str) -> bool:
        """删除项目"""
        project_dir = settings.PROJECTS_DIR / project_id
        if project_dir.exists():
            import shutil
            shutil.rmtree(project_dir)
            return True
        return False


class ImageService:
    """图片管理服务"""

    @staticmethod
    def save_generation_record(project_id: str, record: Dict) -> Dict:
        """保存图片生成记录"""
        project_dir = settings.PROJECTS_DIR / project_id
        images_dir = project_dir / "images"
        images_dir.mkdir(exist_ok=True)

        image_id = record.get("image_id") or str(uuid.uuid4())
        record["image_id"] = image_id

        file_path = images_dir / f"{image_id}.json"
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)

        return record

    @staticmethod
    def list_images(project_id: str, asset_id: Optional[str] = None) -> List[Dict]:
        """列出图片记录"""
        project_dir = settings.PROJECTS_DIR / project_id
        images_dir = project_dir / "images"

        if not images_dir.exists():
            return []

        images = []
        for file_path in images_dir.glob("*.json"):
            with open(file_path, "r", encoding="utf-8") as f:
                img = json.load(f)
                if asset_id is None or img.get("asset_id") == asset_id:
                    images.append(img)

        return images

    @staticmethod
    def set_primary_image(project_id: str, asset_id: str, image_id: str) -> bool:
        """设置主图"""
        # 先取消该资产的其他主图
        images = ImageService.list_images(project_id, asset_id)
        for img in images:
            if img.get("is_primary"):
                img["is_primary"] = False
                project_dir = settings.PROJECTS_DIR / project_id
                file_path = project_dir / "images" / f"{img['image_id']}.json"
                with open(file_path, "w", encoding="utf-8") as f:
                    json.dump(img, f, ensure_ascii=False, indent=2)

        # 设置新的主图
        image = ImageService.get_image(project_id, image_id)
        if image:
            image["is_primary"] = True
            project_dir = settings.PROJECTS_DIR / project_id
            file_path = project_dir / "images" / f"{image_id}.json"
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(image, f, ensure_ascii=False, indent=2)

            # 更新资产的主图ID
            AssetService.update_asset_image(project_id, "image", asset_id, image_id)

            # 尝试更新其他类型的资产
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
        """获取图片记录"""
        project_dir = settings.PROJECTS_DIR / project_id
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
        # 如果没有主图，返回第一张图片
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
        """
        从本地文件创建图片记录

        Args:
            project_id: 项目ID
            asset_id: 资产ID
            asset_type: 资产类型
            local_file_path: 本地文件相对路径 (例如: "storyboard/xxx.png")
            prompt: 图片描述
            is_primary: 是否设为主图

        Returns:
            dict: 图片记录
        """
        from PIL import Image

        image_id = str(uuid.uuid4())

        # 获取图片尺寸
        full_path = settings.PROJECTS_DIR / project_id / "images" / "files" / local_file_path
        with Image.open(full_path) as img:
            width, height = img.size

        # 创建图片记录
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

        # 保存到 metadata.json
        ImageService.save_generation_record(project_id, image_record)

        return image_record

    @staticmethod
    def get_primary_images_batch(project_id: str, asset_ids: List[str]) -> Dict[str, Optional[Dict]]:
        """批量获取多个资产的主图"""
        # 一次性加载所有图片记录
        all_images = ImageService.list_images(project_id)

        # 按 asset_id 分组
        images_by_asset: Dict[str, List[Dict]] = {}
        for img in all_images:
            aid = img.get("asset_id")
            if aid in asset_ids:
                if aid not in images_by_asset:
                    images_by_asset[aid] = []
                images_by_asset[aid].append(img)

        # 为每个资产找到主图
        result: Dict[str, Optional[Dict]] = {}
        for asset_id in asset_ids:
            images = images_by_asset.get(asset_id, [])
            primary = None
            for img in images:
                if img.get("is_primary"):
                    primary = img
                    break
            # 如果没有主图，返回第一张
            if not primary and images:
                primary = images[0]
            result[asset_id] = primary

        return result

    @staticmethod
    def get_primary_images_with_count_batch(project_id: str, asset_ids: List[str]) -> Dict[str, Dict]:
        """批量获取多个资产的主图和图片数量"""
        # 一次性加载所有图片记录
        all_images = ImageService.list_images(project_id)

        # 按 asset_id 分组
        images_by_asset: Dict[str, List[Dict]] = {}
        for img in all_images:
            aid = img.get("asset_id")
            if aid in asset_ids:
                if aid not in images_by_asset:
                    images_by_asset[aid] = []
                images_by_asset[aid].append(img)

        # 为每个资产找到主图和计数
        result: Dict[str, Dict] = {}
        for asset_id in asset_ids:
            images = images_by_asset.get(asset_id, [])
            primary = None
            for img in images:
                if img.get("is_primary"):
                    primary = img
                    break
            # 如果没有主图，返回第一张
            if not primary and images:
                primary = images[0]
            result[asset_id] = {
                "primary_image": primary,
                "image_count": len(images)
            }

        return result
