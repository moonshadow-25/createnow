# CreateNow 官方视频生成与视频反推 API

本文档基于当前 CreateNow 应用接入的官方视频协议、广场视频生成调用路径和当前生效的模型配置整理。

本文有两类接口，认证方式和 Base URL 不同：

| 接口类别 | 用途 | Base URL | 认证 |
| --- | --- | --- | --- |
| CreateNow 官方视频 API | 创建和轮询视频生成任务 | `https://myapi.firstarpc.com/v1` | CreateNow API Key |
| CreateNow 应用 API | 在本地项目中上传视频并执行视频反推 | `http://<host>:8501/api` | 应用登录 JWT |

> 本文中的 URL、密钥和资源地址均为示例。不要在客户端代码、脚本仓库或日志中写入真实 API Key。

---

## 1. CreateNow 官方视频生成 API

### 1.1 准备

```bash
export CREATENOW_API_BASE_URL="https://myapi.firstarpc.com/v1"
export CREATENOW_API_KEY="<your-createnow-api-key>"
```

调用视频接口时使用以下请求头：

```text
Authorization: Bearer <your-createnow-api-key>
Content-Type: application/json
```

### 1.2 当前模型枚举

以下为当前 `data/config/global.json` 中生效的视频模型标签。请求的 `model` 必须传右侧的模型值，而不是左侧展示标签。

| 展示标签 | `model` 参数值 | 备注 |
| --- | --- | --- |
| `sd2` | `vipro-sd2` | 当前默认模型 |
| `sd2-fast` | `vipro-fast` | 快速模型 |
| `happyhorse` | `happyhorse-1.0-r2v` | 图生视频模型 |
| `sd2-海外` | `vipro-ul` | 海外线路模型 |
| `sd2-mini` | `vipro-mini` | 轻量模型 |

### 1.3 创建视频生成任务

```text
POST /contents/generations/tasks
```

完整地址：

```text
$CREATENOW_API_BASE_URL/contents/generations/tasks
```

#### 公共请求字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 使用上一节的模型值，例如 `vipro-sd2`。 |
| `content` | array | 是 | 按顺序给出文本和参考媒资，详见下文各模式。 |
| `ratio` | string | 是 | 当前接入层使用 `16:9`、`9:16`、`21:9` 或 `adaptive`。 |
| `resolution` | string | 是 | 当前接入层使用 `480p`、`720p` 或 `1080p`。 |
| `duration` | integer | 是 | 目标时长，单位为秒。`-1` 可用于由模型智能选择时长的多模态路径。 |
| `watermark` | boolean | 否 | 是否添加水印。当前应用通常传 `false`。 |
| `generate_audio` | boolean | 否 | 是否由模型生成音频。未传时由模型和服务端默认配置决定。 |
| `bitrate_mode` | string | 否 | 当前实现仅在值为 `high` 时透传。 |
| `tools` | array | 否 | 仅适用于 Seedance 2.0 兼容模型的联网搜索，格式为 `[{"type":"web_search"}]`。 |

`content` 数组的元素类型如下：

| `type` | 对象字段 | `role` | 用途 |
| --- | --- | --- | --- |
| `text` | `text` | 无 | 视频提示词。 |
| `image_url` | `image_url.url` | 无 | 单图首帧图生视频。 |
| `image_url` | `image_url.url` | `first_frame` | 双图模式中的首帧。 |
| `image_url` | `image_url.url` | `last_frame` | 双图模式中的尾帧。 |
| `image_url` | `image_url.url` | `reference_image` | 参考图。 |
| `video_url` | `video_url.url` | `reference_video` | 参考视频。 |
| `audio_url` | `audio_url.url` | `reference_audio` | 参考音频。 |

#### 成功响应

创建成功后，至少保存返回的任务 `id`，后续轮询必须使用它。

```json
{
  "id": "task_xxxxxxxxxxxx",
  "status": "pending"
}
```

下面示例使用 `jq` 保存任务 ID；未安装 `jq` 时，请从响应 JSON 中手动读取 `id`。

```bash
export TASK_ID="$(curl -sS ... | jq -r '.id')"
```

### 1.4 文生视频

不提供任何图片、视频或音频参考时，即为文生视频。

```bash
curl -sS -X POST "$CREATENOW_API_BASE_URL/contents/generations/tasks" \
  -H "Authorization: Bearer $CREATENOW_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'JSON'
{
  "model": "vipro-sd2",
  "content": [
    {
      "type": "text",
      "text": "雨后的城市街道，镜头缓慢向前推进，霓虹灯映在湿润路面上，电影感，环境氛围声。"
    }
  ],
  "ratio": "16:9",
  "resolution": "720p",
  "duration": 6,
  "watermark": false,
  "generate_audio": true
}
JSON
```

### 1.5 单图首帧图生视频

单张图片使用不带 `role` 的 `image_url`。图片 URL 应可由 CreateNow 服务端访问；也可以按服务支持情况使用 `data:image/...;base64,...`。

```bash
export FIRST_FRAME_URL="https://cdn.example.com/first-frame.png"

curl -sS -X POST "$CREATENOW_API_BASE_URL/contents/generations/tasks" \
  -H "Authorization: Bearer $CREATENOW_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<JSON
{
  "model": "vipro-sd2",
  "content": [
    {
      "type": "text",
      "text": "画面中的人物抬头望向远方，风吹动衣角，镜头缓慢推近。"
    },
    {
      "type": "image_url",
      "image_url": {"url": "$FIRST_FRAME_URL"}
    }
  ],
  "ratio": "16:9",
  "resolution": "720p",
  "duration": 6,
  "watermark": false,
  "generate_audio": false
}
JSON
```

### 1.6 首尾帧视频

提供两张图片时，第一张为 `first_frame`，第二张为 `last_frame`。

```bash
export FIRST_FRAME_URL="https://cdn.example.com/start.png"
export LAST_FRAME_URL="https://cdn.example.com/end.png"

curl -sS -X POST "$CREATENOW_API_BASE_URL/contents/generations/tasks" \
  -H "Authorization: Bearer $CREATENOW_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<JSON
{
  "model": "vipro-sd2",
  "content": [
    {
      "type": "text",
      "text": "角色从窗边转身走向门口，保持人物、服装和室内光线连续。"
    },
    {
      "type": "image_url",
      "image_url": {"url": "$FIRST_FRAME_URL"},
      "role": "first_frame"
    },
    {
      "type": "image_url",
      "image_url": {"url": "$LAST_FRAME_URL"},
      "role": "last_frame"
    }
  ],
  "ratio": "16:9",
  "resolution": "720p",
  "duration": 6,
  "watermark": false
}
JSON
```

### 1.7 多图参考视频

三张及以上图片使用 `reference_image`。当前应用的广场最多选择 10 张参考图片；该限制属于应用层，不代表官方服务的公开上限。

```bash
export CHARACTER_URL="https://cdn.example.com/character.png"
export SCENE_URL="https://cdn.example.com/scene.png"
export PROP_URL="https://cdn.example.com/prop.png"

curl -sS -X POST "$CREATENOW_API_BASE_URL/contents/generations/tasks" \
  -H "Authorization: Bearer $CREATENOW_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<JSON
{
  "model": "vipro-sd2",
  "content": [
    {
      "type": "text",
      "text": "参考人物、场景和道具完成一段连续表演。人物拿起桌上的旧手机，镜头从中景推至手部特写。"
    },
    {
      "type": "image_url",
      "image_url": {"url": "$CHARACTER_URL"},
      "role": "reference_image"
    },
    {
      "type": "image_url",
      "image_url": {"url": "$SCENE_URL"},
      "role": "reference_image"
    },
    {
      "type": "image_url",
      "image_url": {"url": "$PROP_URL"},
      "role": "reference_image"
    }
  ],
  "ratio": "adaptive",
  "resolution": "720p",
  "duration": 6,
  "watermark": false
}
JSON
```

### 1.8 参考视频、参考音频和图片混合生成

广场的多模态视频能力通过同一个任务接口传入 `reference_image`、`reference_video` 和 `reference_audio`。可按需求只传其中一种或任意组合。

```bash
export REFERENCE_IMAGE_URL="https://cdn.example.com/style.png"
export REFERENCE_VIDEO_URL="https://cdn.example.com/motion-reference.mp4"
export REFERENCE_AUDIO_URL="https://cdn.example.com/voice-reference.mp3"

curl -sS -X POST "$CREATENOW_API_BASE_URL/contents/generations/tasks" \
  -H "Authorization: Bearer $CREATENOW_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<JSON
{
  "model": "vipro-sd2",
  "content": [
    {
      "type": "text",
      "text": "以参考图保持画面风格，以参考视频模仿运镜和节奏，使用参考音频中的声音特征生成角色台词：我终于找到你了。"
    },
    {
      "type": "image_url",
      "image_url": {"url": "$REFERENCE_IMAGE_URL"},
      "role": "reference_image"
    },
    {
      "type": "video_url",
      "video_url": {"url": "$REFERENCE_VIDEO_URL"},
      "role": "reference_video"
    },
    {
      "type": "audio_url",
      "audio_url": {"url": "$REFERENCE_AUDIO_URL"},
      "role": "reference_audio"
    }
  ],
  "ratio": "16:9",
  "resolution": "720p",
  "duration": 6,
  "watermark": false,
  "generate_audio": true,
  "bitrate_mode": "high"
}
JSON
```

### 1.9 联网搜索增强

当前接入层仅在 Seedance 2.0 兼容模型且调用方明确启用时，才会传递联网搜索工具。请求体增加：

```json
{
  "tools": [
    {"type": "web_search"}
  ]
}
```

不要对不支持该能力的模型传递该字段。

### 1.10 轮询任务结果

```text
GET /contents/generations/tasks/{task_id}
```

```bash
export TASK_ID="<task-id>"

curl -sS "$CREATENOW_API_BASE_URL/contents/generations/tasks/$TASK_ID" \
  -H "Authorization: Bearer $CREATENOW_API_KEY"
```

当前接入层对任务状态的处理如下：

| 官方响应 `status` | 统一状态 | 调用方动作 |
| --- | --- | --- |
| `pending` | `pending` | 继续轮询。 |
| `processing`、`running` | `in_progress` | 继续轮询。 |
| `succeeded`、`completed` | `completed` | 读取视频 URL，停止轮询。 |
| `failed`、`error` | `failed` | 读取错误信息，停止轮询。 |

完成响应中优先从 `content.video_url` 读取结果。为兼容当前服务端实现，也应兼容顶层 `video_url`、`output.video_url` 和 `result.video_url`。

```json
{
  "id": "task_xxxxxxxxxxxx",
  "status": "succeeded",
  "content": {
    "video_url": "https://cdn.example.com/generated/video.mp4"
  }
}
```

建议由调用方以固定间隔轮询，并在完成、失败或达到自身业务超时后结束。官方协议未在当前代码库中定义统一轮询间隔或最大轮询时长。

### 1.11 媒资与模型注意事项

- 参考图片应使用 CreateNow 服务端可访问的公开 URL；当前应用也会在适配器支持时转为图片 `data:` URL。
- 参考视频应传公网 URL。当前应用本地层会过滤 `data:` 和 `asset://` 形式的视频参考地址。
- `happyhorse-1.0-r2v` 在当前应用中不会使用 `asset://` 图片地址，会改用 Base64 或公开 URL。
- 当前接入层将 Seedance 2.0 兼容模型的 1080p 图片参考视频请求降级为可用分辨率。是否支持某个时长、比例、媒资数或模型专属参数，应以实际账号与官方服务返回结果为准。

---

## 2. CreateNow 应用 API：视频反推上传与解析

本节是 CreateNow 应用自身的项目接口，不是上一节的官方视频生成任务接口。它会上传视频并同步完成当前已实现的反推分析；没有独立的异步任务 ID、状态查询或仅解析文件元数据的接口。

### 2.1 准备本地应用 Token

```bash
export API_BASE="http://<host>:8501/api"
export TOKEN="<application-bearer-token>"
export PROJECT_ID="<project-id>"
export EPISODE_ID="<episode-asset-id>"
```

获取应用 Token 的登录示例参见 [minimal-api-test-cases.md](minimal-api-test-cases.md#1-登录拿-token)。

### 2.2 上传视频并执行反推

```text
POST /projects/{project_id}/storyboards/episode/{episode_id}/video-reverse
```

请求为 `multipart/form-data`：

| 字段 | 类型 | 必填 | 默认值 | 当前行为 |
| --- | --- | --- | --- | --- |
| `file` | file | 是 | 无 | 必须是 `video/*` MIME 类型。 |
| `overwrite_script` | boolean | 否 | `true` | 是否用反推剧本覆盖集的 `script`。 |
| `preprocess_fps` | integer | 否 | `1` | 上传给 VLM 时使用的视频预处理采样帧率。 |
| `overwrite_storyboards` | boolean | 否 | `true` | 路由接收，但当前服务未使用。 |
| `extract_characters` | boolean | 否 | `true` | 路由接收，但当前服务未使用。 |
| `match_assets` | boolean | 否 | `true` | 路由接收，但当前服务未使用。 |

```bash
curl -sS -X POST \
  "$API_BASE/projects/$PROJECT_ID/storyboards/episode/$EPISODE_ID/video-reverse" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/absolute/path/to/source-video.mp4;type=video/mp4" \
  -F "overwrite_script=true" \
  -F "preprocess_fps=1"
```

### 2.3 成功响应

该接口在同一个 HTTP 请求中完成上传、预处理和分析后才返回。典型响应：

```json
{
  "success": true,
  "episode_id": "<episode-id>",
  "episode_number": 1,
  "duration_seconds": 123.45,
  "script_updated": true,
  "analysis_updated": true,
  "segment_count": 9,
  "screenplay_preview": "...",
  "analysis_summary": "",
  "storyboards_created": 0,
  "characters_created": 0,
  "matched_storyboards": 0
}
```

### 2.4 当前解析范围和保存结果

当前实现依次执行以下工作：

1. 将上传文件保存到项目的 `videos/reverse_uploads/` 目录。
2. 使用 FFmpeg 检查时长；仅接受不超过 300 秒的视频。
3. 将视频上传到该项目配置的 VLM，并等待文件预处理就绪。
4. 反推完整剧本；随后并行生成分段视频提示词和剧情分析。
5. 将结果写回对应的 episode 资产。

反推数据写入 episode 的 `video_reverse_screenplay`、`video_reverse_segments`、`video_reverse_analysis`、`video_reverse_raw` 等字段。可通过普通 episode 资产接口读取：

```bash
curl -sS "$API_BASE/projects/$PROJECT_ID/assets/episode/$EPISODE_ID" \
  -H "Authorization: Bearer $TOKEN"
```

本接口当前不会创建分镜、角色或资产，也不提供剧本到分镜的后续调用流程；返回中的 `storyboards_created`、`characters_created`、`matched_storyboards` 当前固定为 `0`。

### 2.5 主要错误

| HTTP 状态 | 场景 |
| --- | --- |
| `400` | 上传文件不是 `video/*`、FFmpeg 无法解析时长、视频超过 300 秒。 |
| `401` | 缺少或无效的应用 Bearer Token。 |
| `404` | 项目或 episode 不存在。 |
| `422` | multipart 字段缺失或字段类型无法校验。 |
| `502` | VLM 上传、预处理或任一反推分析阶段失败。 |
| `500` | FFmpeg 校验超时或未预期的服务端异常。 |

---

## 3. 协议边界与实现依据

- 官方视频生成请求和轮询协议来自当前 CreateNow 兼容视频适配器：`backend/app/services/ai/adapters/createnow.py` 与 `backend/app/services/ai/adapters/byteseed.py`。
- 广场使用本地 `POST /api/projects/{project_id}/generate/video` 记录生成历史并选择上述官方协议中的文本、图片、视频、音频参考组合。该本地封装与官方直连 API 的认证不同。
- 视频反推接口位于 `backend/app/api/storyboards.py`，处理逻辑位于 `backend/app/services/video_reverse_service.py`。内部 VLM 的文件上传、文件就绪和分析调用属于项目 AI 配置实现，不构成本文承诺的独立对外“仅解析视频”协议。
- 本文只描述当前代码和当前 `data/config/global.json` 中可验证的行为。模型、额度、服务可用性和上游能力以实际 CreateNow 账号与官方响应为准。
