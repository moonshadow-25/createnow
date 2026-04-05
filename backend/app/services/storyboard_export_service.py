"""
分镜导出服务

负责将选中的分镜图和提示词导出到 data/output 目录
"""

import logging
import shutil
from pathlib import Path
from datetime import datetime
from typing import List

from app.core.config import settings
from app.core.context import get_current_data_root
from app.services import ProjectService, AssetService, ImageService

logger = logging.getLogger(__name__)


def _get_projects_dir():
    from app.core.config import settings
    data_root = get_current_data_root()
    if data_root:
        return data_root / "projects"
    return settings.PROJECTS_DIR


class StoryboardExportService:
    """分镜导出服务"""

    @staticmethod
    async def export_storyboards(
        project_id: str,
        storyboard_ids: List[str],
        prompt: str = ""
    ) -> dict:
        """导出选中的分镜图和提示词

        Args:
            project_id: 项目ID
            storyboard_ids: 分镜ID列表
            prompt: 提示词内容

        Returns:
            包含导出路径和提示词的字典
        """
        project = ProjectService.get_project(project_id)
        if not project:
            raise ValueError("项目不存在")

        # 创建导出目录：data/output/{project_name}/{timestamp}/
        output_base = settings.DATA_DIR / "output"
        output_base.mkdir(parents=True, exist_ok=True)

        project_name = project.get('name') or project_id
        # 文件名安全化处理
        safe_project_name = "".join(
            c if c.isalnum() or c in (' ', '-', '_') else '_'
            for c in project_name
        ).strip()

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        export_dir = output_base / safe_project_name / timestamp
        export_dir.mkdir(parents=True, exist_ok=True)

        # 加载所有分镜数据
        storyboards_data = []
        for storyboard_id in storyboard_ids:
            storyboard = AssetService.load_asset(project_id, 'storyboard', storyboard_id)
            if storyboard:
                storyboards_data.append(storyboard)

        # 按序号排序
        storyboards_data.sort(key=lambda x: x.get('sequence', 0))

        # 导出分镜图（按实际序号命名）
        exported_files = []
        for storyboard in storyboards_data:
            sequence = storyboard.get('sequence', 0)
            image_id = storyboard.get('image_id')

            if not image_id:
                logger.warning(f"分镜 {sequence} 没有主图，跳过")
                continue

            # 获取图片文件路径
            image_record = ImageService.get_image(project_id, image_id)
            if not image_record:
                logger.warning(f"分镜 {sequence} 的图片记录不存在，跳过")
                continue

            # 查找实际图片文件
            image_path = None
            if image_record.get('local_path'):
                # 本地路径（相对于项目images目录）
                image_path = _get_projects_dir() / project_id / 'images' / 'files' / image_record['local_path']
            elif image_record.get('url'):
                # 外部URL，无法复制，跳过
                logger.warning(f"分镜 {sequence} 使用外部URL，无法导出")
                continue

            if not image_path or not image_path.exists():
                logger.warning(f"分镜 {sequence} 的图片文件不存在: {image_path}")
                continue

            # 复制图片到导出目录，命名为序号
            ext = image_path.suffix  # 保留原始扩展名
            dest_file = export_dir / f"{sequence}{ext}"
            shutil.copy2(image_path, dest_file)
            exported_files.append(dest_file.name)

            logger.info(f"已导出分镜 {sequence}: {dest_file}")

        # 保存提示词到 prompts.txt
        prompts_file = export_dir / "prompts.txt"
        with open(prompts_file, 'w', encoding='utf-8') as f:
            f.write(prompt)

        logger.info(f"已导出 {len(exported_files)} 个分镜到: {export_dir}")

        return {
            "success": True,
            "export_path": str(export_dir),
            "exported_files": exported_files,
            "prompt": prompt,
            "message": f"成功导出 {len(exported_files)} 个分镜到 {export_dir}"
        }
