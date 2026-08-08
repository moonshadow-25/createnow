import hashlib
import hmac
import time
import uuid
import requests
from typing import Optional, Dict, Any, List


class SiliconClient:
    """硅星人数字资产平台 SDK 客户端"""

    def __init__(self, app_id: str, app_secret: str, base_url: str = "https://ai.npaigc.com"):
        """
        初始化客户端

        Args:
            app_id: 开发者应用ID
            app_secret: 开发者应用密钥
            base_url: API基础地址，默认生产环境
        """
        self.app_id = app_id
        self.app_secret = app_secret
        self.base_url = base_url.rstrip('/')
        self._session = requests.Session()
        self.assets = AssetsAPI(self)
        self.talents = TalentsAPI(self)
        self.calls = CallsAPI(self)
        self.billing = BillingAPI(self)

    def _sign(self, method: str, path: str, timestamp: str, nonce: str, body: bytes = b'') -> str:
        """生成HMAC-SHA256签名"""
        body_hash = hashlib.sha256(body).hexdigest() if body else ''
        string_to_sign = f"{method}\n{path}\n{timestamp}\n{nonce}\n{body_hash}"
        return hmac.new(
            self.app_secret.encode('utf-8'),
            string_to_sign.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()

    def _request(self, method: str, path: str, data: Any = None, params: Any = None) -> Dict:
        """发送带签名的API请求"""
        timestamp = str(int(time.time()))
        nonce = uuid.uuid4().hex[:16]

        body = b''
        if data is not None:
            import json
            # ensure_ascii=False：中文原文编码，与平台端签名校验一致
            body = json.dumps(data, ensure_ascii=False).encode('utf-8')

        signature = self._sign(method, path, timestamp, nonce, body)

        headers = {
            'Authorization': f'HMAC-SHA256 app_id={self.app_id}, timestamp={timestamp}, nonce={nonce}, signature={signature}',
            'Content-Type': 'application/json',
        }

        url = f"{self.base_url}{path}"
        response = self._session.request(
            method=method,
            url=url,
            headers=headers,
            data=body if body else None,
            params=params,
        )

        # 先检查 HTTP 状态码
        if not response.ok:
            raise SiliconAPIError(
                f"HTTP {response.status_code}: {response.text[:200]}",
                code=response.status_code
            )

        # 尝试解析 JSON，失败则给出有意义的错误
        try:
            result = response.json()
        except Exception:
            raise SiliconAPIError(
                f"API 返回非 JSON 响应 (HTTP {response.status_code}): {response.text[:300]}",
                code=response.status_code
            )

        if result.get('code') != 0:
            error_msg = result.get('message', '未知错误')
            raise SiliconAPIError(error_msg, result.get('code'))

        return result.get('data', {})


class SiliconAPIError(Exception):
    """API调用异常"""
    def __init__(self, message: str, code: int = None):
        self.code = code
        super().__init__(message)


class TalentsAPI:
    """数字艺人API"""

    def __init__(self, client: SiliconClient):
        self._client = client

    def list(self, keyword: Optional[str] = None, level: Optional[str] = None,
             ordering: str = '-total_revenue',
             page: int = 1, page_size: int = 20) -> Dict:
        """
        查询数字艺人列表（含主视图预览，免费）

        Args:
            keyword: 按姓名/描述搜索
            level: 按等级筛选，如 "L1"、"L2"
            ordering: 排序：-total_revenue（默认）、-created_at、-sort_order、name
            page: 页码
            page_size: 每页数量

        Returns:
            {
                "total": 50,
                "items": [
                    {
                        "talent_id": 1,
                        "name": "苏清月",
                        "gender": "女",
                        "age_range": "18-25岁",
                        "level_name": "L1",
                        "main_image_url": "https://...",
                        "description": "...",
                        "asset_count": 12,
                        "total_revenue": 12800.00,
                        "created_at": "2026-01-15T10:30:00Z"
                    }
                ],
                "page": 1,
                "page_size": 20
            }
        """
        params = {'page': page, 'page_size': page_size, 'ordering': ordering}
        if keyword:
            params['keyword'] = keyword
        if level:
            params['level'] = level
        return self._client._request('GET', '/api/v1/talents/', params=params)

    def get(self, talent_id: int) -> Dict:
        """
        获取数字艺人详情（含主视图预览，免费）

        Args:
            talent_id: 数字艺人ID

        Returns:
            艺人详情，含 main_image_url 主视图URL
        """
        return self._client._request('GET', f'/api/v1/talents/{talent_id}/')


class AssetsAPI:
    """资产查询API"""

    def __init__(self, client: SiliconClient):
        self._client = client

    def list(self, asset_type: Optional[str] = None, talent_id: Optional[int] = None,
             sub_type: Optional[str] = None, keyword: Optional[str] = None,
             page: int = 1, page_size: int = 20) -> Dict:
        """
        查询资产列表

        Args:
            asset_type: 资产类型 (threeviews_image / image_asset / audio_sample)
            talent_id: 数字艺人ID
            sub_type: 三视图子类型 (front / side / full / back)
            keyword: 搜索关键词
            page: 页码
            page_size: 每页数量

        Returns:
            {
                "total": 100,
                "items": [...],
                "page": 1,
                "page_size": 20
            }
        """
        params = {'page': page, 'page_size': page_size}
        if asset_type:
            params['asset_type'] = asset_type
        if talent_id:
            params['talent_id'] = talent_id
        if sub_type:
            params['sub_type'] = sub_type
        if keyword:
            params['keyword'] = keyword
        return self._client._request('GET', '/api/v1/assets/', params=params)

    def get(self, asset_id: str) -> Dict:
        """
        获取资产详情

        Args:
            asset_id: 资产UUID

        Returns:
            资产详情，含 preview_url 预览图
        """
        return self._client._request('GET', f'/api/v1/assets/{asset_id}/')

    def by_talent(self, talent_id: int) -> Dict:
        """
        按数字艺人获取全部已公开资产（分组展示）

        Args:
            talent_id: 数字艺人ID

        Returns:
            {
                "talent_id": 1,
                "talent_name": "苏清月",
                "groups": [
                    {
                        "asset_type": "threeviews_image",
                        "asset_type_display": "三视图资产",
                        "items": [...]
                    }
                ]
            }
        """
        return self._client._request('GET', f'/api/v1/assets/by-talent/{talent_id}/')


class CallsAPI:
    """调用API（付费获取资产）"""

    def __init__(self, client: SiliconClient):
        self._client = client

    def acquire(self, asset_id: str, role_type: str,
                project_name: Optional[str] = None, project_type: Optional[str] = None,
                request_id: Optional[str] = None) -> Dict:
        """
        付费获取资产原图（按次扣费，价格由角色类型 × 艺人等级决定）

        Args:
            asset_id: 资产UUID
            role_type: 角色类型，如 "主角"、"配角"、"群演"
            project_name: 项目/作品名称（可选），如"XX品牌宣传片"
            project_type: 项目类型（可选），如"短视频"、"宣传片"、"电商主图"
            request_id: 第三方请求唯一标识（可选）

        Returns:
            {
                "call_id": "ACQ-...",
                "asset_id": "uuid",
                "asset_name": "苏清月-正脸照V2",
                "role_type": "主角",
                "project_name": "XX品牌宣传片",
                "project_type": "宣传片",
                "price": 80.00,
                "asset_url": "原图临时访问URL（有效期15分钟）",
                "expires_at": "2026-07-01T12:15:00Z",
                "cost": 80.00,
                "balance_after": 920.00
            }
        """
        data = {
            'asset_id': asset_id,
            'role_type': role_type,
        }
        if project_name:
            data['project_name'] = project_name
        if project_type:
            data['project_type'] = project_type
        if request_id:
            data['request_id'] = request_id
        return self._client._request('POST', '/api/v1/calls/acquire/', data=data)

    def acquire_talent(self, talent_id: int, role_type: str,
                       project_name: Optional[str] = None, project_type: Optional[str] = None,
                       request_id: Optional[str] = None) -> Dict:
        """
        按艺人批量付费获取三视图资产（一次性获取该艺人全部三视图下载链接）

        Args:
            talent_id: 数字艺人ID
            role_type: 角色类型，如 "主角"、"配角"、"群演"
            project_name: 项目/作品名称（可选），平台据此去重，同项目同资产不重复收费
            project_type: 项目类型（可选）
            request_id: 第三方请求唯一标识（可选）

        Returns:
            {
                "talent_id": 1,
                "talent_name": "苏清月",
                "role_type": "主角",
                "price_per_asset": 80.00,
                "total_assets": 4,
                "charged_assets": 4,
                "total_cost": 320.00,
                "balance_after": 680.00,
                "items": [
                    {
                        "call_id": "ACQ-...",
                        "asset_id": "uuid",
                        "asset_name": "苏清月-正脸照",
                        "asset_type": "threeviews_image",
                        "sub_type": "front",
                        "cost": 80.00,
                        "asset_url": "临时下载URL（15分钟有效）",
                        "expires_at": "2026-07-01T12:15:00Z"
                    }
                ]
            }
        """
        data = {
            'talent_id': talent_id,
            'role_type': role_type,
        }
        if project_name:
            data['project_name'] = project_name
        if project_type:
            data['project_type'] = project_type
        if request_id:
            data['request_id'] = request_id
        return self._client._request('POST', '/api/v1/calls/acquire-talent/', data=data)

    def get_result(self, call_id: str) -> Dict:
        """
        查询调用结果

        Args:
            call_id: 调用记录ID
        """
        return self._client._request('GET', f'/api/v1/calls/{call_id}/result/')

    def list(self, page: int = 1, page_size: int = 20) -> Dict:
        """
        查询调用记录列表
        """
        params = {'page': page, 'page_size': page_size}
        return self._client._request('GET', '/api/v1/calls/', params=params)

    def detail(self, call_id: str) -> Dict:
        """
        查询调用详情
        """
        return self._client._request('GET', f'/api/v1/calls/{call_id}/')


class BillingAPI:
    """账单API"""

    def __init__(self, client: SiliconClient):
        self._client = client

    def get_balance(self) -> Dict:
        """
        查询余额和配额

        Returns:
            {
                "balance": 1000.00,
                "today_calls": 50,
                "today_cost": 495.00,
                "month_calls": 1200,
                "month_cost": 11880.00,
                "quota": { "qps": 100, "daily_calls": 10000, "monthly_calls": 300000 }
            }
        """
        return self._client._request('GET', '/api/v1/billing/balance/')

    def records(self, page: int = 1, page_size: int = 20) -> Dict:
        """
        查询账单明细
        """
        params = {'page': page, 'page_size': page_size}
        return self._client._request('GET', '/api/v1/billing/records/', params=params)

    def usage(self, period: str = 'daily', days: int = 30) -> Dict:
        """
        查询用量统计

        Args:
            period: 统计周期 (daily / monthly)
            days: 最近天数
        """
        params = {'period': period, 'days': days}
        return self._client._request('GET', '/api/v1/billing/usage/', params=params)
