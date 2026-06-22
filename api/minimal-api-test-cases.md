# ViPro 外部自动化最小 API 测试用例

本文档用于给外部自动化系统做最小闭环测试，覆盖：认证、项目、集数、资产、分镜、图片、视频生成与结果轮询。

## 0. 测试前准备

### 基础信息

- API Base URL：`http://<host>:8501/api`
- Swagger 文档：`http://<host>:8501/docs`
- OpenAPI JSON：`http://<host>:8501/openapi.json`
- 认证方式：`Authorization: Bearer <token>`

### 建议环境变量

```bash
export API_BASE="http://localhost:8501/api"
export USERNAME="menglaoshi"
export PASSWORD="menglaoshi123"
```

> 如果测试环境提供了专用账号，请替换 `USERNAME` / `PASSWORD`。

---

## 1. 登录拿 token

### 请求

```bash
curl -s -X POST "$API_BASE/admin/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=$USERNAME&password=$PASSWORD"
```

### 期望响应

```json
{
  "access_token": "<jwt_token>",
  "token_type": "bearer"
}
```

### 保存 Token

```bash
export TOKEN="<jwt_token>"
```

### 验证 Token

```bash
curl -s "$API_BASE/admin/me" \
  -H "Authorization: Bearer $TOKEN"
```

---

## 2. 创建测试项目

### 请求

```bash
curl -s -X POST "$API_BASE/projects" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "外部自动化 API 测试项目",
    "description": "用于验证外部系统接入 ViPro 的最小 API 链路"
  }'
```

### 期望响应

返回项目对象，重点保存：

```json
{
  "project_id": "<project_id>",
  "name": "外部自动化 API 测试项目"
}
```

### 保存项目 ID

```bash
export PROJECT_ID="<project_id>"
```

### 读取项目详情

```bash
curl -s "$API_BASE/projects/$PROJECT_ID" \
  -H "Authorization: Bearer $TOKEN"
```

---

## 3. 创建第 1 集

ViPro 现有接口中，集数属于资产类型 `episode`。

### 请求

```bash
curl -s -X POST "$API_BASE/projects/$PROJECT_ID/assets" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "asset_type": "episode",
    "name": "第 1 集",
    "description": "外部自动化测试集",
    "episode_number": 1,
    "metadata": {
      "external_episode_id": "ext-episode-001"
    },
    "tags": ["api-test"]
  }'
```

### 期望响应

```json
{
  "asset_id": "<episode_id>",
  "asset_type": "episode",
  "name": "第 1 集",
  "episode_number": 1
}
```

### 保存集数 ID

```bash
export EPISODE_ID="<episode_id>"
```

### 查询项目下集数

```bash
curl -s "$API_BASE/projects/$PROJECT_ID/assets/episode" \
  -H "Authorization: Bearer $TOKEN"
```

---

## 4. 创建角色、场景、道具资产

ViPro 资产接口支持额外字段，外部系统可以先按自己的结构写入 `metadata` 或直接写入扩展字段。

### 4.1 创建角色

```bash
curl -s -X POST "$API_BASE/projects/$PROJECT_ID/assets" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "asset_type": "character",
    "name": "林晚",
    "description": "女主，短剧主角，外表清冷但内心坚定",
    "appearance": "黑色长发，白色衬衫，通勤风",
    "age": "26",
    "identity": "创业公司产品经理",
    "personality": "冷静、敏感、有行动力",
    "usage_episode_ids": ["'"$EPISODE_ID"'"],
    "tags": ["主角", "api-test"],
    "metadata": {
      "external_asset_id": "ext-char-linwan"
    }
  }'
```

保存返回的 `asset_id`：

```bash
export CHARACTER_ID="<character_id>"
```

### 4.2 创建场景

```bash
curl -s -X POST "$API_BASE/projects/$PROJECT_ID/assets" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "asset_type": "scene",
    "name": "深夜办公室",
    "description": "开放式办公区，窗外是城市夜景，屏幕冷光照在人物脸上",
    "space_structure": "长桌、电脑、玻璃隔断、落地窗",
    "art_style": "现实主义都市短剧",
    "time": "深夜",
    "weather": "小雨",
    "lighting": "冷色屏幕光和弱顶光",
    "usage_episode_ids": ["'"$EPISODE_ID"'"],
    "tags": ["办公室", "api-test"]
  }'
```

保存返回的 `asset_id`：

```bash
export SCENE_ID="<scene_id>"
```

### 4.3 创建道具

```bash
curl -s -X POST "$API_BASE/projects/$PROJECT_ID/assets" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "asset_type": "prop",
    "name": "旧手机",
    "description": "屏幕有裂痕的旧手机，收到关键短信",
    "appearance": "黑色直板智能手机，屏幕边缘破裂",
    "plot_function": "触发女主发现真相",
    "usage_episode_ids": ["'"$EPISODE_ID"'"],
    "tags": ["关键道具", "api-test"]
  }'
```

保存返回的 `asset_id`：

```bash
export PROP_ID="<prop_id>"
```

### 查询资产

```bash
curl -s "$API_BASE/projects/$PROJECT_ID/assets/character" \
  -H "Authorization: Bearer $TOKEN"

curl -s "$API_BASE/projects/$PROJECT_ID/assets/scene" \
  -H "Authorization: Bearer $TOKEN"

curl -s "$API_BASE/projects/$PROJECT_ID/assets/prop" \
  -H "Authorization: Bearer $TOKEN"
```

---

## 5. 创建 2 条分镜

### 5.1 创建第 1 条分镜

```bash
curl -s -X POST "$API_BASE/projects/$PROJECT_ID/storyboards" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "episode_id": "'"$EPISODE_ID"'",
    "sequence": 1,
    "script_scene_label": "1-1",
    "description": "林晚独自坐在深夜办公室，盯着电脑屏幕上的项目数据。",
    "character_ids": ["'"$CHARACTER_ID"'"],
    "scene_id": "'"$SCENE_ID"'",
    "scene_ids": ["'"$SCENE_ID"'"],
    "prop_ids": [],
    "shot_type": "中景",
    "camera_angle": "平视",
    "dialogue": "不能再拖了。",
    "action": "林晚深吸一口气，合上电脑。",
    "image_prompt": "现实主义都市短剧画面，深夜办公室，女主坐在电脑前，冷色屏幕光，中景，电影感"
  }'
```

保存返回的 `asset_id`：

```bash
export STORYBOARD_ID_1="<storyboard_id_1>"
```

### 5.2 创建第 2 条分镜

```bash
curl -s -X POST "$API_BASE/projects/$PROJECT_ID/storyboards" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "episode_id": "'"$EPISODE_ID"'",
    "sequence": 2,
    "script_scene_label": "1-1",
    "description": "旧手机突然亮起，短信内容倒映在林晚震惊的眼睛里。",
    "character_ids": ["'"$CHARACTER_ID"'"],
    "scene_id": "'"$SCENE_ID"'",
    "scene_ids": ["'"$SCENE_ID"'"],
    "prop_ids": ["'"$PROP_ID"'"],
    "shot_type": "特写",
    "camera_angle": "低角度",
    "dialogue": "原来是你。",
    "action": "林晚拿起旧手机，表情从疑惑变成震惊。",
    "image_prompt": "旧手机亮起短信，女主眼神震惊，手机屏幕冷光，特写，都市悬疑短剧质感"
  }'
```

保存返回的 `asset_id`：

```bash
export STORYBOARD_ID_2="<storyboard_id_2>"
```

### 查询某集分镜列表

```bash
curl -s "$API_BASE/projects/$PROJECT_ID/storyboards/episode/$EPISODE_ID" \
  -H "Authorization: Bearer $TOKEN"
```

---

## 6. 上传或生成分镜图片

二选一即可。若测试环境没有可用图片模型，建议先走上传图片。

### 6A. 上传分镜图片

```bash
curl -s -X POST "$API_BASE/projects/$PROJECT_ID/generate/images/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "asset_id=$STORYBOARD_ID_1" \
  -F "asset_type=storyboard" \
  -F "prompt=外部系统上传的分镜参考图" \
  -F "file=@/path/to/test-image.png"
```

### 期望响应

```json
{
  "image_id": "<image_id>",
  "asset_id": "<storyboard_id>",
  "asset_type": "storyboard",
  "model": "manual_upload",
  "local_path": "storyboard/<filename>"
}
```

保存图片 ID：

```bash
export IMAGE_ID_1="<image_id>"
```

### 6B. 生成分镜图片

```bash
curl -s -X POST "$API_BASE/projects/$PROJECT_ID/generate/image" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "asset_id": "'"$STORYBOARD_ID_1"'",
    "asset_type": "storyboard",
    "prompt": "现实主义都市短剧画面，深夜办公室，女主坐在电脑前，冷色屏幕光，中景，电影感",
    "negative_prompt": "低清晰度，畸形，错乱文字",
    "size": "16x9"
  }'
```

保存返回的 `image_id`：

```bash
export IMAGE_ID_1="<image_id>"
```

### 查询分镜图片结果

```bash
curl -s "$API_BASE/projects/$PROJECT_ID/generate/images/$STORYBOARD_ID_1" \
  -H "Authorization: Bearer $TOKEN"
```

---

## 7. 触发单分镜视频生成

视频生成依赖已有图片。请先完成第 6 步并保存 `IMAGE_ID_1`。

### 请求

```bash
curl -s -X POST "$API_BASE/projects/$PROJECT_ID/generate/video" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "storyboard_id": "'"$STORYBOARD_ID_1"'",
    "episode_id": "'"$EPISODE_ID"'",
    "image_ids": ["'"$IMAGE_ID_1"'"],
    "prompt": "林晚在深夜办公室合上电脑，镜头缓慢推进，冷色屏幕光逐渐熄灭，情绪压抑克制。",
    "duration": 6,
    "resolution": "720p",
    "ratio": "16:9"
  }'
```

### 期望响应

```json
{
  "video_id": "<video_id>",
  "storyboard_id": "<storyboard_id>",
  "episode_id": "<episode_id>",
  "task_id": "<provider_task_id>",
  "status": "pending"
}
```

保存视频 ID：

```bash
export VIDEO_ID_1="<video_id>"
```

---

## 8. 轮询视频列表读取结果

### 按分镜查询视频

```bash
curl -s "$API_BASE/projects/$PROJECT_ID/videos?storyboard_id=$STORYBOARD_ID_1" \
  -H "Authorization: Bearer $TOKEN"
```

### 按剧集查询视频

```bash
curl -s "$API_BASE/projects/$PROJECT_ID/videos?episode_id=$EPISODE_ID" \
  -H "Authorization: Bearer $TOKEN"
```

### 另一组生成记录接口

```bash
curl -s "$API_BASE/projects/$PROJECT_ID/generate/videos?episode_id=$EPISODE_ID" \
  -H "Authorization: Bearer $TOKEN"
```

### 状态说明

常见状态：

- `pending`：已提交生成服务，等待结果
- `completed`：生成完成，可读取 `video_path` 或本地文件 URL
- `failed` / `poll_failed`：生成失败，可查看 `error` 或 `last_poll_response`

### 下载视频文件

如果返回的视频记录包含可访问 URL，可直接读取该 URL。若需按视频 ID 下载：

```bash
curl -L "$API_BASE/projects/$PROJECT_ID/videos/file/$VIDEO_ID_1" \
  -H "Authorization: Bearer $TOKEN" \
  -o "$VIDEO_ID_1.mp4"
```

---

## 最小能力覆盖矩阵

| 客户关心能力 | 当前最小用例覆盖方式 |
| --- | --- |
| 统一认证 | `POST /api/admin/login` + Bearer Token |
| 项目读写 | `/api/projects` |
| 集数读写 | `/api/projects/{project_id}/assets/episode` |
| 资产读写 | `/api/projects/{project_id}/assets/{character|scene|prop}` |
| 分镜读写 | `/api/projects/{project_id}/storyboards` |
| 图片上传/生成/查询 | `/api/projects/{project_id}/generate/images/*` |
| 视频生成 | `/api/projects/{project_id}/generate/video` |
| 结果轮询 | `/api/projects/{project_id}/videos` 或 `/generate/videos` |

## 暂用约定

- 批量创建资产/分镜：当前最小测试阶段由外部系统循环调用单条创建接口。
- 质检/返工字段：最小测试阶段可先写入分镜扩展字段，例如 `qc_status`、`qc_report`、`rework_note`；如需正式化，可后续增加轻量接口。
- Webhook：当前最小测试阶段先使用轮询视频列表和导出状态接口。
