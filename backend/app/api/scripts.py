"""剧本创作API"""
import logging
from fastapi import APIRouter, HTTPException, Body, Query
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

from app.services import (
    ScriptService, ScriptCharacterService, ScriptEpisodeService,
    ScriptSceneService, ScriptLineService, ScriptParser, AILogService,
    parse_script_with_ai
)
from app.services.asset_service import ProjectService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/scripts", tags=["scripts"])


# ==================== 请求模型 ====================

class CreateScriptRequest(BaseModel):
    title: str = "未命名剧本"
    description: str = ""


class UpdateScriptRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None


class AddCharacterRequest(BaseModel):
    name: str
    age: Optional[str] = None
    gender: Optional[str] = None
    description: str = ""
    notes: str = ""


class UpdateCharacterRequest(BaseModel):
    name: Optional[str] = None
    age: Optional[str] = None
    gender: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None


class ImportScriptRequest(BaseModel):
    content: str  # 剧本文本内容
    use_ai: bool = True  # 是否使用 AI 解析（默认 True，False 则用正则）


class AddSceneRequest(BaseModel):
    location: str
    time_of_day: str = "日"
    interior_exterior: str = "外"
    sequence: int = 1


class UpdateSceneRequest(BaseModel):
    location: Optional[str] = None
    time_of_day: Optional[str] = None
    interior_exterior: Optional[str] = None
    content: Optional[str] = None
    sequence: Optional[int] = None


class AddLineRequest(BaseModel):
    line_type: str  # "visual", "dialogue", "action"
    content: str
    character: Optional[str] = None
    parenthetical: Optional[str] = None
    dialogue: Optional[str] = None
    visual_type: Optional[str] = None
    visual_description: Optional[str] = None
    sequence: int = 1


class UpdateLineRequest(BaseModel):
    content: Optional[str] = None
    line_type: Optional[str] = None
    character: Optional[str] = None
    parenthetical: Optional[str] = None
    dialogue: Optional[str] = None
    visual_type: Optional[str] = None
    visual_description: Optional[str] = None
    sequence: Optional[int] = None


# ==================== 剧本管理 ====================

@router.post("")
async def create_script(project_id: str, request: CreateScriptRequest):
    """创建剧本"""
    try:
        script = ScriptService.create_script(
            project_id,
            title=request.title,
            description=request.description
        )
        return script
    except Exception as e:
        logger.error(f"Failed to create script: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("")
async def list_scripts(project_id: str):
    """列出所有剧本"""
    try:
        scripts = ScriptService.list_scripts(project_id)
        return {"scripts": scripts}
    except Exception as e:
        logger.error(f"Failed to list scripts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{script_id}")
async def get_script(project_id: str, script_id: str):
    """获取剧本详情"""
    try:
        script = ScriptService.get_script(project_id, script_id)
        if not script:
            raise HTTPException(status_code=404, detail="Script not found")
        return script
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get script: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{script_id}")
async def update_script(project_id: str, script_id: str, request: UpdateScriptRequest):
    """更新剧本"""
    try:
        update_data = {}
        if request.title is not None:
            update_data["title"] = request.title
        if request.description is not None:
            update_data["description"] = request.description

        script = ScriptService.update_script(project_id, script_id, **update_data)
        if not script:
            raise HTTPException(status_code=404, detail="Script not found")
        return script
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update script: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{script_id}")
async def delete_script(project_id: str, script_id: str):
    """删除剧本"""
    try:
        success = ScriptService.delete_script(project_id, script_id)
        if not success:
            raise HTTPException(status_code=404, detail="Script not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete script: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{script_id}/export")
async def export_script(project_id: str, script_id: str, format: str = Query("txt", description="导出格式: txt或pdf")):
    """导出剧本"""
    try:
        script = ScriptService.get_script(project_id, script_id)
        if not script:
            raise HTTPException(status_code=404, detail="Script not found")

        content = ScriptService.get_script_full_content(project_id, script_id)

        if format == "txt":
            from fastapi.responses import PlainTextResponse
            return PlainTextResponse(
                content=content,
                headers={
                    "Content-Disposition": f'attachment; filename="{script["title"]}.txt"'
                }
            )
        elif format == "pdf":
            # 生成PDF（需要安装 reportlab）
            try:
                from reportlab.lib.pagesizes import A4
                from reportlab.pdfgen import canvas
                from reportlab.pdfbase import pdfmetrics
                from reportlab.pdfbase.ttfonts import TTFont
                from reportlab.lib.units import cm
                from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
                from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
                from reportlab.lib.enums import TA_LEFT
                from reportlab.pdfbase.pdfmetrics import registerFont
                import io
                import os

                # 创建中文字体样式
                buffer = io.BytesIO()

                doc = SimpleDocTemplate(
                    buffer,
                    pagesize=A4,
                    leftMargin=2*cm,
                    rightMargin=2*cm,
                    topMargin=2*cm,
                    bottomMargin=2*cm
                )

                # 样式
                styles = getSampleStyleSheet()

                # 尝试使用中文字体
                font_name = "SimSun"  # 宋体
                try:
                    # Windows 系统字体路径
                    font_paths = [
                        "C:/Windows/Fonts/simsun.ttc",
                        "C:/Windows/Fonts/simhei.ttf",
                        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
                        "/System/Library/Fonts/PingFang.ttc"
                    ]
                    for font_path in font_paths:
                        if os.path.exists(font_path):
                            pdfmetrics.registerFont(TTFont(font_name, font_path))
                            break
                except:
                    pass

                # 创建自定义样式
                title_style = ParagraphStyle(
                    'ChineseTitle',
                    parent=styles['Heading1'],
                    fontName=font_name,
                    fontSize=18,
                    alignment=1,  # 居中
                    spaceAfter=12
                )

                normal_style = ParagraphStyle(
                    'ChineseNormal',
                    parent=styles['Normal'],
                    fontName=font_name,
                    fontSize=10,
                    leading=14,
                    spaceAfter=6
                )

                # 构建内容
                story = []

                # 标题
                story.append(Paragraph(script["title"], title_style))
                story.append(Spacer(1, 0.5*cm))

                # 人物表
                story.append(Paragraph("人物表：", ParagraphStyle(
                    'ChineseHeading',
                    parent=styles['Heading2'],
                    fontName=font_name,
                    fontSize=14
                )))
                characters = ScriptService.list_characters(project_id, script_id)
                for char in characters:
                    char_text = f"{char['name']}: "
                    if char.get('age'):
                        char_text += f"{char['age']}岁, "
                    if char.get('gender'):
                        char_text += f"{char['gender']}, "
                    char_text += char.get('description', char.get('notes', ''))
                    story.append(Paragraph(char_text, normal_style))

                story.append(Spacer(1, 0.5*cm))

                # 剧集内容
                episodes = ScriptService.list_episodes(project_id, script_id)
                for episode in sorted(episodes, key=lambda x: x.get('episode_number', 0)):
                    story.append(Paragraph(f"第{episode['episode_number']}集", ParagraphStyle(
                        'ChineseEpisode',
                        parent=styles['Heading2'],
                        fontName=font_name,
                        fontSize=14
                    )))

                    scenes = ScriptService.list_scenes_by_episode(project_id, episode['episode_id'])
                    for scene in sorted(scenes, key=lambda x: x.get('sequence', 0)):
                        scene_lines = ScriptService.list_lines_by_scene(project_id, scene['scene_id'])
                        for line in sorted(scene_lines, key=lambda x: x.get('sequence', 0)):
                            content = line.get('content', '').replace('\n', '<br/>')
                            story.append(Paragraph(content, normal_style))

                    story.append(PageBreak())

                doc.build(story)

                from fastapi.responses import Response
                buffer.seek(0)
                return Response(
                    content=buffer.getvalue(),
                    media_type="application/pdf",
                    headers={
                        "Content-Disposition": f'attachment; filename="{script["title"]}.pdf"'
                    }
                )
            except ImportError:
                raise HTTPException(status_code=400, detail="PDF export not available. Please install reportlab.")
            except Exception as e:
                logger.error(f"Failed to generate PDF: {e}")
                raise HTTPException(status_code=500, detail=f"Failed to generate PDF: {str(e)}")
        else:
            raise HTTPException(status_code=400, detail="Invalid format. Use 'txt' or 'pdf'.")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to export script: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{script_id}/import")
async def import_script(project_id: str, script_id: str, request: ImportScriptRequest):
    """导入剧本文本（use_ai=True 使用 AI 解析，False 使用正则解析）"""
    try:
        script = ScriptService.get_script(project_id, script_id)
        if not script:
            raise HTTPException(status_code=404, detail="Script not found")

        if request.use_ai:
            # AI 解析：读取项目 LLM 配置
            project = ProjectService.get_project(project_id)
            ai_config = project.get("ai_config", {}) if project else {}
            parsed = await parse_script_with_ai(project_id, script_id, request.content, ai_config)
            result = ScriptParser.import_parsed_to_project(project_id, script_id, parsed)
            mode = "ai"
        else:
            # 正则解析（兜底）
            result = ScriptParser.import_script_to_project(project_id, script_id, request.content)
            mode = "regex"

        # 记录日志
        AILogService.log_interaction(
            project_id=project_id,
            interaction_type=AILogService.TYPE_LLM,
            request_data={"action": "import_script", "mode": mode, "content_length": len(request.content)},
            response_data={"result": result},
            metadata={"operation": "import_script", "script_id": script_id}
        )

        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to import script: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 人物管理 ====================

@router.get("/{script_id}/characters")
async def list_characters(project_id: str, script_id: str):
    """列出剧本人物"""
    try:
        characters = ScriptCharacterService.list_characters(project_id, script_id)
        return {"characters": characters}
    except Exception as e:
        logger.error(f"Failed to list characters: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{script_id}/characters")
async def add_character(project_id: str, script_id: str, request: AddCharacterRequest):
    """添加人物"""
    try:
        character = ScriptCharacterService.add_character(
            project_id, script_id,
            {
                "name": request.name,
                "age": request.age,
                "gender": request.gender,
                "description": request.description,
                "notes": request.notes
            }
        )
        return character
    except Exception as e:
        logger.error(f"Failed to add character: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{script_id}/characters/{character_id}")
async def update_character(project_id: str, script_id: str, character_id: str, request: UpdateCharacterRequest):
    """更新人物"""
    try:
        update_data = {}
        if request.name is not None:
            update_data["name"] = request.name
        if request.age is not None:
            update_data["age"] = request.age
        if request.gender is not None:
            update_data["gender"] = request.gender
        if request.description is not None:
            update_data["description"] = request.description
        if request.notes is not None:
            update_data["notes"] = request.notes

        character = ScriptCharacterService.update_character(project_id, script_id, character_id, **update_data)
        if not character:
            raise HTTPException(status_code=404, detail="Character not found")
        return character
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update character: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{script_id}/characters/{character_id}")
async def delete_character(project_id: str, script_id: str, character_id: str):
    """删除人物"""
    try:
        success = ScriptCharacterService.delete_character(project_id, script_id, character_id)
        if not success:
            raise HTTPException(status_code=404, detail="Character not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete character: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 剧集管理 ====================

@router.get("/{script_id}/episodes")
async def list_episodes(project_id: str, script_id: str):
    """列出剧集"""
    try:
        episodes = ScriptEpisodeService.list_episodes(project_id, script_id)
        return {"episodes": episodes}
    except Exception as e:
        logger.error(f"Failed to list episodes: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{script_id}/episodes")
async def add_episode(project_id: str, script_id: str, episode_number: int = Body(..., embed=True), title: str = Body("", embed=True)):
    """添加剧集"""
    try:
        episode = ScriptEpisodeService.add_episode(
            project_id, script_id, episode_number, title
        )
        return episode
    except Exception as e:
        logger.error(f"Failed to add episode: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{script_id}/episodes/{episode_id}")
async def delete_episode(project_id: str, script_id: str, episode_id: str):
    """删除剧集"""
    try:
        success = ScriptEpisodeService.delete_episode(project_id, script_id, episode_id)
        if not success:
            raise HTTPException(status_code=404, detail="Episode not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete episode: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 场景管理 ====================

@router.get("/{script_id}/episodes/{episode_id}/scenes")
async def list_scenes(project_id: str, script_id: str, episode_id: str):
    """列出剧集的场景"""
    try:
        scenes = ScriptSceneService.list_scenes_by_episode(project_id, episode_id)
        return {"scenes": scenes}
    except Exception as e:
        logger.error(f"Failed to list scenes: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{script_id}/episodes/{episode_id}/scenes")
async def add_scene(project_id: str, script_id: str, episode_id: str, request: AddSceneRequest):
    """添加场景"""
    try:
        scene = ScriptSceneService.add_scene(
            project_id, script_id, episode_id,
            {
                "location": request.location,
                "time_of_day": request.time_of_day,
                "interior_exterior": request.interior_exterior,
                "sequence": request.sequence
            }
        )
        return scene
    except Exception as e:
        logger.error(f"Failed to add scene: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{script_id}/scenes/{scene_id}")
async def update_scene(project_id: str, script_id: str, scene_id: str, request: UpdateSceneRequest):
    """更新场景"""
    try:
        update_data = {}
        if request.location is not None:
            update_data["location"] = request.location
        if request.time_of_day is not None:
            update_data["time_of_day"] = request.time_of_day
        if request.interior_exterior is not None:
            update_data["interior_exterior"] = request.interior_exterior
        if request.content is not None:
            update_data["content"] = request.content
        if request.sequence is not None:
            update_data["sequence"] = request.sequence

        scene = ScriptSceneService.update_scene(project_id, script_id, scene_id, **update_data)
        if not scene:
            raise HTTPException(status_code=404, detail="Scene not found")
        return scene
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update scene: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{script_id}/scenes/{scene_id}")
async def delete_scene(project_id: str, script_id: str, scene_id: str):
    """删除场景"""
    try:
        success = ScriptSceneService.delete_scene(project_id, script_id, scene_id)
        if not success:
            raise HTTPException(status_code=404, detail="Scene not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete scene: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 镜头行管理 ====================

@router.get("/{script_id}/scenes/{scene_id}/lines")
async def list_lines(project_id: str, script_id: str, scene_id: str):
    """列出场景的镜头行"""
    try:
        lines = ScriptLineService.list_lines_by_scene(project_id, scene_id)
        return {"lines": lines}
    except Exception as e:
        logger.error(f"Failed to list lines: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{script_id}/scenes/{scene_id}/lines")
async def add_line(project_id: str, script_id: str, scene_id: str, request: AddLineRequest):
    """添加镜头行"""
    try:
        line = ScriptLineService.add_line(
            project_id, script_id, scene_id,
            {
                "line_type": request.line_type,
                "content": request.content,
                "character": request.character,
                "parenthetical": request.parenthetical,
                "dialogue": request.dialogue,
                "visual_type": request.visual_type,
                "visual_description": request.visual_description,
                "sequence": request.sequence
            }
        )
        return line
    except Exception as e:
        logger.error(f"Failed to add line: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{script_id}/lines/{line_id}")
async def update_line(project_id: str, script_id: str, line_id: str, request: UpdateLineRequest):
    """更新镜头行"""
    try:
        update_data = {}
        if request.content is not None:
            update_data["content"] = request.content
        if request.line_type is not None:
            update_data["line_type"] = request.line_type
        if request.character is not None:
            update_data["character"] = request.character
        if request.parenthetical is not None:
            update_data["parenthetical"] = request.parenthetical
        if request.dialogue is not None:
            update_data["dialogue"] = request.dialogue
        if request.visual_type is not None:
            update_data["visual_type"] = request.visual_type
        if request.visual_description is not None:
            update_data["visual_description"] = request.visual_description
        if request.sequence is not None:
            update_data["sequence"] = request.sequence

        line = ScriptLineService.update_line(project_id, script_id, line_id, **update_data)
        if not line:
            raise HTTPException(status_code=404, detail="Line not found")
        return line
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update line: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{script_id}/lines/{line_id}")
async def delete_line(project_id: str, script_id: str, line_id: str):
    """删除镜头行"""
    try:
        success = ScriptLineService.delete_line(project_id, script_id, line_id)
        if not success:
            raise HTTPException(status_code=404, detail="Line not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete line: {e}")
        raise HTTPException(status_code=500, detail=str(e))
