"""
认证服务 - 设备硬件 ID 生成、注册 URL 生成、远程状态检查
"""

import hashlib
import hmac
import platform
import time
import json
import logging
import subprocess
from pathlib import Path
from typing import Optional, Tuple

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# 全局配置文件路径
_GLOBAL_CONFIG_PATH: Optional[Path] = None


def _get_global_config_path() -> Path:
    global _GLOBAL_CONFIG_PATH
    if _GLOBAL_CONFIG_PATH is None:
        _GLOBAL_CONFIG_PATH = settings.CONFIG_DIR / "global.json"
    return _GLOBAL_CONFIG_PATH


# ============================================================
# 设备 ID 生成
# ============================================================

def get_hardware_id() -> str:
    """生成稳定的设备硬件 ID（32位十六进制字符串）

    优先级：
    1. Windows 注册表 MachineGuid（最稳定，重装系统前不变）
    2. BIOS UUID（跨平台兜底）
    3. 主机名（最终兜底）
    """
    # 1. Windows 注册表 MachineGuid
    try:
        import winreg
        key = winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Cryptography"
        )
        guid, _ = winreg.QueryValueEx(key, "MachineGuid")
        winreg.CloseKey(key)
        return hashlib.sha256(guid.encode()).hexdigest()[:32]
    except Exception:
        pass

    # 2. BIOS UUID (wmic csproduct get uuid)
    try:
        result = subprocess.run(
            ["wmic", "csproduct", "get", "uuid"],
            capture_output=True, text=True, timeout=5
        )
        lines = [l.strip() for l in result.stdout.split('\n')
                 if l.strip() and l.strip().upper() != 'UUID']
        if lines:
            return hashlib.sha256(lines[0].encode()).hexdigest()[:32]
    except Exception:
        pass

    # 3. 最终兜底：主机名
    return hashlib.sha256(platform.node().encode()).hexdigest()[:32]


# ============================================================
# 签名生成
# ============================================================

def _make_signature(hardware_id: str, timestamp_ms: int) -> str:
    """生成 HMAC-SHA256 签名"""
    message = f"{hardware_id}:{timestamp_ms}".encode()
    key = settings.CREATENOW_SECRET_KEY.encode()
    return hmac.new(key, message, hashlib.sha256).hexdigest()


def _get_base_url() -> str:
    """从 CREATENOW_BASE_URL 中去掉 /v1 后缀，得到根 URL"""
    url = settings.CREATENOW_BASE_URL
    if url.endswith("/v1"):
        url = url[:-3]
    return url.rstrip("/")


# ============================================================
# 注册 URL 生成
# ============================================================

def get_registration_url() -> Tuple[str, str]:
    """生成带签名的注册页面 URL

    Returns:
        (url, hardware_id)
    """
    hardware_id = get_hardware_id()
    timestamp_ms = int(time.time() * 1000)
    signature = _make_signature(hardware_id, timestamp_ms)

    base = _get_base_url()
    url = f"{base}/register.html?d={hardware_id}&s={signature}&t={timestamp_ms}"
    return url, hardware_id


# ============================================================
# 远程状态检查
# ============================================================

async def check_remote_status(hardware_id: str) -> Tuple[bool, Optional[str]]:
    """调用服务端 /api/status 检查注册状态

    Returns:
        (registered: bool, api_key: str | None)
    """
    timestamp_ms = int(time.time() * 1000)
    signature = _make_signature(hardware_id, timestamp_ms)

    base = _get_base_url()
    url = f"{base}/api/status"
    params = {"d": hardware_id, "t": str(timestamp_ms), "s": signature}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params)
            data = resp.json()

        status = data.get("status")
        if status == "active":
            return True, data.get("api_key")
        elif status == "pending":
            return False, None
        else:
            logger.warning(f"[Auth] Unexpected status from server: {data}")
            return False, None
    except Exception as e:
        logger.error(f"[Auth] check_remote_status error: {e}")
        raise


# ============================================================
# SaaS 专用登录（session_id，不依赖硬件）
# ============================================================

def get_saas_login_url(session_id: str) -> str:
    """生成 SaaS 登录 URL（用 session 参数传递 session_id）"""
    base = _get_base_url()
    return f"{base}/register.html?session_id={session_id}"


async def check_saas_status(session_id: str) -> Tuple[bool, Optional[str], Optional[str], Optional[str]]:
    """SaaS 模式：用 session_id 查询 CreateNow 登录状态

    Returns:
        (registered: bool, api_key: str | None, email: str | None, display_name: str | None)
    """
    base = _get_base_url()
    url = f"{base}/api/status"
    params = {"session_id": session_id}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params)
            data = resp.json()
        logger.info(f"[Auth][SaaS] status response: {data}")

        status = data.get("status")
        if status == "active":
            return (
                True,
                data.get("api_key"),
                data.get("user_name", ""),
                data.get("user_name", ""),
            )
        elif status == "pending":
            return False, None, None, None
        else:
            logger.warning(f"[Auth][SaaS] Unexpected status from server: {data}")
            return False, None, None, None
    except Exception as e:
        logger.error(f"[Auth][SaaS] check_saas_status error: {e}")
        raise


# ============================================================
# 本地状态持久化
# ============================================================

def _read_global_config() -> dict:
    path = _get_global_config_path()
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _write_global_config(config: dict) -> None:
    path = _get_global_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")


def get_auth_state() -> dict:
    """读取认证状态

    Returns:
        {"logged_in": bool, "hardware_id": str|None, "api_key": str|None}
    """
    config = _read_global_config()
    auth = config.get("auth", {})
    return {
        "logged_in": bool(auth.get("logged_in")),
        "hardware_id": auth.get("hardware_id"),
        "api_key": auth.get("api_key"),
    }


def save_auth_state(hardware_id: str, api_key: str) -> None:
    """保存认证状态到 global.json"""
    config = _read_global_config()
    config["auth"] = {
        "logged_in": True,
        "hardware_id": hardware_id,
        "api_key": api_key,
    }
    _write_global_config(config)
    logger.info(f"[Auth] Auth state saved for device {hardware_id[:8]}...")


def clear_auth_state() -> None:
    """清除认证状态（登出）"""
    config = _read_global_config()
    config["auth"] = {
        "logged_in": False,
        "hardware_id": None,
        "api_key": None,
    }
    _write_global_config(config)
    logger.info("[Auth] Auth state cleared (logged out)")
