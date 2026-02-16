"""
图片处理工具

提供统一的图片处理功能：
- URL/base64/本地路径 转换
- 图片缩放
- MIME类型检测
"""

import os
import base64
import logging
import httpx
from typing import Optional, List, Tuple
from io import BytesIO
from PIL import Image

logger = logging.getLogger(__name__)


class ImageProcessor:
    """图片处理工具类"""

    # 支持的图片格式
    SUPPORTED_EXTENSIONS = {
        '.png': ('image/png', 'png'),
        '.jpg': ('image/jpeg', 'jpeg'),
        '.jpeg': ('image/jpeg', 'jpeg'),
        '.webp': ('image/webp', 'webp'),
        '.gif': ('image/gif', 'gif'),
    }

    @staticmethod
    def get_mime_type(filename: str) -> Tuple[str, str]:
        """根据文件名获取MIME类型和格式

        Args:
            filename: 文件名或路径

        Returns:
            (mime_type, format) 如 ('image/png', 'png')
        """
        ext = os.path.splitext(filename.lower())[1]
        return ImageProcessor.SUPPORTED_EXTENSIONS.get(ext, ('image/png', 'png'))

    @staticmethod
    def detect_image_type(data: bytes) -> Tuple[str, str]:
        """根据图片数据检测类型

        Args:
            data: 图片二进制数据

        Returns:
            (mime_type, format)
        """
        # PNG: 89 50 4E 47
        if data[:4] == b'\x89PNG':
            return 'image/png', 'png'
        # JPEG: FF D8 FF
        elif data[:3] == b'\xff\xd8\xff':
            return 'image/jpeg', 'jpeg'
        # WebP: RIFF....WEBP
        elif data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            return 'image/webp', 'webp'
        # GIF: GIF87a or GIF89a
        elif data[:6] in (b'GIF87a', b'GIF89a'):
            return 'image/gif', 'gif'
        else:
            return 'image/png', 'png'

    @staticmethod
    async def to_base64(
        image_source: str,
        client: Optional[httpx.AsyncClient] = None
    ) -> Tuple[str, Optional[str]]:
        """将图片转换为base64格式

        Args:
            image_source: 图片来源，支持:
                - data:image/xxx;base64,xxx (已是base64)
                - http(s)://xxx (URL)
                - 本地文件路径
            client: HTTP客户端（用于下载URL图片）

        Returns:
            (base64_data_url, error) - 成功时error为None
        """
        try:
            if image_source.startswith("data:image"):
                # 已经是base64格式
                return image_source, None

            elif image_source.startswith(("http://", "https://")):
                # HTTP URL，下载并转base64
                if client is None:
                    limits = httpx.Limits(max_connections=200, max_keepalive_connections=50)
                    client = httpx.AsyncClient(timeout=30.0, limits=limits)
                    should_close = True
                else:
                    should_close = False

                try:
                    response = await client.get(image_source)
                    response.raise_for_status()
                    image_data = response.content

                    # 检测图片类型
                    mime_type, _ = ImageProcessor.detect_image_type(image_data)
                    img_b64 = base64.b64encode(image_data).decode('utf-8')
                    return f"data:{mime_type};base64,{img_b64}", None
                finally:
                    if should_close:
                        await client.aclose()

            else:
                # 本地文件路径
                if not os.path.exists(image_source):
                    return "", f"Image file not found: {image_source}"

                with open(image_source, "rb") as f:
                    image_data = f.read()

                mime_type, _ = ImageProcessor.get_mime_type(image_source)
                img_b64 = base64.b64encode(image_data).decode('utf-8')
                return f"data:{mime_type};base64,{img_b64}", None

        except Exception as e:
            return "", f"Failed to convert image to base64: {str(e)}"

    @staticmethod
    def to_base64_sync(image_source: str) -> Tuple[str, Optional[str]]:
        """同步版本：将本地图片转换为base64格式

        Args:
            image_source: 图片来源，支持:
                - data:image/xxx;base64,xxx (已是base64)
                - 本地文件路径

        Returns:
            (base64_data_url, error) - 成功时error为None
        """
        try:
            if image_source.startswith("data:image"):
                return image_source, None

            if image_source.startswith(("http://", "https://")):
                return "", "Sync version does not support URL, use to_base64() instead"

            if not os.path.exists(image_source):
                return "", f"Image file not found: {image_source}"

            with open(image_source, "rb") as f:
                image_data = f.read()

            mime_type, _ = ImageProcessor.get_mime_type(image_source)
            img_b64 = base64.b64encode(image_data).decode('utf-8')
            return f"data:{mime_type};base64,{img_b64}", None

        except Exception as e:
            return "", f"Failed to convert image to base64: {str(e)}"

    @staticmethod
    async def to_bytes(
        image_source: str,
        client: Optional[httpx.AsyncClient] = None
    ) -> Tuple[bytes, str, Optional[str]]:
        """将图片转换为二进制数据

        Args:
            image_source: 图片来源
            client: HTTP客户端

        Returns:
            (image_bytes, content_type, error)
        """
        try:
            if image_source.startswith("data:image"):
                # base64格式：提取数据部分
                header, encoded = image_source.split(",", 1)
                image_data = base64.b64decode(encoded)
                # 从header提取MIME类型
                content_type = header.split(":")[1].split(";")[0]
                return image_data, content_type, None

            elif image_source.startswith(("http://", "https://")):
                # HTTP URL，下载
                if client is None:
                    limits = httpx.Limits(max_connections=200, max_keepalive_connections=50)
                    client = httpx.AsyncClient(timeout=30.0, limits=limits)
                    should_close = True
                else:
                    should_close = False

                try:
                    response = await client.get(image_source)
                    response.raise_for_status()
                    image_data = response.content
                    content_type = response.headers.get("content-type", "image/jpeg")
                    return image_data, content_type, None
                finally:
                    if should_close:
                        await client.aclose()

            else:
                # 本地文件路径
                if not os.path.exists(image_source):
                    return b"", "", f"Image file not found: {image_source}"

                with open(image_source, "rb") as f:
                    image_data = f.read()

                mime_type, _ = ImageProcessor.get_mime_type(image_source)
                return image_data, mime_type, None

        except Exception as e:
            return b"", "", f"Failed to read image: {str(e)}"

    @staticmethod
    async def process_multiple_images(
        images: List[str],
        client: Optional[httpx.AsyncClient] = None,
        output_format: str = "base64"
    ) -> Tuple[List[str], Optional[str]]:
        """批量处理多张图片

        Args:
            images: 图片来源列表
            client: HTTP客户端
            output_format: 输出格式 "base64" 或 "url"

        Returns:
            (processed_images, error)
        """
        if output_format == "url":
            # 验证所有图片都是URL
            for img in images:
                if not img.startswith(("http://", "https://")):
                    return [], f"URL mode requires all images to be HTTP/HTTPS URLs, got: {img[:100]}"
            return images, None

        # base64模式
        result = []
        for img in images:
            b64_data, error = await ImageProcessor.to_base64(img, client)
            if error:
                return [], error
            result.append(b64_data)

        return result, None

    @staticmethod
    def scale_to_1080p(image_url: str) -> str:
        """将图片缩放到1080p（短边=1080）

        Args:
            image_url: 图片URL（支持 http(s):// 或 data:image/...;base64,... 格式）

        Returns:
            缩放后的base64格式图片 (data:image/jpeg;base64,...)
        """
        try:
            # 1. 获取图片数据
            if image_url.startswith("data:image"):
                # 已经是base64格式，提取数据部分
                header, encoded = image_url.split(",", 1)
                image_data = base64.b64decode(encoded)
            elif image_url.startswith(("http://", "https://")):
                # HTTP URL，需要下载
                response = httpx.get(image_url, timeout=30.0)
                response.raise_for_status()
                image_data = response.content
            else:
                logger.warning(f"Unsupported image URL format: {image_url[:100]}")
                return image_url

            # 2. 打开图片
            img = Image.open(BytesIO(image_data))
            original_width, original_height = img.size

            # 3. 判断是否需要缩放（短边 > 1080）
            short_side = min(original_width, original_height)
            if short_side <= 1080:
                logger.info(f"[图片缩放] 短边={short_side}，无需缩放")
                return image_url

            # 4. 计算缩放比例（短边缩放到1080）
            scale_ratio = 1080 / short_side
            new_width = int(original_width * scale_ratio)
            new_height = int(original_height * scale_ratio)

            logger.info(f"[图片缩放] 原始尺寸: {original_width}x{original_height}, 缩放后: {new_width}x{new_height}, 比例: {scale_ratio:.3f}")

            # 5. 缩放图片（使用高质量重采样）
            img_resized = img.resize((new_width, new_height), Image.LANCZOS)

            # 6. 转换为JPEG并压缩（quality=85，高质量）
            buffer = BytesIO()
            # 如果是RGBA模式，转换为RGB
            if img_resized.mode == 'RGBA':
                img_resized = img_resized.convert('RGB')
            img_resized.save(buffer, format='JPEG', quality=85, optimize=True)

            # 7. 转换为base64
            img_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
            result = f"data:image/jpeg;base64,{img_base64}"

            # 8. 记录压缩效果
            original_size = len(image_data)
            compressed_size = len(buffer.getvalue())
            compression_ratio = (1 - compressed_size / original_size) * 100
            logger.info(f"[图片缩放] 原始大小: {original_size/1024:.1f}KB, 压缩后: {compressed_size/1024:.1f}KB, 压缩率: {compression_ratio:.1f}%")

            return result

        except Exception as e:
            logger.error(f"[图片缩放] 失败: {e}")
            # 失败时返回原图
            return image_url

    @staticmethod
    def get_filename_for_content_type(content_type: str) -> str:
        """根据content-type获取文件名

        Args:
            content_type: MIME类型

        Returns:
            文件名如 "image.png"
        """
        if "png" in content_type:
            return "image.png"
        elif "webp" in content_type:
            return "image.webp"
        elif "gif" in content_type:
            return "image.gif"
        else:
            return "image.jpg"
