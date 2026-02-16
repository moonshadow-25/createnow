# 字节Seed视频生成适配器实现总结

## 📋 实现内容

### 1. 核心适配器文件
- **文件**: `backend/app/services/ai/adapters/byteseed.py`
- **类**: `ByteSeedVideoAdapter`
- **功能**:
  - 单图生成（首帧模式）
  - 多图生成（首尾帧/参考图模式）
  - 任务状态轮询
  - 分辨率到比例映射
  - 状态映射
  - 日志记录

### 2. 适配器注册
- **文件**: `backend/app/services/ai/adapters/base.py`
- **修改**: 在 `get_video_adapter()` 函数中注册 `byteseed` 适配器

### 3. 服务层集成
- **文件**: `backend/app/services/ai_service.py`
- **修改**: 添加 `generate_audio` 和 `watermark` 参数支持

- **文件**: `backend/app/services/ai/video.py`
- **修改**: 在 `VideoGenService` 中添加 ByteSeed 特有参数

### 4. 文档和测试
- **使用文档**: `backend/app/services/ai/adapters/README_BYTESEED.md`
- **测试脚本**: `backend/test_byteseed_adapter.py`

---

## 🎯 核心特性

### 支持的生成模式

1. **单图模式（首帧）**
   - 1张图片 → 视频
   - content数组：`[{text}, {image}]`
   - 不指定role

2. **首尾帧模式**
   - 2张图片 → 视频
   - content数组：`[{text}, {image, role: first_frame}, {image, role: last_frame}]`
   - 用户在分镜页面多选2个分镜即可使用

3. **参考图模式**
   - 3张及以上图片 → 视频
   - content数组：`[{text}, {image, role: reference_image}, ...]`
   - ratio自动设置为 `adaptive`

### 参数支持

| 参数 | 类型 | 说明 |
|------|------|------|
| `generate_audio` | bool | 是否生成音频（Seed 1.5 Pro支持） |
| `watermark` | bool | 是否添加水印 |
| `ratio` | string | 视频比例（16:9, 9:16, 1:1, 4:3, 3:4, 21:9, adaptive） |
| `resolution` | string | 固定为 "1080p" |
| `duration` | int | 视频时长（秒） |

### 状态映射

| ByteSeed | 统一状态 |
|----------|---------|
| pending | pending |
| processing/running | in_progress |
| succeeded/completed | completed |
| failed/error | failed |

---

## 🚀 使用方法

### 方式1: 环境变量配置（全局默认）

编辑 `backend/.env`:

```env
DEFAULT_VIDEO_API_URL=https://ark.cn-beijing.volces.com/api/v3
DEFAULT_VIDEO_API_KEY=your-byteseed-api-key
DEFAULT_VIDEO_MODEL=doubao-seedance-1-5-pro-251215
```

### 方式2: 项目级别配置

在项目的 `data/projects/{project_id}/metadata.json` 中配置：

```json
{
  "project_name": "我的项目",
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

### 前端使用

#### 单图生成
```typescript
// 在视频生成对话框中点击"生成视频"
await generationApi.generateVideo(projectId, {
  storyboard_id: storyboard.asset_id,
  episode_id: episodeId,
  image_id: primaryImage.image_id,
  prompt: videoPrompt,
  duration: 5,
  resolution: "1920x1080"
});
```

#### 首尾帧生成
```typescript
// 在分镜页面多选2个分镜，点击"插入首尾帧视频"
await generationApi.generateVideoMultiImage(projectId, {
  storyboard_id: firstStoryboard.asset_id,
  episode_id: episodeId,
  image_ids: [firstImage.image_id, lastImage.image_id],
  prompt: videoPrompt,
  duration: 5,
  resolution: "1920x1080"
});
```

---

## 🧪 测试方法

### 1. 单元测试（映射功能）

```bash
cd backend
python test_byteseed_adapter.py
```

这会测试：
- ✅ 分辨率到比例映射
- ✅ 状态映射

### 2. 集成测试（需要API密钥）

1. 编辑 `test_byteseed_adapter.py`
2. 修改配置：
   ```python
   API_KEY = "your-actual-api-key"
   TEST_IMAGE_BASE64 = "data:image/jpeg;base64,..."  # 实际图片
   ```
3. 运行测试：
   ```bash
   python test_byteseed_adapter.py
   ```

### 3. 实际使用测试

1. 启动后端服务：
   ```bash
   conda activate createnow
   cd backend
   python -m app.main
   ```

2. 启动前端：
   ```bash
   cd frontend
   npm run dev
   ```

3. 在项目中配置ByteSeed API
4. 生成分镜图
5. 测试单图生成或首尾帧生成

---

## 📝 API请求示例

### 单图生成请求

```json
POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks
Authorization: Bearer your-api-key
Content-Type: application/json

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
        "url": "data:image/jpeg;base64,/9j/4AAQ..."
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

### 创建响应

```json
{
  "id": "cgt-2025******-****"
}
```

### 查询任务

```bash
GET https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{task_id}
Authorization: Bearer your-api-key
```

### 查询响应（成功）

```json
{
  "id": "cgt-2025******-****",
  "model": "doubao-seedance-1-5-pro-251215",
  "status": "succeeded",
  "content": {
    "video_url": "https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/xxx"
  },
  "duration": 5,
  "ratio": "16:9",
  "resolution": "720p",
  "generate_audio": true
}
```

---

## 🔍 技术细节

### 适配器架构

```
VideoGenService (服务层)
    ↓
get_video_adapter() (工厂函数)
    ↓
ByteSeedVideoAdapter (适配器)
    ↓
ByteSeed API (字节跳动Seed API)
```

### 数据流

1. **前端** → API请求（image_id 或 image_ids）
2. **API层** → 转换为base64，判断单图/多图
3. **服务层** → 调用 generate() 或 generate_multi_image()
4. **适配器** → 构建content数组，调用ByteSeed API
5. **ByteSeed API** → 返回task_id
6. **轮询** → 定期查询任务状态
7. **完成** → 下载视频到本地

### 关键实现

#### 1. Content数组构建
```python
# 单图
content = [
    {"type": "text", "text": prompt},
    {"type": "image_url", "image_url": {"url": image_url}}
]

# 首尾帧
content = [
    {"type": "text", "text": prompt},
    {"type": "image_url", "image_url": {"url": url1}, "role": "first_frame"},
    {"type": "image_url", "image_url": {"url": url2}, "role": "last_frame"}
]
```

#### 2. 分辨率映射
```python
def _map_resolution_to_ratio(self, resolution: str) -> str:
    ratio_map = {
        "1920x1080": "16:9",
        "1080x1920": "9:16",
        "1024x1024": "1:1",
        # ...
    }
    return ratio_map.get(resolution, "16:9")
```

#### 3. 状态映射
```python
def _map_status(self, seed_status: str) -> str:
    status_map = {
        "succeeded": "completed",
        "processing": "in_progress",
        # ...
    }
    return status_map.get(seed_status.lower(), "pending")
```

---

## ⚠️ 注意事项

1. **API密钥安全**
   - 不要将API密钥提交到Git
   - 使用环境变量或项目配置

2. **图片格式**
   - ByteSeed支持base64格式
   - 本软件默认使用base64传输本地图片
   - 图片会被自动转换

3. **模型选择**
   - Seed 1.5 Pro: 支持首尾帧、音频生成
   - Seed 1.0 Lite: 支持参考图模式

4. **轮询频率**
   - 建议30秒轮询一次
   - 避免频繁请求导致限流

5. **错误处理**
   - 所有错误都会返回统一格式
   - 查看AI日志获取详细信息

---

## 📚 相关文档

- **ByteSeed API文档**: https://www.volcengine.com/docs/6791/1298968
- **使用指南**: `backend/app/services/ai/adapters/README_BYTESEED.md`
- **测试脚本**: `backend/test_byteseed_adapter.py`
- **项目文档**: `CLAUDE.md`

---

## ✅ 实现完成清单

- [x] 创建ByteSeedVideoAdapter适配器
- [x] 实现generate()方法（单图模式）
- [x] 实现generate_multi_image()方法（首尾帧/参考图）
- [x] 实现poll()方法（状态轮询）
- [x] 实现分辨率映射
- [x] 实现状态映射
- [x] 在base.py中注册适配器
- [x] 在ai_service.py中添加参数支持
- [x] 在video.py中传递参数
- [x] 创建使用文档
- [x] 创建测试脚本
- [x] 创建总结文档

---

## 🎉 总结

字节Seed视频生成适配器已完全实现，支持：
- ✅ 单图生成（首帧模式）
- ✅ 首尾帧生成（2张图）
- ✅ 参考图生成（3张及以上）
- ✅ 音频生成配置
- ✅ 水印配置
- ✅ 完整的错误处理
- ✅ 日志记录
- ✅ 状态轮询

用户只需配置API密钥和模型，即可在前端界面中使用所有功能，无需修改任何前端代码。
