import httpx
from typing import Dict, Any, Optional
from app.core.config import settings


class ValidationService:
    """API密钥验证服务"""

    @staticmethod
    async def validate_llm_api(api_url: str, api_key: str, model: str, api_type: str = "openai") -> Dict[str, Any]:
        """验证LLM API配置"""
        try:
            # 配置高并发连接池，避免并发限制
            limits = httpx.Limits(max_connections=200, max_keepalive_connections=50)
            async with httpx.AsyncClient(timeout=30.0, limits=limits) as client:
                # OpenAI格式和阿里百炼LLM都使用chat/completions格式
                headers = {
                    "Content-Type": "application/json"
                }

                if api_type == "dashscope":
                    headers["Authorization"] = f"Bearer {api_key}"
                else:
                    headers["Authorization"] = f"Bearer {api_key}"

                response = await client.post(
                    f"{api_url.rstrip('/')}/chat/completions",
                    headers=headers,
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": "test"}],
                        "max_tokens": 1
                    }
                )

                if response.status_code == 200:
                    return {
                        "valid": True,
                        "message": "API配置有效",
                        "usage": response.json().get("usage", {})
                    }
                elif response.status_code == 401:
                    return {
                        "valid": False,
                        "message": "API密钥无效",
                        "error": "unauthorized"
                    }
                else:
                    return {
                        "valid": False,
                        "message": f"API验证失败: {response.status_code}",
                        "error": response.text
                    }
        except httpx.TimeoutException:
            return {
                "valid": False,
                "message": "API请求超时",
                "error": "timeout"
            }
        except Exception as e:
            return {
                "valid": False,
                "message": f"API验证失败: {str(e)}",
                "error": str(e)
            }

    @staticmethod
    async def validate_image_api(
        api_url: str,
        api_key: str,
        model: str,
        api_type: str = "openai",
        image_edit_model: Optional[str] = None
    ) -> Dict[str, Any]:
        """验证图片生成API配置"""
        try:
            # 配置高并发连接池，避免并发限制
            limits = httpx.Limits(max_connections=200, max_keepalive_connections=50)
            async with httpx.AsyncClient(timeout=60.0, limits=limits) as client:

                if api_type == "dashscope":
                    headers = {
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json"
                    }
                    payload = {
                        "model": model,
                        "input": {
                            "messages": [{
                                "role": "user",
                                "content": [{"text": "a simple red circle"}]
                            }]
                        },
                        "parameters": {
                            "prompt_extend": False,
                            "size": "1024*1024"
                        }
                    }
                    url = api_url
                else:
                    # OpenAI格式
                    headers = {
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json"
                    }
                    payload = {
                        "model": model,
                        "prompt": "a simple red circle",
                        "n": 1,
                        "size": "256x256"
                    }
                    url = f"{api_url.rstrip('/')}/images/generations"

                response = await client.post(url, headers=headers, json=payload)

                # 解析响应
                response_text = response.text
                try:
                    response_json = response.json()
                except:
                    response_json = {"raw": response_text}

                if response.status_code == 200:
                    return {
                        "valid": True,
                        "message": "图片API配置有效",
                        "request_sent": {
                            "url": url,
                            "api_type": api_type,
                            "payload": payload
                        },
                        "response": response_json
                    }
                elif response.status_code == 401:
                    return {
                        "valid": False,
                        "message": "图片API密钥无效",
                        "error": "unauthorized",
                        "request_sent": {
                            "url": url,
                            "api_type": api_type,
                            "payload": payload
                        },
                        "response": response_json
                    }
                else:
                    error_detail = response_text
                    try:
                        if "message" in response_json:
                            error_detail = response_json["message"]
                    except:
                        pass
                    return {
                        "valid": False,
                        "message": f"图片API验证失败: {response.status_code} - {error_detail}",
                        "error": response_text,
                        "request_sent": {
                            "url": url,
                            "api_type": api_type,
                            "payload": payload
                        },
                        "response": response_json
                    }
        except httpx.TimeoutException:
            return {
                "valid": False,
                "message": "图片API请求超时",
                "error": "timeout"
            }
        except Exception as e:
            return {
                "valid": False,
                "message": f"图片API验证失败: {str(e)}",
                "error": str(e)
            }

    @staticmethod
    async def validate_video_api(
        api_url: str,
        api_key: str,
        model: str,
        api_type: str = "openai"
    ) -> Dict[str, Any]:
        """验证视频生成API配置"""
        # 视频API通常不支持快速测试，这里只验证基本格式
        if not api_url or not api_key:
            return {
                "valid": False,
                "message": "视频API配置不完整",
                "error": "missing_config"
            }

        if not api_url.startswith("http"):
            return {
                "valid": False,
                "message": "无效的API URL",
                "error": "invalid_url"
            }

        if not api_key or len(api_key) < 10:
            return {
                "valid": False,
                "message": "API密钥格式可能不正确",
                "error": "invalid_key_format"
            }

        return {
            "valid": True,
            "message": "视频API配置格式正确（实际使用时才会验证）"
        }

    @staticmethod
    async def validate_tts_api(
        api_url: str,
        api_key: str,
        model: str,
        api_type: str = "openai",
        voice: str = "alloy",
        id: str = None
    ) -> Dict[str, Any]:
        """验证TTS API配置"""
        try:
            # 配置高并发连接池，避免并发限制
            limits = httpx.Limits(max_connections=200, max_keepalive_connections=50)
            async with httpx.AsyncClient(timeout=30.0, limits=limits) as client:

                if api_type == "dashscope":
                    # 阿里百炼TTS API
                    headers = {
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json"
                    }
                    payload = {
                        "model": model,
                        "input": {
                            "text": "测试"
                        },
                        "parameters": {
                            "voice": voice or "zhichu",
                            "format": "mp3",
                            "sample_rate": 16000
                        }
                    }
                    url = api_url
                elif api_type == "local":
                    # 本地API (OpenAI兼容格式)
                    headers = {
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json"
                    }
                    payload = {
                        "model": model,
                        "input": "test"
                    }
                    # 本地API使用id参数而不是voice
                    if id:
                        payload["id"] = id
                    url = f"{api_url.rstrip('/')}/audio/speech"
                else:
                    # OpenAI格式
                    headers = {
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json"
                    }
                    payload = {
                        "model": model,
                        "input": "test"
                    }
                    if voice:
                        payload["voice"] = voice
                    url = f"{api_url.rstrip('/')}/audio/speech"

                response = await client.post(url, headers=headers, json=payload)

                # 解析响应
                response_text = response.text[:500]  # 限制响应长度

                if response.status_code == 200:
                    # 检查是否返回音频数据
                    content_type = response.headers.get("content-type", "")
                    if "audio" in content_type or len(response.content) > 0:
                        return {
                            "valid": True,
                            "message": "TTS API配置有效，成功生成测试音频",
                            "request_sent": {
                                "url": url,
                                "api_type": api_type,
                                "model": model,
                                "voice": voice if api_type != "local" else None,
                                "id": id if api_type == "local" else None
                            }
                        }
                    else:
                        return {
                            "valid": False,
                            "message": "TTS API返回格式异常（未返回音频数据）",
                            "error": "invalid_response_format"
                        }
                elif response.status_code == 401:
                    return {
                        "valid": False,
                        "message": "TTS API密钥无效",
                        "error": "unauthorized",
                        "request_sent": {
                            "url": url,
                            "api_type": api_type
                        }
                    }
                else:
                    return {
                        "valid": False,
                        "message": f"TTS API验证失败: {response.status_code}",
                        "error": response_text,
                        "request_sent": {
                            "url": url,
                            "api_type": api_type
                        }
                    }
        except httpx.TimeoutException:
            return {
                "valid": False,
                "message": "TTS API请求超时",
                "error": "timeout"
            }
        except Exception as e:
            return {
                "valid": False,
                "message": f"TTS API验证失败: {str(e)}",
                "error": str(e)
            }
