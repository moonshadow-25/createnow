from __future__ import annotations

import asyncio
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
        result["message"] = f"HTTP {exc.response.status_code}: {exc.response.text[:160]}"
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


@app.post("/api/check-targets")
async def check_targets(body: CheckRequest) -> dict[str, Any]:
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_CHECKS)
    tasks = [check_target_with_limit(semaphore, target) for target in body.targets]
    results = await asyncio.gather(*tasks)
    return {"results": results}
