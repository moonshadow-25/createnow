"""
认证 API - 设备注册 / 登录 / 登出
"""

from fastapi import APIRouter

from app.services.auth_service import (
    get_hardware_id,
    get_registration_url,
    check_remote_status,
    save_auth_state,
    get_auth_state,
    clear_auth_state,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/info")
async def auth_info():
    """获取当前认证状态"""
    state = get_auth_state()
    api_key = state.get("api_key") or ""
    # 对 API Key 做脱敏处理（只显示前8位）
    if api_key and len(api_key) > 8:
        masked = api_key[:8] + "****"
    else:
        masked = api_key or None

    return {
        "logged_in": state["logged_in"],
        "hardware_id": state.get("hardware_id") or get_hardware_id(),
        "api_key_masked": masked,
    }


@router.get("/start")
async def auth_start():
    """生成注册 URL，返回给前端以打开浏览器"""
    url, hardware_id = get_registration_url()
    return {"url": url, "hardware_id": hardware_id}


@router.get("/poll")
async def auth_poll():
    """轮询注册状态，若成功则保存 API Key"""
    hardware_id = get_hardware_id()
    try:
        registered, api_key = await check_remote_status(hardware_id)
    except Exception as e:
        return {"registered": False, "error": str(e)}

    if registered and api_key:
        save_auth_state(hardware_id, api_key)
        return {"registered": True, "api_key": api_key}

    return {"registered": False}


@router.get("/key")
async def auth_get_key():
    """直接从本地 global.json 读取已保存的 API Key（无需远程调用）"""
    state = get_auth_state()
    if not state["logged_in"] or not state.get("api_key"):
        return {"logged_in": False, "api_key": None}
    return {"logged_in": True, "api_key": state["api_key"]}


@router.post("/logout")
async def auth_logout():
    """登出，清除本地保存的认证状态"""
    clear_auth_state()
    return {"success": True}
