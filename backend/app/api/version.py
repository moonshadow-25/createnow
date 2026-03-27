"""
Version API - 版本查询与更新触发
"""
import asyncio
import json
import logging
import os
import subprocess
import sys
from pathlib import Path

import aiohttp
from fastapi import APIRouter, BackgroundTasks, HTTPException

logger = logging.getLogger(__name__)

router = APIRouter()

# ── 路径配置 ───────────────────────────────────────────────────────────────────
# version.py 位于 backend/app/api/，向上四级到项目根目录
_PROJECT_ROOT = Path(__file__).parent.parent.parent.parent

VERSION_FILE  = _PROJECT_ROOT / "version.json"
UPDATE_SCRIPT = _PROJECT_ROOT / "update.bat"


def _get_remote_version_url() -> str:
    """从本地 version.json 读取 update_url，派生远程 version.json 地址"""
    data = _read_local_version()
    update_url = data.get("update_url", "")
    if not update_url:
        return ""
    # 将 zip 文件名替换为 version.json
    base = update_url.rsplit("/", 1)[0]
    return f"{base}/version.json"


# ── 工具函数 ───────────────────────────────────────────────────────────────────

def _read_local_version() -> dict:
    if not VERSION_FILE.exists():
        return {"version": "unknown", "release_date": "", "description": ""}
    with open(VERSION_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _has_update(local: str, remote: str) -> bool:
    """返回 True 表示 remote > local"""
    def parse(v: str):
        try:
            return tuple(int(x) for x in v.split("."))
        except Exception:
            return (0,)
    return parse(remote) > parse(local)


# ── 端点 ──────────────────────────────────────────────────────────────────────

@router.get("/version")
async def get_local_version():
    """返回本地版本信息"""
    return _read_local_version()


@router.get("/version/check")
async def check_for_update():
    """请求远程 version.json，与本地对比，返回是否有更新"""
    local = _read_local_version()
    remote_url = _get_remote_version_url()
    if not remote_url:
        raise HTTPException(status_code=500, detail="version.json 中未配置 update_url")
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(remote_url, timeout=aiohttp.ClientTimeout(total=10), ssl=False) as resp:
                if resp.status != 200:
                    raise HTTPException(status_code=502, detail=f"远程服务器返回 {resp.status}")
                remote = await resp.json(content_type=None)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"无法连接更新服务器: {str(e)}")

    return {
        "local": local,
        "remote": remote,
        "has_update": _has_update(local.get("version", ""), remote.get("version", "")),
    }


async def _self_exit():
    await asyncio.sleep(0.5)  # 等响应发出后再退出
    logger.info("[Version] 主进程自退出，释放文件锁")
    os._exit(0)


@router.post("/version/update")
async def trigger_update(background_tasks: BackgroundTasks):
    """启动 update.bat（新窗口），然后主进程自杀释放文件锁"""
    if not UPDATE_SCRIPT.exists():
        raise HTTPException(status_code=404, detail="update.bat 不存在，请确认安装目录完整")

    try:
        subprocess.Popen(
            ["cmd", "/c", str(UPDATE_SCRIPT)],
            cwd=str(_PROJECT_ROOT),
            creationflags=subprocess.CREATE_NEW_CONSOLE if sys.platform == "win32" else 0,
        )
        logger.info("[Version] update.bat 已启动，准备自退出")
        background_tasks.add_task(_self_exit)
        return {"status": "started", "message": "更新已启动，服务即将自动重启"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"启动更新失败: {str(e)}")
