"""TTS服务 - 文本转语音API调用"""
import httpx
import logging
from typing import Dict, Any, Optional
from pathlib import Path

logger = logging.getLogger(__name__)


class TTSService:
    """TTS基类"""

    def __init__(self, api_url: str, api_key: str, model: str, api_type: str = "openai"):
        self.api_url = api_url
        self.api_key = api_key
        self.model = model
        self.api_type = api_type
        self.client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        """获取或创建HTTP客户端"""
        if self.client is None:
            limits = httpx.Limits(max_connections=200, max_keepalive_connections=50)
            self.client = httpx.AsyncClient(timeout=60.0, limits=limits)
        return self.client

    async def close(self):
        """关闭HTTP客户端"""
        if self.client:
            await self.client.aclose()
            self.client = None

    async def generate(
        self,
        text: str,
        voice: Optional[str] = None,
        speaker_id: Optional[str] = None,
        format: str = "mp3"
    ) -> Dict[str, Any]:
        """
        生成语音

        Args:
            text: 要转换的文本
            voice: 音色（OpenAI/阿里百炼）
            speaker_id: Speaker ID（本地API）
            format: 音频格式

        Returns:
            {
                "success": True/False,
                "audio_data": bytes,  # 音频二进制数据
                "audio_url": str,     # 或音频URL（如果API返回URL）
                "error": str          # 错误信息
            }
        """
        try:
            client = await self._get_client()

            if self.api_type == "dashscope":
                # 阿里百炼TTS API
                headers = {
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                }
                payload = {
                    "model": self.model,
                    "input": {
                        "text": text
                    },
                    "parameters": {
                        "voice": voice or "zhichu",
                        "format": format,
                        "sample_rate": 16000
                    }
                }
                url = self.api_url
            elif self.api_type == "local":
                # 本地API (OpenAI兼容格式 + id参数)
                headers = {
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                }
                payload = {
                    "model": self.model,
                    "input": text,
                    "response_format": format
                }
                # 本地API使用id参数
                if speaker_id:
                    payload["id"] = speaker_id
                url = f"{self.api_url.rstrip('/')}/audio/speech"
            else:
                # OpenAI格式
                headers = {
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                }
                payload = {
                    "model": self.model,
                    "input": text,
                    "response_format": format
                }
                if voice:
                    payload["voice"] = voice
                url = f"{self.api_url.rstrip('/')}/audio/speech"

            logger.info(f"[TTS] 调用API: {url}, model: {self.model}")

            response = await client.post(url, headers=headers, json=payload)

            if response.status_code == 200:
                # 检查返回的是音频数据还是JSON
                content_type = response.headers.get("content-type", "")

                if "audio" in content_type or "octet-stream" in content_type:
                    # 直接返回音频二进制数据
                    return {
                        "success": True,
                        "audio_data": response.content
                    }
                else:
                    # 可能返回JSON（如阿里百炼某些情况）
                    try:
                        result = response.json()
                        if "output" in result and "audio_url" in result["output"]:
                            return {
                                "success": True,
                                "audio_url": result["output"]["audio_url"]
                            }
                        else:
                            return {
                                "success": False,
                                "error": "Unexpected JSON response format"
                            }
                    except:
                        # 如果不是JSON，尝试作为音频数据处理
                        return {
                            "success": True,
                            "audio_data": response.content
                        }
            else:
                error_text = response.text[:500]
                logger.error(f"[TTS] API错误: {response.status_code}, {error_text}")
                return {
                    "success": False,
                    "error": f"TTS API returned {response.status_code}: {error_text}"
                }

        except httpx.TimeoutException:
            logger.error("[TTS] 请求超时")
            return {
                "success": False,
                "error": "TTS API request timeout"
            }
        except Exception as e:
            logger.error(f"[TTS] 生成失败: {e}")
            return {
                "success": False,
                "error": str(e)
            }


def get_tts_service(ai_config: dict, project_id: str) -> TTSService:
    """根据配置获取TTS服务实例"""
    tts_config = ai_config.get("tts", {})

    api_url = tts_config.get("api_url", "")
    api_key = tts_config.get("api_key", "")
    model = tts_config.get("model", "tts-1")
    api_type = tts_config.get("api_type", "openai")

    if not api_url or not api_key:
        raise ValueError("TTS API configuration is incomplete")

    return TTSService(api_url, api_key, model, api_type)
