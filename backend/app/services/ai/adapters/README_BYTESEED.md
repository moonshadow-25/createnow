# 字节Seed视频生成适配器使用指南

## 概述

ByteSeed适配器支持字节跳动Seed API的视频生成功能，包括：
- 文生视频
- 图生视频（首帧）
- 图生视频（首尾帧）
- 图生视频（参考图）

## 配置方式

### 1. 环境变量配置（全局默认）

在 `backend/.env` 文件中配置：

```env
# 字节Seed视频生成API
DEFAULT_VIDEO_API_URL=https://ark.cn-beijing.volces.com/api/v3
DEFAULT_VIDEO_API_KEY=your-byteseed-api-key
DEFAULT_VIDEO_MODEL=doubao-seedance-1-5-pro-251215
```

### 2. 项目级别配置（覆盖默认）

在项目的 `metadata.json` 中配置：

```json
{
  "ai_config": {
    "video": {
      "api_type": "byteseed",
      "api_url": "https://ark.cn-beijing.volces.com/api/v3",
      "api_key": "your-byteseed-api-key",
      "model": "doubao-seedance-1-5-pro-251215",
      "generate_audio": true,
      "watermark": false
    }
  }
}
```

## 配置参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `api_type` | string | - | 必须设置为 `"byteseed"` |
| `api_url` | string | - | API基础URL |
| `api_key` | string | - | API密钥 |
| `model` | string | - | 模型名称 |
| `generate_audio` | boolean | `false` | 是否生成音频 |
| `watermark` | boolean | `false` | 是否添加水印 |

## 支持的模型

### 文生视频模型
- `doubao-seedance-1-0-pro-250528` - Seed 1.0 Pro

### 图生视频模型
- `doubao-seedance-1-5-pro-251215` - Seed 1.5 Pro（推荐，支持首尾帧、音频生成）
- `doubao-seedance-1-0-lite-i2v-250428` - Seed 1.0 Lite（支持参考图）

## 支持的比例

- `16:9` - 横屏（1920x1080, 1280x720）
- `9:16` - 竖屏（1080x1920, 720x1280）
- `1:1` - 方形（1024x1024）
- `4:3` - 标准（1440x1080）
- `3:4` - 竖版标准（1080x1440）
- `21:9` - 超宽屏（2560x1080）
- `adaptive` - 自适应（参考图模式）

## 使用示例

### 单图生成（首帧模式）

前端调用：
```typescript
await generationApi.generateVideo(projectId, {
  storyboard_id: storyboard.asset_id,
  episode_id: episodeId,
  image_id: primaryImage.image_id,  // 单图
  prompt: "女孩抱着狐狸，女孩睁开眼，温柔地看向镜头",
  duration: 5,
  resolution: "1920x1080"
});
```

后端API请求：
```json
{
  "model": "doubao-seedance-1-5-pro-251215",
  "content": [
    {
      "type": "text",
      "text": "女孩抱着狐狸，女孩睁开眼，温柔地看向镜头"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "data:image/jpeg;base64,..."
      }
    }
  ],
  "ratio": "16:9",
  "resolution": "1080p",
  "duration": 5,
  "watermark": false,
  "generate_audio": true
}
```

### 首尾帧生成

前端调用：
```typescript
await generationApi.generateVideoMultiImage(projectId, {
  storyboard_id: firstStoryboard.asset_id,
  episode_id: episodeId,
  image_ids: [firstImage.image_id, lastImage.image_id],  // 2张图
  prompt: "图中女孩对着镜头说"茄子"，360度环绕运镜",
  duration: 5,
  resolution: "1920x1080"
});
```

后端API请求：
```json
{
  "model": "doubao-seedance-1-5-pro-251215",
  "content": [
    {
      "type": "text",
      "text": "图中女孩对着镜头说"茄子"，360度环绕运镜"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "data:image/jpeg;base64,..."
      },
      "role": "first_frame"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "data:image/jpeg;base64,..."
      },
      "role": "last_frame"
    }
  ],
  "ratio": "adaptive",
  "resolution": "1080p",
  "duration": 5,
  "watermark": false,
  "generate_audio": true
}
```

### 参考图生成（3张及以上）

后端API请求：
```json
{
  "model": "doubao-seedance-1-0-lite-i2v-250428",
  "content": [
    {
      "type": "text",
      "text": "[图1]戴着眼镜穿着蓝色T恤的男生和[图2]的柯基小狗，坐在[图3]的草坪上，3D卡通风格"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "data:image/jpeg;base64,..."
      },
      "role": "reference_image"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "data:image/jpeg;base64,..."
      },
      "role": "reference_image"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "data:image/jpeg;base64,..."
      },
      "role": "reference_image"
    }
  ],
  "ratio": "adaptive",
  "resolution": "1080p",
  "duration": 5,
  "watermark": false
}
```

## API响应格式

### 创建任务响应
```json
{
  "id": "cgt-2025******-****"
}
```

### 查询任务响应
```json
{
  "id": "cgt-2025******-****",
  "model": "doubao-seedance-1-5-pro-251215",
  "status": "succeeded",
  "content": {
    "video_url": "https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/xxx"
  },
  "usage": {
    "completion_tokens": 108900,
    "total_tokens": 108900
  },
  "created_at": 1743414619,
  "updated_at": 1743414673,
  "seed": 10,
  "resolution": "720p",
  "ratio": "16:9",
  "duration": 5,
  "framespersecond": 24,
  "service_tier": "default",
  "execution_expires_after": 172800,
  "generate_audio": true,
  "draft": false
}
```

## 状态映射

| ByteSeed状态 | 统一状态 | 说明 |
|-------------|---------|------|
| `pending` | `pending` | 等待处理 |
| `processing` | `in_progress` | 处理中 |
| `running` | `in_progress` | 运行中 |
| `succeeded` | `completed` | 已完成 |
| `completed` | `completed` | 已完成 |
| `failed` | `failed` | 失败 |
| `error` | `failed` | 错误 |

## 注意事项

1. **图片格式**：ByteSeed支持base64格式，本软件默认使用base64传输本地图片
2. **分辨率参数**：固定为 `"1080p"`，实际比例通过 `ratio` 参数控制
3. **音频生成**：仅 Seed 1.5 Pro 模型支持 `generate_audio` 参数
4. **参考图模式**：使用 `adaptive` ratio，由API自动适配
5. **轮询间隔**：建议30秒轮询一次任务状态

## 错误处理

适配器会自动处理以下错误：
- HTTP错误（4xx, 5xx）
- API错误响应
- 缺少task_id
- 缺少video_url

所有错误都会返回统一格式：
```json
{
  "success": false,
  "status": "failed",
  "error": "错误信息",
  "raw_create_response": {...}
}
```

## 日志记录

适配器会自动记录所有API交互：
- 请求URL和方法
- 请求payload（base64会被截断）
- 响应数据
- 错误信息
- 请求耗时

日志可在项目的AI日志中查看。
