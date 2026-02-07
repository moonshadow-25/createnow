"""
Generation API - 向后兼容入口

此文件作为门面（Facade），保持原有导入方式有效。

实际实现已拆分到 app.api.generation 子模块：
    - app.api.generation.models      - Pydantic 模型定义
    - app.api.generation.utils       - 工具函数
    - app.api.generation.templates   - 默认提示词模板
    - app.api.generation.image       - 图像生成 API
    - app.api.generation.video       - 视频生成 API
    - app.api.generation.download    - 下载相关 API
    - app.api.generation.prompt      - 提示词模板管理 API
    - app.api.generation.logs        - AI 日志 API

原文件已备份至 generation_backup.py
"""

# 从新模块导入路由器
from app.api.generation import router, DEFAULT_PROMPT_TEMPLATES

# 导出所有公共接口
__all__ = ["router", "DEFAULT_PROMPT_TEMPLATES"]
