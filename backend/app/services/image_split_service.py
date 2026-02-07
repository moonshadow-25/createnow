"""
图片分割服务 - 用于将图片按上中下三等分分割
"""

import logging
import uuid
from pathlib import Path
from typing import List

from PIL import Image

logger = logging.getLogger(__name__)


class ImageSplitService:
    """图片分割服务"""

    @staticmethod
    def split_image_triple(image_path: Path, output_dir: Path) -> List[Path]:
        """
        将图片按上中下三等分分割

        Args:
            image_path: 源图片路径
            output_dir: 输出目录

        Returns:
            分割后的3张图片路径列表 [上, 中, 下]
        """
        try:
            # 确保输出目录存在
            output_dir.mkdir(parents=True, exist_ok=True)

            # 打开图片
            img = Image.open(image_path)
            width, height = img.size

            # 计算每部分的高度
            part_height = height // 3

            results = []

            # 分割为上、中、下三部分
            regions = [
                (0, 0, width, part_height),                    # 上
                (0, part_height, width, part_height * 2),      # 中
                (0, part_height * 2, width, height)            # 下（包含余数像素）
            ]

            for i, region in enumerate(regions):
                part = img.crop(region)

                # 生成唯一文件名
                filename = f"{uuid.uuid4()}.png"
                output_path = output_dir / filename

                # 保存为PNG格式保持质量
                part.save(output_path, format="PNG")
                results.append(output_path)

                logger.info(f"分割图片第{i+1}部分: {output_path}")

            return results

        except Exception as e:
            logger.error(f"分割图片失败: {e}")
            raise
