from __future__ import annotations

import asyncio
import copy
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
TARGETS_FILE = DATA_DIR / "targets.json"
REQUEST_TIMEOUT = httpx.Timeout(12.0, connect=6.0)
MAX_CONCURRENT_CHECKS = 8
SERVICE_TYPES = ("llm", "vlm", "image", "video", "tts")

app = FastAPI(title="CreateNow Ops Dashboard", version="0.1.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class TargetInput(BaseModel):
    name: str = ""
    url: str
    username: str
    password: str
    verify_ssl: bool = Field(default=False)


class CheckRequest(BaseModel):
    targets: list[TargetInput]


class UpdateRequest(BaseModel):
    target: TargetInput


class ModelConfigRequest(BaseModel):
    target: TargetInput


class SaveModelConfigRequest(BaseModel):
    target: TargetInput
    config: dict[str, Any]


class ProjectModelRequest(BaseModel):
    target: TargetInput
    models: dict[str, str]
    project_ids: list[str] | None = None


def read_saved_targets() -> list[dict[str, Any]]:
    if not TARGETS_FILE.exists():
        return []
    with open(TARGETS_FILE, "r", encoding="utf-8") as file:
        data = json.load(file)
    if isinstance(data, dict):
        targets = data.get("targets", [])
    else:
        targets = data
    return targets if isinstance(targets, list) else []


def write_saved_targets(targets: list[TargetInput]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    data = {"targets": [target.model_dump() for target in targets]}
    with open(TARGETS_FILE, "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)


def normalize_base_url(raw_url: str) -> str:
    value = raw_url.strip()
    if not value:
        raise ValueError("网址不能为空")
    if not value.startswith(("http://", "https://")):
        value = f"https://{value}"
    parsed = urlparse(value)
    if not parsed.netloc:
        raise ValueError("网址格式不正确")
    return value.rstrip("/")


def pick_error_message(exc: Exception) -> str:
    if isinstance(exc, httpx.ConnectTimeout):
        return "连接超时"
    if isinstance(exc, httpx.ReadTimeout):
        return "响应超时"
    if isinstance(exc, httpx.ConnectError):
        return "无法连接，请检查公网地址、端口或证书设置"
    if isinstance(exc, ValueError):
        return str(exc)
    return str(exc) or exc.__class__.__name__


def extract_response_error(response: httpx.Response) -> str:
    try:
        data = response.json()
        if isinstance(data, dict):
            detail = data.get("detail") or data.get("message") or data.get("error")
            if detail:
                return str(detail)
    except Exception:
        pass
    return response.text[:240]


async def login(client: httpx.AsyncClient, base_url: str, username: str, password: str) -> str:
    response = await client.post(
        f"{base_url}/api/admin/login",
        data={"username": username, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    if response.status_code in (401, 403):
        raise PermissionError("账号或密码错误，或不是管理员账号")
    response.raise_for_status()
    data = response.json()
    token = data.get("access_token")
    if not token:
        raise RuntimeError("登录成功但未返回 access_token")
    return str(token)


async def fetch_json(client: httpx.AsyncClient, url: str, token: str) -> dict[str, Any]:
    response = await client.get(url, headers={"Authorization": f"Bearer {token}"})
    response.raise_for_status()
    data = response.json()
    return data if isinstance(data, dict) else {"value": data}


async def put_json(client: httpx.AsyncClient, url: str, token: str, body: dict[str, Any]) -> dict[str, Any]:
    response = await client.put(
        url,
        json=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    if response.status_code >= 400:
        raise httpx.HTTPStatusError(extract_response_error(response), request=response.request, response=response)
    data = response.json()
    return data if isinstance(data, dict) else {"value": data}


def normalize_models(models: dict[str, str]) -> dict[str, str]:
    normalized: dict[str, str] = {}
    for service_type, model in (models or {}).items():
        service = str(service_type or "").strip()
        value = str(model or "").strip()
        if service and value:
            normalized[service] = value
    return normalized


def project_list_from_response(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict):
        projects = data.get("projects")
        if isinstance(projects, list):
            return [item for item in projects if isinstance(item, dict)]
        value = data.get("value")
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def sync_project_ai_config(project: dict[str, Any], models: dict[str, str]) -> dict[str, Any]:
    project_id = str(project.get("project_id") or project.get("id") or "")
    name = str(project.get("name") or project_id or "未命名项目")
    ai_config = project.get("ai_config")
    if not isinstance(ai_config, dict):
        return {
            "project_id": project_id,
            "name": name,
            "status": "skipped",
            "changed_services": [],
            "message": "项目没有可更新的 ai_config，已跳过",
            "ai_config": None,
        }

    updated_ai_config = copy.deepcopy(ai_config)
    changed_services: list[str] = []
    notes: list[str] = []

    for service_type, target_model in models.items():
        service_config = updated_ai_config.get(service_type)
        if not isinstance(service_config, dict):
            notes.append(f"{service_type}: 缺少服务配置")
            continue

        service_changed = False
        old_model = str(service_config.get("model") or "").strip()
        if old_model != target_model:
            service_config["model"] = target_model
            service_changed = True

        presets_by_type = updated_ai_config.get("config_presets")
        active_ids = updated_ai_config.get("active_preset_ids")
        if isinstance(presets_by_type, dict) and isinstance(active_ids, dict):
            presets = presets_by_type.get(service_type)
            active_id = active_ids.get(service_type)
            if isinstance(presets, list) and active_id:
                active_preset = next((preset for preset in presets if isinstance(preset, dict) and preset.get("id") == active_id), None)
                if isinstance(active_preset, dict):
                    preset_config = active_preset.get("config")
                    if isinstance(preset_config, dict):
                        preset_model = str(preset_config.get("model") or "").strip()
                        if preset_model != target_model:
                            preset_config["model"] = target_model
                            service_changed = True
                    else:
                        notes.append(f"{service_type}: 当前预设缺少 config")
                else:
                    notes.append(f"{service_type}: 未找到当前激活预设")
            elif isinstance(presets, list) and presets:
                notes.append(f"{service_type}: 未设置当前激活预设")

        if service_changed:
            changed_services.append(service_type)

    status = "changed" if changed_services else "unchanged"
    message = "将更新 " + ", ".join(changed_services) if changed_services else "模型已一致，无需更新"
    if notes:
        message = f"{message}；" + "；".join(notes)

    return {
        "project_id": project_id,
        "name": name,
        "status": status,
        "changed_services": changed_services,
        "message": message,
        "ai_config": updated_ai_config,
    }


async def trigger_remote_update(target: TargetInput) -> dict[str, Any]:
    safe_name = target.name.strip() or target.url.strip()
    result: dict[str, Any] = {
        "name": safe_name,
        "url": target.url.strip(),
        "base_url": "",
        "status": "update_failed",
        "message": "",
        "response": None,
    }

    try:
        base_url = normalize_base_url(target.url)
        result["base_url"] = base_url
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, verify=target.verify_ssl, follow_redirects=True) as client:
            token = await login(client, base_url, target.username, target.password)
            response = await client.post(
                f"{base_url}/api/version/update",
                headers={"Authorization": f"Bearer {token}"},
            )
            if response.status_code in (401, 403):
                raise PermissionError("账号无权触发更新")
            response.raise_for_status()
            data = response.json()
            result["status"] = "update_started"
            result["message"] = str(data.get("message") or "更新已启动，客户服务将自动重启")
            result["response"] = data
    except PermissionError as exc:
        result["status"] = "auth_failed"
        result["message"] = str(exc)
    except httpx.HTTPStatusError as exc:
        result["status"] = "update_failed"
        result["message"] = f"HTTP {exc.response.status_code}: {extract_response_error(exc.response)}"
    except Exception as exc:
        result["status"] = "update_failed"
        result["message"] = pick_error_message(exc)

    return result


async def fetch_remote_model_config(target: TargetInput) -> dict[str, Any]:
    safe_name = target.name.strip() or target.url.strip()
    result: dict[str, Any] = {
        "name": safe_name,
        "url": target.url.strip(),
        "base_url": "",
        "status": "failed",
        "message": "",
        "config": None,
        "deploy_mode": "",
        "app_name": "",
    }
    try:
        base_url = normalize_base_url(target.url)
        result["base_url"] = base_url
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, verify=target.verify_ssl, follow_redirects=True) as client:
            token = await login(client, base_url, target.username, target.password)
            data = await fetch_json(client, f"{base_url}/api/config", token)
            result["status"] = "ok"
            result["message"] = "模型配置读取成功"
            result["config"] = data.get("createnow_model_config") if isinstance(data, dict) else None
            result["deploy_mode"] = str(data.get("deploy_mode") or "")
            result["app_name"] = str(data.get("app_name") or "")
    except PermissionError as exc:
        result["status"] = "auth_failed"
        result["message"] = str(exc)
    except httpx.HTTPStatusError as exc:
        result["status"] = "failed"
        result["message"] = f"HTTP {exc.response.status_code}: {extract_response_error(exc.response)}"
    except Exception as exc:
        result["status"] = "failed"
        result["message"] = pick_error_message(exc)
    return result


async def save_remote_model_config(target: TargetInput, config: dict[str, Any]) -> dict[str, Any]:
    safe_name = target.name.strip() or target.url.strip()
    result: dict[str, Any] = {
        "name": safe_name,
        "url": target.url.strip(),
        "base_url": "",
        "status": "failed",
        "message": "",
        "config": None,
    }
    try:
        base_url = normalize_base_url(target.url)
        result["base_url"] = base_url
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, verify=target.verify_ssl, follow_redirects=True) as client:
            token = await login(client, base_url, target.username, target.password)
            saved = await put_json(client, f"{base_url}/api/config/createnow-models", token, config)
            result["status"] = "ok"
            result["message"] = "模型标签与新项目默认模型已保存"
            result["config"] = saved
    except PermissionError as exc:
        result["status"] = "auth_failed"
        result["message"] = str(exc)
    except httpx.HTTPStatusError as exc:
        result["status"] = "failed"
        result["message"] = f"HTTP {exc.response.status_code}: {extract_response_error(exc.response)}"
    except Exception as exc:
        result["status"] = "failed"
        result["message"] = pick_error_message(exc)
    return result


async def process_project_models(target: TargetInput, models: dict[str, str], apply_changes: bool, project_ids: list[str] | None = None) -> dict[str, Any]:
    safe_name = target.name.strip() or target.url.strip()
    normalized_models = normalize_models(models)
    result: dict[str, Any] = {
        "name": safe_name,
        "url": target.url.strip(),
        "base_url": "",
        "status": "failed",
        "message": "",
        "models": normalized_models,
        "results": [],
        "summary": {"total": 0, "changed": 0, "updated": 0, "unchanged": 0, "skipped": 0, "failed": 0},
    }
    if not normalized_models:
        result["message"] = "请至少填写一个目标模型"
        return result

    project_filter = {str(project_id) for project_id in project_ids or [] if str(project_id).strip()}

    try:
        base_url = normalize_base_url(target.url)
        result["base_url"] = base_url
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, verify=target.verify_ssl, follow_redirects=True) as client:
            token = await login(client, base_url, target.username, target.password)
            project_list_data = await fetch_json(client, f"{base_url}/api/projects", token)
            projects = project_list_from_response(project_list_data)
            if project_filter:
                projects = [project for project in projects if str(project.get("project_id") or project.get("id") or "") in project_filter]

            rows: list[dict[str, Any]] = []
            for project in projects:
                project_id = str(project.get("project_id") or project.get("id") or "")
                if not project_id:
                    rows.append({
                        "project_id": "",
                        "name": str(project.get("name") or "未知项目"),
                        "status": "skipped",
                        "changed_services": [],
                        "message": "项目缺少 project_id，已跳过",
                    })
                    continue

                try:
                    full_project = await fetch_json(client, f"{base_url}/api/projects/{project_id}", token)
                    update_plan = sync_project_ai_config(full_project, normalized_models)
                    ai_config = update_plan.pop("ai_config", None)

                    if apply_changes and update_plan["status"] == "changed" and isinstance(ai_config, dict):
                        await put_json(client, f"{base_url}/api/projects/{project_id}", token, {"ai_config": ai_config})
                        update_plan["status"] = "updated"
                        update_plan["message"] = update_plan["message"].replace("将更新", "已更新", 1)

                    rows.append(update_plan)
                except httpx.HTTPStatusError as exc:
                    rows.append({
                        "project_id": project_id,
                        "name": str(project.get("name") or project_id),
                        "status": "failed",
                        "changed_services": [],
                        "message": f"HTTP {exc.response.status_code}: {extract_response_error(exc.response)}",
                    })
                except Exception as exc:
                    rows.append({
                        "project_id": project_id,
                        "name": str(project.get("name") or project_id),
                        "status": "failed",
                        "changed_services": [],
                        "message": pick_error_message(exc),
                    })

            summary = {"total": len(rows), "changed": 0, "updated": 0, "unchanged": 0, "skipped": 0, "failed": 0}
            for row in rows:
                status = row.get("status")
                if status in summary:
                    summary[status] += 1

            result["status"] = "ok"
            result["message"] = "历史项目模型已修改" if apply_changes else "历史项目模型预览完成"
            result["results"] = rows
            result["summary"] = summary
    except PermissionError as exc:
        result["status"] = "auth_failed"
        result["message"] = str(exc)
    except httpx.HTTPStatusError as exc:
        result["status"] = "failed"
        result["message"] = f"HTTP {exc.response.status_code}: {extract_response_error(exc.response)}"
    except Exception as exc:
        result["status"] = "failed"
        result["message"] = pick_error_message(exc)

    return result


async def check_target(target: TargetInput) -> dict[str, Any]:
    safe_name = target.name.strip() or target.url.strip()
    result: dict[str, Any] = {
        "name": safe_name,
        "url": target.url.strip(),
        "base_url": "",
        "status": "checking",
        "message": "",
        "local": None,
        "remote": None,
        "has_update": None,
    }

    try:
        base_url = normalize_base_url(target.url)
        result["base_url"] = base_url
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, verify=target.verify_ssl, follow_redirects=True) as client:
            token = await login(client, base_url, target.username, target.password)
            local = await fetch_json(client, f"{base_url}/api/version", token)
            result["local"] = local
            try:
                update_info = await fetch_json(client, f"{base_url}/api/version/check", token)
                result["remote"] = update_info.get("remote")
                result["has_update"] = bool(update_info.get("has_update"))
                result["status"] = "ok"
                result["message"] = "检查完成"
            except httpx.HTTPStatusError as exc:
                result["status"] = "version_only"
                result["message"] = f"已读取本地版本，但检查更新失败：HTTP {exc.response.status_code}"
            except Exception as exc:
                result["status"] = "version_only"
                result["message"] = f"已读取本地版本，但检查更新失败：{pick_error_message(exc)}"
    except PermissionError as exc:
        result["status"] = "auth_failed"
        result["message"] = str(exc)
    except httpx.HTTPStatusError as exc:
        result["status"] = "http_error"
        result["message"] = f"HTTP {exc.response.status_code}: {extract_response_error(exc.response)}"
    except Exception as exc:
        result["status"] = "offline"
        result["message"] = pick_error_message(exc)

    return result


async def check_target_with_limit(semaphore: asyncio.Semaphore, target: TargetInput) -> dict[str, Any]:
    async with semaphore:
        return await check_target(target)


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/targets")
async def get_targets() -> dict[str, Any]:
    return {"targets": read_saved_targets()}


@app.put("/api/targets")
async def save_targets(body: CheckRequest) -> dict[str, Any]:
    write_saved_targets(body.targets)
    return {"success": True, "count": len(body.targets)}


@app.post("/api/update-target")
async def update_target(body: UpdateRequest) -> dict[str, Any]:
    return await trigger_remote_update(body.target)


@app.post("/api/model-config")
async def get_model_config(body: ModelConfigRequest) -> dict[str, Any]:
    return await fetch_remote_model_config(body.target)


@app.put("/api/model-config")
async def save_model_config(body: SaveModelConfigRequest) -> dict[str, Any]:
    return await save_remote_model_config(body.target, body.config)


@app.post("/api/project-models/preview")
async def preview_project_models(body: ProjectModelRequest) -> dict[str, Any]:
    return await process_project_models(body.target, body.models, apply_changes=False, project_ids=body.project_ids)


@app.post("/api/project-models/apply")
async def apply_project_models(body: ProjectModelRequest) -> dict[str, Any]:
    return await process_project_models(body.target, body.models, apply_changes=True, project_ids=body.project_ids)


@app.post("/api/check-targets")
async def check_targets(body: CheckRequest) -> dict[str, Any]:
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_CHECKS)
    tasks = [check_target_with_limit(semaphore, target) for target in body.targets]
    results = await asyncio.gather(*tasks)
    return {"results": results}
