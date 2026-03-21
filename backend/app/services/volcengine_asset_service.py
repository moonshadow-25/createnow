"""
Volcengine Asset Library 服务

用于将图片上传至火山引擎素材库，获取 asset_id 后在视频生成时使用 asset:// URI，
可绕过 Deepfake 风控拦截，提升生成质量。

API 文档: https://www.volcengine.com/docs/6705/1221503
Service: ark, Version: 2024-01-01, Region: cn-beijing
鉴权: AK/SK
"""

import logging
import json
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

_ARK_HOST = "open.volcengineapi.com"
_ARK_VERSION = "2024-01-01"
_ARK_SERVICE = "ark"
_ARK_REGION = "cn-beijing"


def _call_api(ak: str, sk: str, action: str, params: dict) -> dict:
    """调用 Volcengine Ark API（AK/SK 鉴权，手动 SigV4 签名）"""
    import hashlib
    import hmac
    import datetime
    import requests

    body = json.dumps(params, ensure_ascii=False).encode("utf-8")
    now = datetime.datetime.utcnow()
    date_str = now.strftime("%Y%m%d")
    datetime_str = now.strftime("%Y%m%dT%H%M%SZ")

    url = f"https://{_ARK_HOST}/open/{action}?Action={action}&Version={_ARK_VERSION}"
    host = _ARK_HOST
    content_type = "application/json"
    body_hash = hashlib.sha256(body).hexdigest()

    # Canonical request（query string 需参与签名）
    query_str = f"Action={action}&Version={_ARK_VERSION}"
    canonical_headers = f"content-type:{content_type}\nhost:{host}\nx-content-sha256:{body_hash}\nx-date:{datetime_str}\n"
    signed_headers = "content-type;host;x-content-sha256;x-date"
    canonical_request = f"POST\n/open/{action}\n{query_str}\n{canonical_headers}\n{signed_headers}\n{body_hash}"

    # String to sign
    credential_scope = f"{date_str}/{_ARK_REGION}/{_ARK_SERVICE}/request"
    string_to_sign = f"HMAC-SHA256\n{datetime_str}\n{credential_scope}\n{hashlib.sha256(canonical_request.encode()).hexdigest()}"

    # Signing key
    def hmac_sha256(key, msg):
        return hmac.new(key if isinstance(key, bytes) else key.encode(), msg.encode(), hashlib.sha256).digest()

    signing_key = hmac_sha256(
        hmac_sha256(hmac_sha256(hmac_sha256(sk, date_str), _ARK_REGION), _ARK_SERVICE),
        "request"
    )
    signature = hmac.new(signing_key, string_to_sign.encode(), hashlib.sha256).hexdigest()

    auth = (
        f"HMAC-SHA256 Credential={ak}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    headers = {
        "Content-Type": content_type,
        "Host": host,
        "X-Date": datetime_str,
        "X-Content-Sha256": body_hash,
        "Authorization": auth,
    }

    resp = requests.post(url, headers=headers, data=body, timeout=30)
    if resp.status_code != 200:
        raise Exception(resp.content)
    return resp.json()


def ensure_default_group(ak: str, sk: str, video_config: dict) -> str:
    """获取或创建默认素材组，group_id 缓存到 video_config 中"""
    cached = video_config.get("volcengine_group_id")
    if cached:
        return cached

    # 先尝试列出已有分组
    try:
        resp = _call_api(ak, sk, "ListAssetGroups", {
            "Filter": {"GroupType": "AIGC"},
            "PageNumber": 1,
            "PageSize": 10,
        })
        items = resp.get("Result", {}).get("Items", [])
        if items:
            group_id = items[0]["Id"]
            video_config["volcengine_group_id"] = group_id
            logger.info(f"[Asset] 使用已有素材组: {group_id}")
            return group_id
    except Exception as e:
        logger.warning(f"[Asset] 列出素材组失败: {e}")

    # 创建新分组
    resp = _call_api(ak, sk, "CreateAssetGroup", {
        "Name": "CreateNow默认素材组",
        "Description": "由 CreateNow 自动创建",
        "GroupType": "AIGC",
    })
    group_id = resp["Result"]["Id"]
    video_config["volcengine_group_id"] = group_id
    logger.info(f"[Asset] 创建新素材组: {group_id}")
    return group_id


def create_asset(group_id: str, image_url: str, ak: str, sk: str) -> str:
    """将图片提交到 Volcengine 素材库，返回 asset_id"""
    resp = _call_api(ak, sk, "CreateAsset", {
        "GroupId": group_id,
        "URL": image_url,
        "AssetType": "Image",
    })
    asset_id = resp["Result"]["Id"]
    logger.info(f"[Asset] 提交素材成功: {asset_id}")
    return asset_id


def get_asset_status(asset_id: str, ak: str, sk: str) -> Dict[str, Any]:
    """查询素材状态，返回 {"status": "Processing"|"Active"|"Failed", "url": str|None}"""
    resp = _call_api(ak, sk, "GetAsset", {"Id": asset_id})
    result = resp.get("Result", {})
    return {
        "status": result.get("Status", "Processing"),
        "url": result.get("URL"),
    }


def list_assets(group_id: str, ak: str, sk: str) -> list:
    """列出素材组中的所有素材"""
    resp = _call_api(ak, sk, "ListAssets", {
        "Filter": {
            "GroupIds": [group_id],
            "GroupType": "AIGC",
        },
        "PageNumber": 1,
        "PageSize": 50,
    })
    return resp.get("Result", {}).get("Items", [])


def get_ak_sk(ai_config: dict) -> tuple[str, str]:
    """从配置中获取 AK/SK"""
    video_config = ai_config.get("video", {})
    api_type = video_config.get("api_type", "openai")

    if api_type == "createnow":
        from app.services.auth_service import get_auth_state
        auth = get_auth_state()
        ak = auth.get("volcengine_ak", "")
        sk = auth.get("volcengine_sk", "")
    else:
        ak = video_config.get("volcengine_ak", "")
        sk = video_config.get("volcengine_sk", "")

    return ak, sk
