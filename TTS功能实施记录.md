# TTS 音频功能实施记录

> **实施时间**: 2026-02-09
> **状态**: 🔄 进行中（后端完成70%，前端完成30%）
> **基于**: `需求确认补充.md` - 上下文1

---

## ✅ 已完成功能

### 1. 配置层

#### 后端配置 (`backend/app/core/config.py`)
```python
# 新增TTS配置项
DEFAULT_TTS_API_URL: str = "https://api.openai.com/v1"
DEFAULT_TTS_API_KEY: str = ""
DEFAULT_TTS_MODEL: str = "tts-1"
DEFAULT_TTS_VOICE: str = "alloy"
DASHSCOPE_TTS_API_URL: str = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2audio/speech-synthesis"
```

#### 前端类型定义 (`frontend/src/types/index.ts`)
```typescript
export interface ApiConfig {
  // ... 现有字段
  voice?: string;  // TTS专用：OpenAI/阿里百炼的音色
  id?: string;     // TTS专用：本地API的speaker id
}

export interface ApiConfigPresetsMap {
  llm: ApiConfigPreset[];
  vlm: ApiConfigPreset[];
  image: ApiConfigPreset[];
  video: ApiConfigPreset[];
  tts: ApiConfigPreset[];  // 新增
}

export interface Project {
  ai_config?: {
    llm: ApiConfig;
    vlm?: ApiConfig;
    image: ApiConfig;
    video: ApiConfig;
    tts?: ApiConfig;  // 新增
    // ...
  };
}
```

#### 前端设置界面
- **SettingsModal**: 支持TTS配置状态管理和预设切换
- **ApiConfigPanel**:
  - 新增"语音合成"子标签页
  - 根据`api_type`动态显示：
    - OpenAI/阿里百炼: 显示"默认音色 (可选)"字段
    - 本地API: 显示"Speaker ID (可选)"字段
  - 支持配置验证
  - 支持预设管理（保存/切换/删除）

### 2. 验证功能

#### 后端验证服务 (`backend/app/services/validation_service.py`)
```python
@staticmethod
async def validate_tts_api(
    api_url: str,
    api_key: str,
    model: str,
    api_type: str = "openai",
    voice: str = None,
    id: str = None
) -> Dict[str, Any]:
    """验证TTS API配置"""
    # OpenAI: /audio/speech, payload: {model, input, voice}
    # 阿里百炼: TTS端点, payload: {model, input: {text}, parameters: {voice}}
    # 本地API: /audio/speech, payload: {model, input, id}
```

#### 验证API (`backend/app/api/validation.py`)
```python
@router.post("/tts")
async def validate_tts(request: TTSValidationRequest):
    """验证TTS API配置"""
```

#### 前端验证 (`frontend/src/services/api.ts`)
```typescript
export const validationApi = {
  validateTTS: (config: {
    api_url?: string;
    api_key?: string;
    model?: string;
    api_type?: string;
    voice?: string;
    id?: string
  }) => api.post('/validate/tts', config),
};
```

### 3. 数据模型

#### AudioGeneration 模型 (`backend/app/models/project.py`)
```python
class AudioGeneration(BaseModel):
    """音频生成记录"""
    audio_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    project_id: str  # 所属项目
    storyboard_id: Optional[str] = None  # 关联的分镜（可选）
    episode_id: Optional[str] = None  # 关联的剧集（可选）
    text: str  # 转换的文本内容
    voice: Optional[str] = None  # 音色（OpenAI/阿里百炼）
    speaker_id: Optional[str] = None  # Speaker ID（本地API）
    model: str = ""  # 使用的模型
    audio_path: Optional[str] = None  # 音频URL（如果API返回URL）
    local_path: Optional[str] = None  # 本地文件路径（相对于audios/files/）
    duration: Optional[float] = None  # 音频时长（秒）
    format: str = "mp3"  # 音频格式
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    is_primary: bool = False  # 是否为主音频
```

### 4. AI服务层

#### TTSService (`backend/app/services/tts_service.py`)

**核心功能**：
- 支持三种API类型：OpenAI、阿里百炼、本地API
- `generate()` 方法调用TTS API
- 返回音频二进制数据或URL

**关键实现**：
```python
async def generate(
    self,
    text: str,
    voice: Optional[str] = None,
    speaker_id: Optional[str] = None,
    format: str = "mp3"
) -> Dict[str, Any]:
    """
    生成语音

    Returns:
        {
            "success": True/False,
            "audio_data": bytes,  # 音频二进制数据
            "audio_url": str,     # 或音频URL（如果API返回URL）
            "error": str          # 错误信息
        }
    """
```

**API适配**：
- OpenAI: `POST {api_url}/audio/speech`, payload: `{model, input, voice}`
- 阿里百炼: `POST {api_url}`, payload: `{model, input: {text}, parameters: {voice}}`
- 本地API: `POST {api_url}/audio/speech`, payload: `{model, input, id}`

### 5. 业务服务层

#### AudioService (`backend/app/services/audio_service.py`)

**核心方法**：
- `save_generation_record(project_id, record)`: 保存音频记录到JSON文件
- `get_audio(project_id, audio_id)`: 获取单个音频记录
- `list_audios(project_id, storyboard_id?, episode_id?)`: 列出音频（支持过滤）
- `delete_audio(project_id, audio_id)`: 删除音频记录及文件
- `set_primary_audio(project_id, storyboard_id, audio_id)`: 设置主音频

**文件存储结构**：
```
data/projects/{project_id}/
└── audios/
    ├── {audio_id}.json  # 音频记录
    ├── {audio_id}.json
    └── files/
        ├── {audio_id}.mp3  # 音频文件
        └── {audio_id}.mp3
```

#### AudioDownloadService (`backend/app/services/audio_download_service.py`)

**核心方法**：
- `save_audio_data(project_id, audio_id, audio_data, format)`: 保存音频二进制数据到文件
- `download_and_save_audio(project_id, audio_id, url, format)`: 从URL下载音频
- `get_file_extension(format)`: 获取音频扩展名

### 6. API路由

#### 音频生成API (`backend/app/api/generation/audio.py`)

**端点列表**：

1. **POST `/api/projects/{project_id}/generate/audio`**
   - 功能：生成音频
   - 请求体：
     ```json
     {
       "text": "要转换的文本",
       "storyboard_id": "分镜ID（可选）",
       "episode_id": "剧集ID（可选）",
       "voice": "alloy",
       "speaker_id": "0",
       "format": "mp3"
     }
     ```
   - 响应：AudioGeneration记录（含local_path）

2. **GET `/api/projects/{project_id}/generate/audios`**
   - 功能：列出音频
   - 查询参数：`storyboard_id`, `episode_id`
   - 响应：音频记录数组

3. **GET `/api/projects/{project_id}/generate/audios/{audio_id}`**
   - 功能：获取单个音频记录

4. **DELETE `/api/projects/{project_id}/generate/audios/{audio_id}`**
   - 功能：删除音频

5. **POST `/api/projects/{project_id}/generate/audios/{audio_id}/set-primary`**
   - 功能：设置主音频
   - 请求体：`{"storyboard_id": "xxx"}`

#### 文件访问路由 (`backend/app/main.py`)

**GET `/api/projects/{project_id}/audios/files/{filename}`**
- 功能：访问本地音频文件
- 支持格式：mp3, wav, opus, aac, flac, ogg
- 响应头：`Cache-Control: public, max-age=31536000`

### 7. 工作流程

```
用户调用生成音频API
    ↓
TTSService调用TTS API
    ↓
API返回音频数据或URL
    ↓
[分支1] 直接返回音频数据
    ↓
AudioDownloadService.save_audio_data()
    ↓
保存到 audios/files/{audio_id}.mp3

[分支2] 返回音频URL
    ↓
异步任务：AudioDownloadService.download_and_save_audio()
    ↓
下载并保存到本地

    ↓
AudioService.save_generation_record()
    ↓
保存记录到 audios/{audio_id}.json
    ↓
立即返回给前端（含local_path）
```

---

## ❌ 未完成功能

### 1. 前端音频播放组件
- [ ] AudioPlayer组件
- [ ] 音频波形显示
- [ ] 播放控制（播放/暂停/进度条）

### 2. 音频生成UI
- [ ] 音频生成对话框
- [ ] 文本输入
- [ ] 音色选择下拉框
- [ ] 生成按钮和进度提示

### 3. 音频库展示
- [ ] AudioLibrary组件
- [ ] 音频列表展示
- [ ] 播放/删除/设置主音频操作
- [ ] 音频信息显示（时长、创建时间等）

### 4. 分镜集成
- [ ] 分镜详情页显示音频提示词卡片
- [ ] "生成音频"按钮
- [ ] 音频库显示在视频库下方

---

## 📦 文件清单

### 新增文件

**后端**:
- `backend/app/services/audio_service.py` (130行)
- `backend/app/services/tts_service.py` (160行)
- `backend/app/services/audio_download_service.py` (110行)
- `backend/app/api/generation/audio.py` (180行)

**前端**:
- 无新增文件

### 修改文件

**后端**:
- `backend/app/models/project.py`: 新增AudioGeneration模型
- `backend/app/services/__init__.py`: 导出AudioService和TTSService
- `backend/app/api/generation/__init__.py`: 注册audio路由
- `backend/app/main.py`: 新增音频文件访问路由
- `backend/app/core/config.py`: 新增TTS配置项
- `backend/app/services/validation_service.py`: 新增validate_tts_api()
- `backend/app/api/validation.py`: 新增TTS验证端点

**前端**:
- `frontend/src/types/index.ts`: 扩展ApiConfig和ApiConfigPresetsMap
- `frontend/src/components/settings/SettingsModal.tsx`: 支持TTS配置
- `frontend/src/components/settings/ApiConfigPanel.tsx`: 新增TTS表单
- `frontend/src/services/api.ts`: 新增validateTTS

---

## 🔑 关键技术点

### 1. 音频生成是同步的
- **不需要轮询**（类似图片生成，不同于视频生成）
- API直接返回音频数据或URL
- 后端立即保存并返回记录

### 2. 三种API类型适配
- **OpenAI**: `/audio/speech`, 使用`voice`参数
- **阿里百炼**: TTS专用端点, 使用`voice`参数
- **本地API**: `/audio/speech`, 使用`id`参数（speaker id）

### 3. 音频存储
- 记录文件: `audios/{audio_id}.json`
- 音频文件: `audios/files/{audio_id}.mp3`
- `local_path`字段存储相对路径（相对于audios/files/）

### 4. 主音频机制
- 每个分镜可以有多个音频
- 只有一个`is_primary=true`的主音频
- 用于导出时使用

---

## 🧪 测试方法

### 1. 配置验证测试

```bash
# 前端操作：
# 1. 打开项目设置 → API设置 → 语音合成
# 2. 填写API配置
# 3. 点击"验证"按钮
# 4. 查看验证结果
```

### 2. 音频生成测试

```bash
# 使用curl测试
curl -X POST "http://localhost:8001/api/projects/{project_id}/generate/audio" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "你好，这是一段测试音频",
    "voice": "alloy",
    "format": "mp3"
  }'

# 预期响应：
# {
#   "audio_id": "xxx",
#   "project_id": "xxx",
#   "text": "你好，这是一段测试音频",
#   "voice": "alloy",
#   "model": "tts-1",
#   "format": "mp3",
#   "local_path": "xxx.mp3",
#   "created_at": "2026-02-09T...",
#   "is_primary": false
# }
```

### 3. 音频访问测试

```bash
# 列出音频
curl "http://localhost:8001/api/projects/{project_id}/generate/audios"

# 访问音频文件
curl "http://localhost:8001/api/projects/{project_id}/audios/files/{audio_id}.mp3" \
  --output test.mp3
```

---

## 📊 进度统计

- **已完成**: 约70%（后端核心功能 + 前端配置界面）
- **待完成**: 约30%（前端音频播放和生成UI）

### 完成度详细

| 模块 | 进度 | 说明 |
|------|------|------|
| 配置层 | 100% | 后端+前端配置完成 |
| 验证功能 | 100% | 三种API类型验证完成 |
| 数据模型 | 100% | AudioGeneration模型完成 |
| AI服务层 | 100% | TTSService完成 |
| 业务服务 | 100% | AudioService + AudioDownloadService完成 |
| API路由 | 100% | 所有端点完成 |
| 文件访问 | 100% | 音频文件访问路由完成 |
| **前端UI** | **0%** | 尚未开始 |

---

## 📝 后续工作

### 下一步（前端UI）

1. **创建AudioPlayer组件**
   - 播放/暂停按钮
   - 进度条
   - 时长显示

2. **创建AudioGenerateDialog组件**
   - 文本输入框
   - 音色选择（根据API类型显示voice或id）
   - 格式选择
   - 生成按钮

3. **创建AudioLibrary组件**
   - 音频列表
   - 播放按钮
   - 删除按钮
   - 设置主音频按钮

4. **集成到分镜详情页**
   - 显示audio_prompt卡片
   - 调用AudioGenerateDialog生成音频
   - 显示AudioLibrary

---

## 🐛 已知问题

无

---

## 💡 优化建议

1. **音频格式支持**: 当前默认mp3，后续可考虑支持更多格式
2. **音频时长获取**: 当前duration字段未实现，可考虑解析音频文件获取
3. **批量生成**: 可考虑支持批量文本转音频
4. **音频编辑**: 可考虑支持音频剪辑、拼接等功能

---

## 📚 参考文档

- `需求确认补充.md`: 原始需求文档
- `主体和音频功能实施计划.md`: 完整实施计划
- OpenAI TTS API文档: https://platform.openai.com/docs/guides/text-to-speech
- 阿里百炼TTS文档: https://help.aliyun.com/zh/model-studio/
