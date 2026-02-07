"""
剪映导出服务 - 将分镜视频导出到剪映项目
"""
import json
import shutil
import uuid
import aiohttp
from pathlib import Path
from typing import Dict, List, Optional
from datetime import datetime
import logging
import platform
import time

from app.core.config import settings

logger = logging.getLogger(__name__)

# 导出状态存储（内存中，按项目ID）
_export_status: Dict[str, Dict] = {}


class JianyingExportService:
    """剪映导出服务"""

    # 剪映素材库默认路径
    JIAYING_PATHS = {
        "windows": Path.home() / "AppData/Local/JianyingPro/User Data/Projects/com.lveditor.draft",
        "darwin": Path.home() / "Library/Containers/com.lemon.lvpro/Data/Movies/JianyingPro/User Data/Projects/com.lveditor.draft",
    }

    @staticmethod
    def get_export_status(project_id: str) -> Dict:
        """获取导出状态"""
        return _export_status.get(project_id, {
            "status": "idle",
            "progress": 0,
            "current_step": "",
            "method": None,
            "path": None,
            "message": "",
            "errors": []
        })

    @staticmethod
    def _update_status(project_id: str, **kwargs):
        """更新导出状态"""
        if project_id not in _export_status:
            _export_status[project_id] = {
                "status": "idle",
                "progress": 0,
                "current_step": "",
                "method": None,
                "path": None,
                "message": "",
                "errors": []
            }
        _export_status[project_id].update(kwargs)

    @staticmethod
    def detect_jiaying_path() -> Optional[Path]:
        """检测剪映安装路径"""
        system = platform.system().lower()

        if system == "windows":
            path = JianyingExportService.JIAYING_PATHS["windows"]
        elif system == "darwin":
            path = JianyingExportService.JIAYING_PATHS["darwin"]
        else:
            logger.warning(f"Unsupported system: {system}")
            return None

        if path.exists():
            logger.info(f"Detected Jiaying path: {path}")
            return path
        else:
            logger.warning(f"Jiaying path not found: {path}")
            return None

    @staticmethod
    async def _collect_videos(
        project_id: str,
        episode_id: str,
        storyboard_ids: Optional[List[str]] = None
    ) -> List[Dict]:
        """
        收集视频文件

        Returns:
            [{"path": "...", "sequence": 1, "duration": 6.0, "storyboard_id": "..."}]
        """
        project_dir = settings.PROJECTS_DIR / project_id
        storyboards_dir = project_dir / "storyboards"
        videos_dir = project_dir / "videos"
        video_files_dir = videos_dir / "files"

        if not storyboards_dir.exists():
            logger.error(f"Storyboards directory not found: {storyboards_dir}")
            return []

        # 1. 加载所有分镜
        all_storyboards = []
        for sb_file in storyboards_dir.glob("*.json"):
            try:
                with open(sb_file, 'r', encoding='utf-8') as f:
                    sb_data = json.load(f)
                    if sb_data.get("episode_id") == episode_id:
                        all_storyboards.append(sb_data)
            except Exception as e:
                logger.error(f"Failed to load storyboard {sb_file}: {e}")

        # 2. 过滤指定的分镜
        if storyboard_ids:
            all_storyboards = [sb for sb in all_storyboards if sb["asset_id"] in storyboard_ids]

        # 3. 按 sequence 排序
        all_storyboards.sort(key=lambda x: x.get("sequence", 0))

        # 4. 为每个分镜选择视频
        collected_videos = []
        for sb in all_storyboards:
            sb_id = sb["asset_id"]
            sequence = sb.get("sequence", 0)

            # 加载该分镜的所有视频
            sb_videos = []
            if videos_dir.exists():
                for video_file in videos_dir.glob("*.json"):
                    try:
                        with open(video_file, 'r', encoding='utf-8') as f:
                            video_data = json.load(f)
                            # 只加载已完成的视频
                            if (video_data.get("storyboard_id") == sb_id and
                                video_data.get("status") == "completed"):
                                sb_videos.append(video_data)
                    except Exception as e:
                        logger.error(f"Failed to load video {video_file}: {e}")

            # 选择视频：primary > 最新
            selected_video = None
            if sb_videos:
                # 优先选择 primary
                primary_videos = [v for v in sb_videos if v.get("is_primary")]
                if primary_videos:
                    selected_video = primary_videos[0]
                else:
                    # 按创建时间排序，选择最新的
                    sb_videos.sort(key=lambda x: x.get('created_at', ''), reverse=True)
                    selected_video = sb_videos[0]

            if selected_video:
                video_id = selected_video["video_id"]
                local_path = selected_video.get("local_path")
                video_url = selected_video.get("video_path")

                # 优先使用本地文件
                video_path = None
                if local_path:
                    local_file = video_files_dir / local_path
                    if local_file.exists():
                        video_path = local_file

                # 如果没有本地文件，尝试下载
                if not video_path and video_url:
                    if video_url.startswith(('http://', 'https://')):
                        # 下载到永久目录
                        video_files_dir.mkdir(parents=True, exist_ok=True)
                        permanent_path = video_files_dir / f"{video_id}.mp4"

                        logger.info(f"Downloading video {video_id} from {video_url}")
                        try:
                            import aiohttp
                            async with aiohttp.ClientSession() as session:
                                async with session.get(video_url, timeout=aiohttp.ClientTimeout(total=300)) as response:
                                    if response.status == 200:
                                        with open(permanent_path, 'wb') as f:
                                            async for chunk in response.content.iter_chunked(8192):
                                                f.write(chunk)

                                        video_path = permanent_path

                                        # 更新视频元数据
                                        JianyingExportService._update_video_local_path(
                                            project_id, video_id, f"{video_id}.mp4"
                                        )
                                        logger.info(f"Downloaded and saved video {video_id} permanently")
                                    else:
                                        logger.error(f"Download failed with status {response.status}")
                        except Exception as e:
                            logger.error(f"Failed to download video {video_id}: {e}")
                    elif Path(video_url).exists():
                        video_path = Path(video_url)

                if video_path and video_path.exists():
                    # 获取视频时长（秒）
                    duration = selected_video.get("duration", 6.0)

                    collected_videos.append({
                        "path": str(video_path.absolute()),
                        "sequence": sequence,
                        "duration": duration,
                        "storyboard_id": sb_id,
                        "video_id": video_id
                    })
                    logger.info(f"Collected video for storyboard {sequence}: {video_path.name}")
                else:
                    logger.warning(f"Video file not found for storyboard {sequence} ({sb_id})")
            else:
                logger.warning(f"No video found for storyboard {sequence} ({sb_id})")

        logger.info(f"Collected {len(collected_videos)} videos for export")
        return collected_videos

    @staticmethod
    def _update_video_local_path(project_id: str, video_id: str, local_path: str):
        """更新视频的本地路径和下载状态"""
        project_dir = settings.PROJECTS_DIR / project_id
        file_path = project_dir / "videos" / f"{video_id}.json"

        if file_path.exists():
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    data = json.load(f)

                data["local_path"] = local_path
                data["is_downloaded"] = True
                data["downloaded_at"] = datetime.now().isoformat()

                with open(file_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)

                logger.info(f"Updated video metadata for {video_id}: local_path={local_path}")
            except Exception as e:
                logger.error(f"Failed to update video metadata for {video_id}: {e}")

    @staticmethod
    def _generate_draft_content(project_name: str, videos: List[Dict]) -> Dict:
        """生成 draft_content.json"""
        # 创建视频轨道
        video_track = {
            "attribute": 0,
            "flag": 0,
            "id": str(uuid.uuid4()),
            "is_default_name": True,
            "name": "",
            "segments": [],
            "type": "video"
        }

        # 视频素材列表
        video_materials = []

        # 当前时间位置（微秒）
        current_time = 0

        for idx, video in enumerate(videos):
            video_path = video["path"]
            duration_sec = video["duration"]
            duration_us = int(duration_sec * 1000000)  # 转换为微秒

            # 生成素材ID和片段ID
            material_id = str(uuid.uuid4())
            segment_id = str(uuid.uuid4())

            # 添加视频素材
            video_materials.append({
                "audio_fade": None,
                "cartoon": False,
                "cartoon_path": "",
                "category_id": "",
                "category_name": "local",
                "check_flag": 63487,
                "crop": {
                    "lower_left_x": 0.0,
                    "lower_left_y": 1.0,
                    "lower_right_x": 1.0,
                    "lower_right_y": 1.0,
                    "upper_left_x": 0.0,
                    "upper_left_y": 0.0,
                    "upper_right_x": 1.0,
                    "upper_right_y": 0.0
                },
                "crop_ratio": "free",
                "crop_scale": 1.0,
                "duration": duration_us,
                "extra_type_option": 0,
                "formula_id": "",
                "freeze": None,
                "gameplay": None,
                "has_audio": True,
                "height": 1080,
                "id": material_id,
                "intensifies_audio_path": "",
                "intensifies_path": "",
                "is_ai_generate_content": False,
                "is_unified_beauty_mode": False,
                "local_id": "",
                "local_material_id": "",
                "material_id": "",
                "material_name": Path(video_path).stem,
                "material_url": "",
                "matting": {
                    "flag": 0,
                    "has_use_quick_brush": False,
                    "has_use_quick_eraser": False,
                    "interactiveTime": [],
                    "path": "",
                    "strokes": []
                },
                "media_path": "",
                "object_locked": None,
                "path": video_path,
                "picture_from": "none",
                "picture_set_category_id": "",
                "picture_set_category_name": "",
                "request_id": "",
                "reverse_intensifies_path": "",
                "reverse_path": "",
                "source_platform": 0,
                "stable": None,
                "team_id": "",
                "type": "video",
                "video_algorithm": {
                    "algorithms": [],
                    "deflicker": None,
                    "motion_blur_config": None,
                    "noise_reduction": None,
                    "path": "",
                    "time_range": None
                },
                "width": 1920
            })

            # 添加轨道片段
            video_track["segments"].append({
                "cartoon": False,
                "clip": {
                    "alpha": 1.0,
                    "flip": {
                        "horizontal": False,
                        "vertical": False
                    },
                    "rotation": 0.0,
                    "scale": {
                        "x": 1.0,
                        "y": 1.0
                    },
                    "transform": {
                        "x": 0.0,
                        "y": 0.0
                    }
                },
                "common_keyframes": [],
                "enable_adjust": True,
                "enable_color_curves": True,
                "enable_color_match_adjust": False,
                "enable_color_wheels": True,
                "enable_lut": True,
                "enable_smart_color_adjust": False,
                "extra_material_refs": [],
                "group_id": "",
                "hdr_settings": {
                    "intensity": 1.0,
                    "mode": 1,
                    "nits": 1000
                },
                "id": segment_id,
                "intensifies_audio": False,
                "is_placeholder": False,
                "is_tone_modify": False,
                "keyframe_refs": [],
                "last_nonzero_volume": 1.0,
                "material_id": material_id,
                "render_index": 0,
                "reverse": False,
                "source_timerange": {
                    "duration": duration_us,
                    "start": 0
                },
                "speed": 1.0,
                "target_timerange": {
                    "duration": duration_us,
                    "start": current_time
                },
                "template_id": "",
                "template_scene": "default",
                "track_attribute": 0,
                "track_render_index": 0,
                "uniform_scale": {
                    "on": True,
                    "value": 1.0
                },
                "visible": True,
                "volume": 1.0
            })

            current_time += duration_us

        # 完整的 draft_content 结构
        draft_content = {
            "canvas_config": {
                "height": 1080,
                "ratio": "16:9",
                "width": 1920
            },
            "color_space": 0,
            "duration": current_time,
            "fps": 30,
            "id": str(uuid.uuid4()),
            "materials": {
                "audios": [],
                "canvases": [],
                "effects": [],
                "images": [],
                "speeds": [],
                "stickers": [],
                "texts": [],
                "transitions": [],
                "videos": video_materials
            },
            "name": project_name,
            "tracks": [video_track],
            "version": 1
        }

        return draft_content

    @staticmethod
    def _generate_draft_meta_info(project_name: str, draft_path: Path, videos: List[Dict]) -> Dict:
        """生成 draft_meta_info.json"""
        draft_id = str(uuid.uuid4())
        current_time_us = int(time.time() * 1000000)

        # 计算总时长
        total_duration = sum(int(v["duration"] * 1000000) for v in videos)

        draft_meta_info = {
            "draft_cloud_capcut_purchase_info": "",
            "draft_cloud_last_action_download": False,
            "draft_cloud_purchase_info": "",
            "draft_cloud_template_id": "",
            "draft_cloud_tutorial_info": "",
            "draft_cloud_videocut_purchase_info": "",
            "draft_cover": "",
            "draft_deeplink_url": "",
            "draft_fold_path": str(draft_path.absolute()),
            "draft_id": draft_id,
            "draft_is_article_video_draft": False,
            "draft_is_from_deeplink": "false",
            "draft_materials": [
                {
                    "create_time": current_time_us,
                    "duration": 0,
                    "extra_info": "",
                    "file_Path": "",
                    "height": 0,
                    "id": str(uuid.uuid4()),
                    "import_time": current_time_us,
                    "import_time_ms": current_time_us // 1000,
                    "item_source": 1,
                    "md5": "",
                    "metetype": "video",
                    "roughcut_time_range": {
                        "duration": -1,
                        "start": -1
                    },
                    "sub_time_range": {
                        "duration": -1,
                        "start": -1
                    },
                    "type": 0,
                    "width": 0,
                    "value": [
                        {
                            "create_time": current_time_us,
                            "duration": int(v["duration"] * 1000000),
                            "extra_info": Path(v["path"]).name,
                            "file_Path": v["path"],
                            "height": 1080,
                            "id": str(uuid.uuid4()),
                            "import_time": current_time_us,
                            "import_time_ms": current_time_us // 1000,
                            "item_source": 1,
                            "md5": "",
                            "metetype": "video",
                            "roughcut_time_range": {
                                "duration": -1,
                                "start": -1
                            },
                            "sub_time_range": {
                                "duration": -1,
                                "start": -1
                            },
                            "type": 0,
                            "width": 1920
                        }
                        for v in videos
                    ]
                }
            ],
            "draft_materials_copied_info": [],
            "draft_name": project_name,
            "draft_removable_storage_device": "",
            "draft_root_path": "",
            "draft_segment_extra_info": [],
            "draft_timeline_materials_size_": 0,
            "tm_draft_cloud_completed": "",
            "tm_draft_cloud_modified": 0,
            "tm_draft_create": current_time_us,
            "tm_draft_modified": current_time_us,
            "tm_duration": total_duration
        }

        return draft_meta_info

    @staticmethod
    async def export_to_jiaying(
        project_id: str,
        episode_id: str,
        storyboard_ids: Optional[List[str]] = None,
        mode: str = "new",
        project_name: Optional[str] = None,
        existing_project_id: Optional[str] = None
    ):
        """导出到剪映"""
        try:
            JianyingExportService._update_status(
                project_id,
                status="processing",
                progress=0,
                current_step="检测剪映安装",
                method=mode
            )

            # 1. 检测剪映路径
            jiaying_path = JianyingExportService.detect_jiaying_path()
            if not jiaying_path:
                raise Exception("未检测到剪映安装")

            JianyingExportService._update_status(
                project_id,
                progress=10,
                current_step="收集视频文件"
            )

            # 2. 收集视频
            videos = await JianyingExportService._collect_videos(
                project_id,
                episode_id,
                storyboard_ids
            )

            if not videos:
                raise Exception("没有找到可导出的视频")

            JianyingExportService._update_status(
                project_id,
                progress=30,
                current_step=f"准备导出 {len(videos)} 个视频"
            )

            # 3. 创建新项目
            if mode == "new":
                if not project_name:
                    project_name = f"CreateNow_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

                draft_path = jiaying_path / project_name

                # 如果目录已存在，添加后缀
                counter = 1
                while draft_path.exists():
                    draft_path = jiaying_path / f"{project_name}_{counter}"
                    counter += 1

                JianyingExportService._update_status(
                    project_id,
                    progress=50,
                    current_step="创建剪映项目"
                )

                # 创建目录
                draft_path.mkdir(parents=True, exist_ok=True)

                # 生成 draft_content.json
                draft_content = JianyingExportService._generate_draft_content(project_name, videos)
                with open(draft_path / "draft_content.json", 'w', encoding='utf-8') as f:
                    json.dump(draft_content, f, ensure_ascii=False, indent=2)

                # 生成 draft_meta_info.json
                draft_meta_info = JianyingExportService._generate_draft_meta_info(project_name, draft_path, videos)
                with open(draft_path / "draft_meta_info.json", 'w', encoding='utf-8') as f:
                    json.dump(draft_meta_info, f, ensure_ascii=False, indent=2)

                logger.info(f"Created JianYing project at: {draft_path}")

                JianyingExportService._update_status(
                    project_id,
                    status="completed",
                    progress=100,
                    current_step="导出完成",
                    path=str(draft_path),
                    message=f"已创建项目：{project_name}"
                )

            else:
                # 导入到现有项目（暂不实现）
                raise Exception("导入到现有项目功能暂未实现")

        except Exception as e:
            logger.error(f"Export to Jiaying failed: {e}", exc_info=True)
            JianyingExportService._update_status(
                project_id,
                status="error",
                current_step="导出失败",
                errors=[str(e)]
            )
