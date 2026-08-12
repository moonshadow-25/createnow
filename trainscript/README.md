# CreateNow 训练数据采集（trainscript）

从 CreateNow 项目数据目录采集 AIGC 生成数据，整理为
《AIGC多模态生成数据交付格式规范》v1.0 的目录结构与 `meta.jsonl`。
**可在不同部署机上「双击」运行采集。**

```
trainscript/
├── collect_traindata.py   # 核心采集脚本（纯标准库，跨平台）
├── run_collect.bat         # 双击入口（Windows）
└── README.md
```

---

## 一、如何运行

### Windows（目标用法）
直接**双击 `run_collect.bat`**。脚本会自动：
1. 定位 Python（优先项目自带 `env\python.exe`，其次系统 `python`/`py -3`）；
2. 定位本脚本目录与项目数据根；
3. 采集视频（默认 30 条、15 秒、仅人工筛选主视频、按项目分层分散）、图片、音频素材；
4. 生成 `meta/meta.jsonl`（每行 25 字段）与 `dataset_info.json`。

正常会先打印配置摘要再执行。**产物输出到项目根 `traindata/`**（可改 `OUT_DIR` 覆盖）。

### 命令行直接运行
```bash
# 全默认（等价于双击）
python collect_traindata.py

# 指定数据源与输出、改数量与时长
python collect_traindata.py --src D:/deploy/data/projects --out D:/traindata \
    --video-count 40 --duration 15

# 只要人工筛选主视频、按项目分散（默认即是）
python collect_traindata.py --primary-only --by-project

# 不限主视频 + 全局随机（结果可能集中在少数项目）
python collect_traindata.py --no-primary-only --global-random

# 先清空输出再重建（避免与旧产物残留混在一起）
python collect_traindata.py --clean
```

---

## 二、部署机注意事项（重要）

1. **源数据路径**：脚本默认源目录 = `collect_traindata.py` 所在目录的上一级里的 `data/projects`，
   即 `trainscript\..\data\projects`。若部署机结构不同，双击改 `run_collect.bat` 顶部的
   `SRC_DIR`，或命令行加 `--src`。
2. **Python**：任选一种即可 ——
   - 项目自带 venv：`trainscript\..\env\python.exe`（默认自动命中）；
   - 或系统 Python 3（已在 PATH）。
3. **ffmpeg（推荐但非必需）**：用于探测视频真实 宽/高/时长/fps。
   找不到时视频的 `width/height/resolution/fps` 会列为 `null`（仅时长用源字段）。
   - 自动探测顺序：项目 `backend\bin\ffmpeg.exe`、根 `bin\`、PATH 中的 `ffmpeg`；
   - 也可 `--ffmpeg C:\ffmpeg\bin\ffmpeg.exe` 显式指定。
4. **网络/权限**：仅本地读取 `data/projects` 并复制到输出目录，**不联网、不调用任何 AI API、不做打标**，
   可离线运行。

---

## 三、可配置参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `--src` | 项目默认 | 源 `projects` 根 |
| `--out` | 项目默认 | 输出目录（traindata） |
| `--video-count` | 30 | 采集视频数量 |
| `--duration` | 15 | 只取该时长的视频（秒）；`0`=不限 |
| `--primary-only` / `--no-primary-only` | 是 | 仅人工筛选主视频 / 不限 |
| `--by-project` / `--global-random` | 按项目 | 跨项目分层分散 / 全局随机 |
| `--image-count` | `10,10,10` | `storyboard,character,scene` 各取图片数 |
| `--audio-count` | 10 | 音频素材数量（不占 media 记录） |
| `--seed` | 42 | 随机种子，保证可复现 |
| `--ffmpeg` | 自动探测 | ffmpeg 可执行文件路径 |
| `--clean` | 关 | 先清空输出目录再重建 |

> `run_collect.bat` 顶部 `SET` 行可直接改 `VIDEO_COUNT/DURATION/PRIMARY_ONLY/BY_PROJECT/IMG_COUNTS/AUDIO_COUNT/EXTRA_ARGS`，
> 无需改脚本本身。

---

## 四、产物说明

输出目录结构（一个批次一个 `meta.jsonl`）：

```
<out>/
├── image/
│   ├── agent_generated/      # storyboard+character → agent_image
│   └── user_generated/       # scene → user_image
├── video/
│   └── agent_generated/      # 图生视频(带参考图) → agent_video
├── audio/
│   └── generated/            # 音频素材(参考声，不占 media 记录)
├── reference/
│   └── input_images/         # 视频引用的参考图
├── meta/meta.jsonl           # 统一元数据，每条 25 字段
└── dataset_info.json         # 数据集级说明
```

`meta.jsonl` 每条含规范规定的 **25 个顶层字段**（`uniq_id / modality / generation_type /
media_id / media_desc / media_path / format / width / height / duration / fps /
resolution / prompt / model_name / category / tags / session_id / round_index /
parent_uniq_id / audio_path / origin_media_id / origin_media_path / mask_path /
reference_images / ext_json`），不适用的字段填 `null`。

**交付边界（如实声明）**：
- 未做任何自动打标：`media_desc` 为空、`tags` 为空、`category` 为来源类型朴素值；
- `aesthetic_score / narrative_quality` 等质量分数源系统未采集，不填；
- 编辑链（`edit_image / edit_video / local_edit`）源系统无历史数据，本批次不含；
- 默认仅含源系统 `is_primary=True` 的人工筛选主视频，并用 ffmpeg 回填真实规格。
