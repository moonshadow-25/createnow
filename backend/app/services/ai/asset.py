"""
Asset 服务

将 CreateNow / Volcengine 素材提交操作封装为 AIService 子类，
所有 HTTP 调用走 self.client（httpx.AsyncClient），
所有 API 交互通过 _log_interaction 写入 AILOG（type=asset）。
"""

import hashlib
import hmac
import json
import logging
import time
import datetime
from typing import Optional, Dict, Any

from app.services.ai.base import AIService
from app.services.ai_log_service import AILogService

logger = logging.getLogger(__name__)

_VOL_HOST = "open.volcengineapi.com"
_VOL_VERSION = "2024-01-01"
_VOL_SERVICE = "ark"
_VOL_REGION = "cn-beijing"


class AssetService(AIService):
    """素材库服务，支持 CreateNow（Bearer 鉴权）和 Volcengine（AK/SK SigV4 鉴权）"""

    def __init__(
        self,
        api_type: str,
        api_url: str,
        api_key: str,
        volcengine_ak: str = "",
        volcengine_sk: str = "",
        project_id: Optional[str] = None,
    ):
        super().__init__(api_url, api_key, model="asset", project_id=project_id)
        self.api_type = api_type          # "createnow" | "volcengine"
        self.volcengine_ak = volcengine_ak
        self.volcengine_sk = volcengine_sk

    # ------------------------------------------------------------------ #
    #  CreateNow 方法
    # ------------------------------------------------------------------ #

    async def cn_submit_asset(self, image_datauri: str) -> str:
        """提交图片到 CreateNow 素材库，返回 asset_id"""
        url = f"{self.api_url}/assets"
        payload = {"image": image_datauri}
        start = time.time()
        try:
            resp = await self.client.post(
                url,
                headers=self._get_headers(),
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            asset_id = data.get("asset_id") or data.get("id")
            if not asset_id:
                raise ValueError(f"无法从响应中获取 asset_id: {data}")
            self._log_interaction(
                AILogService.TYPE_ASSET,
                "cn_submit_asset",
                url,
                "POST",
                request_payload=self._truncate_base64(payload),
                response_data=data,
                duration_ms=(time.time() - start) * 1000,
                status_code=resp.status_code,
            )
            logger.info(f"[AssetService] CreateNow 提交素材成功: {asset_id}")
            return asset_id
        except Exception as e:
            self._log_interaction(
                AILogService.TYPE_ASSET,
                "cn_submit_asset",
                url,
                "POST",
                request_payload=self._truncate_base64(payload),
                error=str(e),
                duration_ms=(time.time() - start) * 1000,
            )
            raise

    async def cn_get_asset_status(self, asset_id: str) -> Dict[str, Any]:
        """查询 CreateNow 素材状态，返回 {"status": ..., "url": ...}"""
        url = f"{self.api_url}/assets/{asset_id}"
        start = time.time()
        try:
            resp = await self.client.get(
                url,
                headers=self._get_headers(),
            )
            resp.raise_for_status()
            data = resp.json()
            result = {
                "status": data.get("status", "Processing"),
                "url": data.get("url") or data.get("public_url"),
            }
            self._log_interaction(
                AILogService.TYPE_ASSET,
                "cn_get_asset_status",
                url,
                "GET",
                request_payload={"asset_id": asset_id},
                response_data=data,
                duration_ms=(time.time() - start) * 1000,
                status_code=resp.status_code,
            )
            return result
        except Exception as e:
            self._log_interaction(
                AILogService.TYPE_ASSET,
                "cn_get_asset_status",
                url,
                "GET",
                request_payload={"asset_id": asset_id},
                error=str(e),
                duration_ms=(time.time() - start) * 1000,
            )
            raise

    # ------------------------------------------------------------------ #
    #  Volcengine 方法
    # ------------------------------------------------------------------ #

    def _vol_build_auth_headers(self, action: str, body: bytes) -> Dict[str, str]:
        """构造 Volcengine SigV4 鉴权头（纯计算，无 I/O）"""
        ak = self.volcengine_ak
        sk = self.volcengine_sk
        now = datetime.datetime.utcnow()
        date_str = now.strftime("%Y%m%d")
        datetime_str = now.strftime("%Y%m%dT%H%M%SZ")

        host = _VOL_HOST
        content_type = "application/json"
        body_hash = hashlib.sha256(body).hexdigest()

        query_str = f"Action={action}&Version={_VOL_VERSION}"
        canonical_headers = (
            f"content-type:{content_type}\n"
            f"host:{host}\n"
            f"x-content-sha256:{body_hash}\n"
            f"x-date:{datetime_str}\n"
        )
        signed_headers = "content-type;host;x-content-sha256;x-date"
        canonical_request = (
            f"POST\n/open/{action}\n{query_str}\n"
            f"{canonical_headers}\n{signed_headers}\n{body_hash}"
        )

        credential_scope = f"{date_str}/{_VOL_REGION}/{_VOL_SERVICE}/request"
        string_to_sign = (
            f"HMAC-SHA256\n{datetime_str}\n{credential_scope}\n"
            f"{hashlib.sha256(canonical_request.encode()).hexdigest()}"
        )

        def _hmac(key, msg):
            return hmac.new(
                key if isinstance(key, bytes) else key.encode(),
                msg.encode(),
                hashlib.sha256,
            ).digest()

        signing_key = _hmac(
            _hmac(_hmac(_hmac(sk, date_str), _VOL_REGION), _VOL_SERVICE),
            "request",
        )
        signature = hmac.new(signing_key, string_to_sign.encode(), hashlib.sha256).hexdigest()

        auth = (
            f"HMAC-SHA256 Credential={ak}/{credential_scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}"
        )
        return {
            "Content-Type": content_type,
            "Host": host,
            "X-Date": datetime_str,
            "X-Content-Sha256": body_hash,
            "Authorization": auth,
        }

    async def _vol_call_api(self, action: str, params: dict) -> dict:
        """调用 Volcengine Ark API（私有辅助，不记录日志，由调用方负责）"""
        body = json.dumps(params, ensure_ascii=False).encode("utf-8")
        url = f"https://{_VOL_HOST}/open/{action}?Action={action}&Version={_VOL_VERSION}"
        headers = self._vol_build_auth_headers(action, body)
        resp = await self.client.post(url, headers=headers, content=body)
        if resp.status_code != 200:
            raise Exception(resp.content)
        return resp.json()

    async def vol_ensure_default_group(self, video_config: dict) -> str:
        """获取或创建默认素材组，group_id 缓存到 video_config 中"""
        cached = video_config.get("volcengine_group_id")
        if cached:
            return cached

        action = "ListAssetGroups"
        params = {"Filter": {"GroupType": "AIGC"}, "PageNumber": 1, "PageSize": 10}
        start = time.time()
        try:
            resp_data = await self._vol_call_api(action, params)
            items = resp_data.get("Result", {}).get("Items", [])
            if items:
                group_id = items[0]["Id"]
                video_config["volcengine_group_id"] = group_id
                self._log_interaction(
                    AILogService.TYPE_ASSET,
                    "vol_ensure_default_group",
                    f"https://{_VOL_HOST}/open/{action}",
                    "POST",
                    request_payload=params,
                    response_data=resp_data,
                    duration_ms=(time.time() - start) * 1000,
                )
                logger.info(f"[AssetService] 使用已有素材组: {group_id}")
                return group_id
        except Exception as e:
            self._log_interaction(
                AILogService.TYPE_ASSET,
                "vol_ensure_default_group",
                f"https://{_VOL_HOST}/open/{action}",
                "POST",
                request_payload=params,
                error=str(e),
                duration_ms=(time.time() - start) * 1000,
            )
            logger.warning(f"[AssetService] 列出素材组失败: {e}")

        # 创建新分组
        action2 = "CreateAssetGroup"
        params2 = {
            "Name": "CreateNow默认素材组",
            "Description": "由 CreateNow 自动创建",
            "GroupType": "AIGC",
        }
        start2 = time.time()
        try:
            resp_data2 = await self._vol_call_api(action2, params2)
            group_id = resp_data2["Result"]["Id"]
            video_config["volcengine_group_id"] = group_id
            self._log_interaction(
                AILogService.TYPE_ASSET,
                "vol_create_asset_group",
                f"https://{_VOL_HOST}/open/{action2}",
                "POST",
                request_payload=params2,
                response_data=resp_data2,
                duration_ms=(time.time() - start2) * 1000,
            )
            logger.info(f"[AssetService] 创建新素材组: {group_id}")
            return group_id
        except Exception as e:
            self._log_interaction(
                AILogService.TYPE_ASSET,
                "vol_create_asset_group",
                f"https://{_VOL_HOST}/open/{action2}",
                "POST",
                request_payload=params2,
                error=str(e),
                duration_ms=(time.time() - start2) * 1000,
            )
            raise

    async def vol_submit_asset(self, group_id: str, image_url: str) -> str:
        """提交图片到 Volcengine 素材库，返回 asset_id"""
        action = "CreateAsset"
        params = {"GroupId": group_id, "URL": image_url, "AssetType": "Image"}
        url = f"https://{_VOL_HOST}/open/{action}"
        start = time.time()
        try:
            resp_data = await self._vol_call_api(action, params)
            asset_id = resp_data["Result"]["Id"]
            self._log_interaction(
                AILogService.TYPE_ASSET,
                "vol_submit_asset",
                url,
                "POST",
                request_payload=params,
                response_data=resp_data,
                duration_ms=(time.time() - start) * 1000,
            )
            logger.info(f"[AssetService] Volcengine 提交素材成功: {asset_id}")
            return asset_id
        except Exception as e:
            self._log_interaction(
                AILogService.TYPE_ASSET,
                "vol_submit_asset",
                url,
                "POST",
                request_payload=params,
                error=str(e),
                duration_ms=(time.time() - start) * 1000,
            )
            raise

    async def vol_get_asset_status(self, asset_id: str) -> Dict[str, Any]:
        """查询 Volcengine 素材状态，返回 {"status": ..., "url": ...}"""
        action = "GetAsset"
        params = {"Id": asset_id}
        url = f"https://{_VOL_HOST}/open/{action}"
        start = time.time()
        try:
            resp_data = await self._vol_call_api(action, params)
            result_obj = resp_data.get("Result", {})
            result = {
                "status": result_obj.get("Status", "Processing"),
                "url": result_obj.get("URL"),
            }
            self._log_interaction(
                AILogService.TYPE_ASSET,
                "vol_get_asset_status",
                url,
                "POST",
                request_payload=params,
                response_data=resp_data,
                duration_ms=(time.time() - start) * 1000,
            )
            return result
        except Exception as e:
            self._log_interaction(
                AILogService.TYPE_ASSET,
                "vol_get_asset_status",
                url,
                "POST",
                request_payload=params,
                error=str(e),
                duration_ms=(time.time() - start) * 1000,
            )
            raise
