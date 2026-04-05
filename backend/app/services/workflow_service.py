"""工作流服务：DAG 校验与基础执行器（MVP）"""

import asyncio
import uuid
from datetime import datetime
from typing import Any, Dict, List, Set, Tuple

from fastapi import HTTPException

from app.services.asset_service import AssetService, ImageService, ProjectService
from app.services.canvas_service import CanvasService
from app.services import get_ai_service, PromptService
from app.services.image_download_service import ImageDownloadService
from app.api.generation.utils import check_project_budget, parse_size
from app.api.generation.templates import DEFAULT_PROMPT_TEMPLATES
from app.core.context import get_current_data_root


def _get_projects_dir():
    from app.core.config import settings
    data_root = get_current_data_root()
    if data_root:
        return data_root / "projects"
    return settings.PROJECTS_DIR


class WorkflowService:
    """画布工作流服务"""

    _RUN_TASKS: Dict[str, asyncio.Task] = {}

    _SUPPORTED_NODE_TYPES = {
        "trigger.manual",
        "input.asset",
        "prompt.compose",
        "gen.llm",
        "analysis.vlm",
        "gen.image",
        "gen.fusion_image",
        "gen.video",
        "output.save_asset",
    }

    _PORT_TYPES = {"text", "image", "image_list", "video", "json"}

    @staticmethod
    def _node_map(nodes: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        m: Dict[str, Dict[str, Any]] = {}
        for n in nodes:
            node_id = str(n.get("node_id") or "").strip()
            if node_id:
                m[node_id] = n
        return m

    @staticmethod
    def _build_graph(nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> Tuple[Dict[str, List[str]], Dict[str, int]]:
        node_ids = {n.get("node_id") for n in nodes if n.get("node_id")}
        graph: Dict[str, List[str]] = {nid: [] for nid in node_ids}
        indegree: Dict[str, int] = {nid: 0 for nid in node_ids}

        for e in edges:
            s = e.get("source_node_id")
            t = e.get("target_node_id")
            if s in node_ids and t in node_ids:
                graph[s].append(t)
                indegree[t] += 1

        return graph, indegree

    @staticmethod
    def _topological_order(nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> List[str]:
        graph, indegree = WorkflowService._build_graph(nodes, edges)
        queue = [nid for nid, d in indegree.items() if d == 0]
        order: List[str] = []

        while queue:
            current = queue.pop(0)
            order.append(current)
            for nxt in graph.get(current, []):
                indegree[nxt] -= 1
                if indegree[nxt] == 0:
                    queue.append(nxt)

        if len(order) != len(indegree):
            return []
        return order

    @staticmethod
    def validate_canvas(canvas: Dict[str, Any]) -> Dict[str, Any]:
        nodes = canvas.get("nodes") or []
        edges = canvas.get("edges") or []

        errors: List[str] = []
        warnings: List[str] = []

        node_ids: Set[str] = set()
        for node in nodes:
            node_id = str(node.get("node_id") or "").strip()
            if not node_id:
                errors.append("存在缺少 node_id 的节点")
                continue
            if node_id in node_ids:
                errors.append(f"节点 ID 重复: {node_id}")
            node_ids.add(node_id)

            node_type = node.get("type")
            if node_type not in WorkflowService._SUPPORTED_NODE_TYPES:
                warnings.append(f"节点 {node_id} 使用了当前未执行支持的类型: {node_type}")

        edge_ids: Set[str] = set()
        for edge in edges:
            edge_id = str(edge.get("edge_id") or "").strip()
            if not edge_id:
                errors.append("存在缺少 edge_id 的连线")
            elif edge_id in edge_ids:
                errors.append(f"连线 ID 重复: {edge_id}")
            edge_ids.add(edge_id)

            source = edge.get("source_node_id")
            target = edge.get("target_node_id")
            if source not in node_ids:
                errors.append(f"连线 {edge_id} 的 source_node_id 不存在: {source}")
            if target not in node_ids:
                errors.append(f"连线 {edge_id} 的 target_node_id 不存在: {target}")

            spt = edge.get("source_port_type")
            tpt = edge.get("target_port_type")
            if spt and spt not in WorkflowService._PORT_TYPES:
                errors.append(f"连线 {edge_id} 的 source_port_type 非法: {spt}")
            if tpt and tpt not in WorkflowService._PORT_TYPES:
                errors.append(f"连线 {edge_id} 的 target_port_type 非法: {tpt}")
            if spt and tpt and spt != tpt:
                errors.append(f"连线 {edge_id} 端口类型不匹配: {spt} -> {tpt}")

        order = WorkflowService._topological_order(nodes, edges)
        if nodes and not order:
            errors.append("工作流存在环路，必须为有向无环图 (DAG)")

        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings,
            "node_count": len(nodes),
            "edge_count": len(edges),
        }

    @staticmethod
    def _resolve_value(value: Any, context: Dict[str, Any]) -> Any:
        if not isinstance(value, str):
            return value

        text = value
        if text.startswith("{{") and text.endswith("}}"):
            key_path = text[2:-2].strip()
            # 只做最小可行解析：vars.xxx / node_outputs.nodeId
            if key_path.startswith("vars."):
                k = key_path[5:]
                return context.get("vars", {}).get(k)
            if key_path.startswith("node_outputs."):
                parts = key_path.split(".")
                if len(parts) >= 2:
                    node_id = parts[1]
                    result = context.get("node_outputs", {}).get(node_id)
                    if len(parts) == 2:
                        return result
                    # 支持一层字段取值
                    if isinstance(result, dict):
                        return result.get(parts[2])
        return value

    @staticmethod
    def _resolve_config(config: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        resolved: Dict[str, Any] = {}
        for k, v in (config or {}).items():
            if isinstance(v, dict):
                resolved[k] = WorkflowService._resolve_config(v, context)
            elif isinstance(v, list):
                resolved[k] = [WorkflowService._resolve_value(x, context) for x in v]
            else:
                resolved[k] = WorkflowService._resolve_value(v, context)
        return resolved

    @staticmethod
    async def _execute_node(
        project_id: str,
        canvas_id: str,
        run_id: str,
        node: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        node_type = node.get("type")
        node_id = node.get("node_id")
        config = WorkflowService._resolve_config(node.get("config") or {}, context)

        if node_type == "trigger.manual":
            return {"triggered": True}

        if node_type == "input.asset":
            asset_id = config.get("asset_id")
            asset_type = config.get("asset_type")
            if not asset_id or not asset_type:
                raise ValueError("input.asset 缺少 asset_id 或 asset_type")

            asset = AssetService.load_asset(project_id, asset_type, asset_id)
            if not asset:
                raise ValueError(f"资产不存在: {asset_type}/{asset_id}")

            image_id = asset.get("image_id")
            return {
                "asset_id": asset_id,
                "asset_type": asset_type,
                "asset": asset,
                "image_id": image_id,
            }

        if node_type == "prompt.compose":
            template = str(config.get("template") or config.get("prompt") or "").strip()
            if not template:
                raise ValueError("prompt.compose 缺少 template/prompt")
            return {"prompt": template}

        if node_type == "gen.fusion_image":
            project = ProjectService.get_project(project_id)
            if not project:
                raise ValueError("项目不存在")
            check_project_budget(project)

            ai_config = project.get("ai_config", {})
            image_service = get_ai_service(ai_config, "image", project_id)
            try:
                prompt = str(config.get("prompt") or "").strip()
                image_id = config.get("image_id")
                if not prompt:
                    raise ValueError("gen.fusion_image 缺少 prompt")
                if not image_id:
                    raise ValueError("gen.fusion_image 缺少 image_id")

                base_image = ImageService.get_image(project_id, image_id)
                if not base_image:
                    raise ValueError(f"参考图片不存在: {image_id}")

                image_url = base_image.get("image_path")
                if not image_url:
                    local_path = base_image.get("local_path")
                    if local_path:
                        local_file = CanvasService.get_canvas_dir(project_id).parent / "images" / "files" / local_path
                        if local_file.exists():
                            from app.services.image_download_service import ImageDownloadService

                            image_url = ImageDownloadService.image_to_base64_url(local_file)
                if not image_url:
                    raise ValueError("gen.fusion_image 无可用参考图")

                model = config.get("model") or ai_config.get("image", {}).get("image_edit_model") or ai_config.get("image", {}).get("model")
                size = config.get("size")

                result = await image_service.edit(
                    image_path=image_url,
                    prompt=prompt,
                    reference_images=config.get("reference_images"),
                    model=model,
                    size=size,
                )
                return {
                    "image_url": result.get("image_url"),
                    "revised_prompt": result.get("revised_prompt"),
                }
            finally:
                await image_service.close()

        if node_type == "gen.llm":
            project = ProjectService.get_project(project_id)
            if not project:
                raise ValueError("项目不存在")
            ai_config = project.get("ai_config", {})
            llm = get_ai_service(ai_config, "llm", project_id)
            try:
                prompt = str(config.get("prompt") or config.get("template") or "").strip()
                if not prompt:
                    raise ValueError("gen.llm 缺少 prompt")
                system_prompt = config.get("system_prompt") or None
                temperature = float(config.get("temperature") or 0.7)
                max_tokens = int(config.get("max_tokens") or 32000)
                messages = [{"role": "user", "content": prompt}]
                result = await llm.chat(messages, system_prompt=system_prompt, temperature=temperature, max_tokens=max_tokens)
                if result.get("error"):
                    raise ValueError(f"LLM 调用失败: {result['error']}")
                return {"text": result.get("content", ""), "usage": result.get("usage", {})}
            finally:
                await llm.close()

        if node_type == "analysis.vlm":
            project = ProjectService.get_project(project_id)
            if not project:
                raise ValueError("项目不存在")
            ai_config = project.get("ai_config", {})
            vlm_config = ai_config.get("vlm", {})
            if vlm_config.get("api_url") and vlm_config.get("api_key"):
                vlm = get_ai_service(ai_config, "vlm", project_id)
            else:
                vlm = get_ai_service(ai_config, "llm", project_id)
            try:
                image_id = config.get("image_id")
                image_ids_raw = config.get("image_ids")
                if image_ids_raw and isinstance(image_ids_raw, list):
                    image_ids = image_ids_raw
                elif image_id:
                    image_ids = [image_id]
                else:
                    raise ValueError("analysis.vlm 缺少 image_id 或 image_ids")
                system_prompt = config.get("system_prompt") or "请分析这张图片。"
                user_text = config.get("user_text") or "请分析这些图片："
                from app.core.config import settings as _settings
                image_base64_list = []
                for img_id in image_ids:
                    img = ImageService.get_image(project_id, img_id)
                    if not img:
                        raise ValueError(f"图片不存在: {img_id}")
                    local_path = img.get("local_path")
                    if local_path:
                        local_file = _get_projects_dir() / project_id / "images" / "files" / local_path
                        if local_file.exists():
                            base64_url = ImageDownloadService.image_to_base64_url(local_file)
                            image_base64_list.append(base64_url)
                            continue
                    image_path = img.get("image_path")
                    if image_path and image_path.startswith(("http://", "https://")):
                        image_base64_list.append(image_path)
                    else:
                        raise ValueError(f"图片 {img_id} 无可用路径（无本地文件且无外部URL）")
                text = await PromptService.call_vlm_with_images(vlm, system_prompt, image_base64_list, user_text)
                return {"text": text}
            finally:
                await vlm.close()

        if node_type == "gen.image":
            project = ProjectService.get_project(project_id)
            if not project:
                raise ValueError("项目不存在")
            check_project_budget(project)
            ai_config = project.get("ai_config", {})
            image_service = get_ai_service(ai_config, "image", project_id)
            try:
                prompt = str(config.get("prompt") or "").strip()
                if not prompt:
                    raise ValueError("gen.image 缺少 prompt")
                size_str = str(config.get("size") or "1x1")
                width, height = parse_size(size_str)
                result = await image_service.generate(
                    prompt=prompt,
                    negative_prompt=str(config.get("negative_prompt") or ""),
                    width=width,
                    height=height,
                    size_str=size_str,
                    model=config.get("model") or None,
                )
                if not result.get("success"):
                    raise ValueError(f"gen.image 生成失败: {result.get('error')}")
                image_url = result.get("image_url")
                record = {
                    "asset_id": f"wf_{node_id}_{run_id[:8]}",
                    "asset_type": "workflow",
                    "prompt": prompt,
                    "negative_prompt": str(config.get("negative_prompt") or ""),
                    "width": width,
                    "height": height,
                    "image_path": image_url,
                    "model": ai_config.get("image", {}).get("model", ""),
                    "created_at": datetime.now().isoformat(),
                }
                saved = ImageService.save_generation_record(project_id, record)
                image_id = saved["image_id"]
                if image_url and image_url.startswith(("http://", "https://")):
                    try:
                        await ImageDownloadService.download_and_save_image(
                            project_id=project_id,
                            image_id=image_id,
                            url=image_url,
                            asset_type="workflow",
                        )
                    except Exception as _e:
                        import logging as _logging
                        _logging.getLogger(__name__).warning(f"[gen.image] 自动下载失败: {_e}")
                return {
                    "image_url": image_url,
                    "image_id": image_id,
                    "revised_prompt": result.get("revised_prompt"),
                }
            finally:
                await image_service.close()

        if node_type == "gen.video":
            project = ProjectService.get_project(project_id)
            if not project:
                raise ValueError("项目不存在")
            check_project_budget(project)

            ai_config = project.get("ai_config", {})
            video_service = get_ai_service(ai_config, "video", project_id)
            try:
                prompt = str(config.get("prompt") or "").strip()
                image_url = config.get("image_url")
                # 如果只有 image_id，尝试解析为可用 URL
                if not image_url:
                    img_id = config.get("image_id")
                    if img_id:
                        img = ImageService.get_image(project_id, img_id)
                        if img:
                            from app.core.config import settings as _settings
                            local_path = img.get("local_path")
                            if local_path:
                                local_file = _get_projects_dir() / project_id / "images" / "files" / local_path
                                if local_file.exists():
                                    image_url = ImageDownloadService.image_to_base64_url(local_file)
                            if not image_url:
                                image_url = img.get("image_path")
                if not prompt:
                    raise ValueError("gen.video 缺少 prompt")
                if not image_url:
                    raise ValueError("gen.video 缺少 image_url")

                result = await video_service.generate(
                    image_url=image_url,
                    prompt=prompt,
                    duration=int(config.get("duration") or 6),
                    resolution=str(config.get("resolution") or "1920x1080"),
                    use_multipart=bool(config.get("use_multipart", True)),
                )
                return {
                    "success": bool(result.get("success")),
                    "task_id": result.get("task_id"),
                    "video_url": result.get("video_url"),
                    "raw": result,
                }
            finally:
                await video_service.close()

        if node_type == "output.save_asset":
            return {"saved": True, "data": config}

        raise ValueError(f"不支持的节点类型: {node_type}")

    @staticmethod
    def _collect_ready_nodes(nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]], done: Set[str]) -> List[str]:
        node_ids = [n.get("node_id") for n in nodes if n.get("node_id")]
        ready: List[str] = []

        incoming: Dict[str, List[str]] = {nid: [] for nid in node_ids}
        for e in edges:
            s = e.get("source_node_id")
            t = e.get("target_node_id")
            if s in incoming and t in incoming:
                incoming[t].append(s)

        for nid in node_ids:
            if nid in done:
                continue
            deps = incoming.get(nid) or []
            if all(dep in done for dep in deps):
                ready.append(nid)
        return ready

    @staticmethod
    async def _run_worker(project_id: str, canvas_id: str, run_id: str) -> None:
        run = CanvasService.get_run(project_id, canvas_id, run_id)
        canvas = CanvasService.get_canvas(project_id, canvas_id)
        if not run or not canvas:
            return

        nodes = canvas.get("nodes") or []
        edges = canvas.get("edges") or []
        node_map = WorkflowService._node_map(nodes)

        context: Dict[str, Any] = {
            "vars": canvas.get("variables") or {},
            "node_outputs": {},
            "system": {
                "project_id": project_id,
                "canvas_id": canvas_id,
                "run_id": run_id,
                "timestamp": datetime.now().isoformat(),
            },
        }

        CanvasService.update_run(
            project_id,
            canvas_id,
            run_id,
            {
                "status": "running",
                "started_at": datetime.now().isoformat(),
            },
        )
        CanvasService.append_run_event(project_id, canvas_id, run_id, {"event": "run_started"})

        done: Set[str] = set()
        failed = False

        while len(done) < len(node_map):
            current = CanvasService.get_run(project_id, canvas_id, run_id)
            if not current:
                return
            if current.get("cancel_requested"):
                CanvasService.update_run(
                    project_id,
                    canvas_id,
                    run_id,
                    {
                        "status": "canceled",
                        "finished_at": datetime.now().isoformat(),
                    },
                )
                CanvasService.append_run_event(project_id, canvas_id, run_id, {"event": "run_canceled"})
                return

            ready = WorkflowService._collect_ready_nodes(nodes, edges, done)
            if not ready:
                # 理论上不会到这里（前面已校验 DAG），兜底
                failed = True
                CanvasService.append_run_event(project_id, canvas_id, run_id, {
                    "event": "no_ready_nodes",
                    "done": list(done),
                })
                break

            progressed = False
            for node_id in ready:
                if node_id in done:
                    continue
                node = node_map[node_id]

                run_snapshot = CanvasService.get_run(project_id, canvas_id, run_id) or {}
                node_states = dict(run_snapshot.get("node_states") or {})
                node_states[node_id] = {
                    "status": "running",
                    "started_at": datetime.now().isoformat(),
                    "finished_at": None,
                    "error": None,
                }
                CanvasService.update_run(project_id, canvas_id, run_id, {"node_states": node_states})
                CanvasService.append_run_event(project_id, canvas_id, run_id, {
                    "event": "node_started",
                    "node_id": node_id,
                    "node_type": node.get("type"),
                })

                try:
                    # 连线驱动入参注入：把上游节点输出按端口映射合并到当前节点 config
                    wire_overrides: Dict[str, Any] = {}
                    for edge in edges:
                        if edge.get("target_node_id") != node_id:
                            continue
                        source_id = edge.get("source_node_id")
                        source_port = str(edge.get("source_port") or "out")
                        target_port = str(edge.get("target_port") or "in")
                        source_output = context["node_outputs"].get(source_id)
                        if source_output is None:
                            continue
                        if source_port == "out":
                            val = source_output
                        elif isinstance(source_output, dict):
                            val = source_output.get(source_port)
                        else:
                            val = source_output
                        if val is not None:
                            wire_overrides[target_port] = val
                    if wire_overrides:
                        merged_config = {**(node.get("config") or {}), **wire_overrides}
                        node = {**node, "config": merged_config}

                    output = await WorkflowService._execute_node(project_id, canvas_id, run_id, node, context)
                    context["node_outputs"][node_id] = output
                    done.add(node_id)
                    progressed = True

                    node_states = dict((CanvasService.get_run(project_id, canvas_id, run_id) or {}).get("node_states") or {})
                    node_states[node_id] = {
                        "status": "succeeded",
                        "started_at": node_states.get(node_id, {}).get("started_at"),
                        "finished_at": datetime.now().isoformat(),
                        "error": None,
                    }

                    outputs = dict((CanvasService.get_run(project_id, canvas_id, run_id) or {}).get("outputs") or {})
                    outputs[node_id] = output
                    CanvasService.update_run(
                        project_id,
                        canvas_id,
                        run_id,
                        {
                            "node_states": node_states,
                            "outputs": outputs,
                        },
                    )
                    CanvasService.append_run_event(project_id, canvas_id, run_id, {
                        "event": "node_succeeded",
                        "node_id": node_id,
                    })
                except Exception as e:
                    failed = True
                    node_states = dict((CanvasService.get_run(project_id, canvas_id, run_id) or {}).get("node_states") or {})
                    node_states[node_id] = {
                        "status": "failed",
                        "started_at": node_states.get(node_id, {}).get("started_at"),
                        "finished_at": datetime.now().isoformat(),
                        "error": str(e),
                    }
                    CanvasService.update_run(
                        project_id,
                        canvas_id,
                        run_id,
                        {
                            "node_states": node_states,
                            "status": "failed",
                            "error": f"节点 {node_id} 执行失败: {e}",
                            "finished_at": datetime.now().isoformat(),
                        },
                    )
                    CanvasService.append_run_event(project_id, canvas_id, run_id, {
                        "event": "node_failed",
                        "node_id": node_id,
                        "error": str(e),
                    })
                    return

            if not progressed:
                failed = True
                break

        final_status = "failed" if failed else "succeeded"
        CanvasService.update_run(
            project_id,
            canvas_id,
            run_id,
            {
                "status": final_status,
                "finished_at": datetime.now().isoformat(),
            },
        )
        CanvasService.append_run_event(project_id, canvas_id, run_id, {
            "event": "run_finished",
            "status": final_status,
        })

    @staticmethod
    async def start_run(project_id: str, canvas_id: str, trigger: str = "manual") -> Dict[str, Any]:
        canvas = CanvasService.get_canvas(project_id, canvas_id)
        if not canvas:
            raise HTTPException(status_code=404, detail="Canvas not found")

        validation = WorkflowService.validate_canvas(canvas)
        if not validation["valid"]:
            raise HTTPException(status_code=400, detail={
                "message": "Workflow validation failed",
                **validation,
            })

        run_id = str(uuid.uuid4())
        run = CanvasService.create_run(
            project_id,
            canvas_id,
            {
                "run_id": run_id,
                "status": "validating",
                "trigger": trigger,
                "validation": validation,
            },
        )
        CanvasService.append_run_event(project_id, canvas_id, run_id, {
            "event": "run_created",
            "trigger": trigger,
        })

        task_key = f"{project_id}:{canvas_id}:{run_id}"
        task = asyncio.create_task(WorkflowService._run_worker(project_id, canvas_id, run_id))
        WorkflowService._RUN_TASKS[task_key] = task

        def _cleanup(_task: asyncio.Task) -> None:
            WorkflowService._RUN_TASKS.pop(task_key, None)

        task.add_done_callback(_cleanup)
        return run

    @staticmethod
    def request_cancel(project_id: str, canvas_id: str, run_id: str) -> Dict[str, Any]:
        before = CanvasService.get_run(project_id, canvas_id, run_id)
        run = CanvasService.cancel_run(project_id, canvas_id, run_id)
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")

        if before and before.get("status") != run.get("status") and run.get("status") == "canceling":
            CanvasService.append_run_event(project_id, canvas_id, run_id, {
                "event": "cancel_requested",
            })
        return run
