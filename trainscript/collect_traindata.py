# -*- coding: utf-8 -*-
"""
collect_traindata.py —— 从 CreateNow 项目数据目录采集训练数据，整理为
《AIGC多模态生成数据交付格式规范》v1.0 目录结构 + meta.jsonl。

设计目标：可在不同部署机上双击 run_collect.bat 运行，采集/重建 traindata。
- 不依赖任何第三方库（仅标准库 + 可选系统 ffmpeg）。
- 视频真实 宽/高/时长/fps 用 ffmpeg 探测（找不到 ffmpeg 则回退用源记录字段，缺失填 null）。
- 默认只采集源系统 is_primary=True 的人工筛选主视频，并按项目分层分散（减少内容单一）。
- 支持图片/音频素材采集。

用法(命令行覆盖默认值):
    python collect_traindata.py
    python collect_traindata.py --src D:/data/projects --out D:/traindata \
        --video-count 30 --duration 15 --primary-only --by-project
"""

import argparse
import glob
import json
import os
import random
import re
import shutil
import subprocess
import sys
import traceback
from collections import Counter, defaultdict

# ----------------------------------------------------------------------------
# 1. 环境探测
# ----------------------------------------------------------------------------
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SRC = os.path.join(PROJECT_ROOT, 'data', 'projects')
DEFAULT_OUT = os.path.join(PROJECT_ROOT, 'traindata')

FFMPEG_CANDIDATES = [
    # 项目自带（不同部署布局）
    os.path.join(PROJECT_ROOT, 'backend', 'bin', 'ffmpeg.exe'),
    os.path.join(PROJECT_ROOT, 'backend', 'bin', 'ffmpeg'),
    os.path.join(PROJECT_ROOT, 'bin', 'ffmpeg.exe'),
    # PATH 中的可执行名
    'ffmpeg', 'ffmpeg.exe',
]


def find_ffmpeg(explicit=None):
    if explicit and os.path.exists(explicit):
        return explicit
    for cand in FFMPEG_CANDIDATES:
        try:
            if os.path.sep in cand or cand.endswith('.exe'):
                if os.path.exists(cand):
                    return cand
            else:  # 走 PATH
                r = subprocess.run([cand, '-version'], capture_output=True, text=True,
                                   timeout=20, creationflags=subprocess.CREATE_NO_WINDOW)
                if r.returncode == 0:
                    return cand
        except Exception:
            continue
    return None


def probe_video(ffmpeg, path):
    """返回 (width,height,duration_sec,fps) 或 None(取不到)。"""
    try:
        flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        r = subprocess.run([ffmpeg, '-i', path], capture_output=True, text=True,
                           timeout=90, creationflags=flags)
        info = r.stderr
        wh = re.search(r'(\d{2,5})x(\d{2,5})', info)
        dur = re.search(r'Duration:\s*(\d+):(\d+):(\d+\.\d+)', info)
        fps = re.search(r'(\d+(?:\.\d+)?)\s*fps', info)
        w = int(wh.group(1)) if wh else None
        h = int(wh.group(2)) if wh else None
        d = (int(dur.group(1)) * 3600 + int(dur.group(2)) * 60 + float(dur.group(3))) if dur else None
        f = float(fps.group(1)) if fps else None
        return w, h, round(d, 1) if d else None, int(round(f)) if f else None
    except Exception:
        return None, None, None, None


def _proj_of(path):
    # path: <src>/<project_id>/videos/<id>.json  -> project_id
    return path.replace('\\', '/').split('/')[-3]


# ----------------------------------------------------------------------------
# 2. 采集逻辑
# ----------------------------------------------------------------------------
class Collector:
    def __init__(self, args, ffmpeg):
        self.src = args.src
        self.out = args.out
        self.ffmpeg = ffmpeg
        self.args = args
        self.records = []

    # ---- 工具 ----
    def _copy(self, src, rel):
        dst = os.path.join(self.out, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
        return rel

    def _find_img(self, proj, iid, atype):
        for ext in ('.png', '.jpg', '.jpeg'):
            p = os.path.join(self.src, proj, 'images', 'files', atype, iid + ext)
            if os.path.exists(p):
                return p
        return None

    def _project_title(self, proj):
        mp = os.path.join(self.src, proj, 'metadata.json')
        if not os.path.exists(mp):
            return None
        try:
            md = json.load(open(mp, encoding='utf-8'))
            return md.get('title') or md.get('project_name') or md.get('name')
        except Exception:
            return None

    # ---- 图片采集 ----
    def collect_images(self, atype, dst_sub, gen_type, category):
        """图片数量 attr.image_count[atype]，确定性随机取样，只取有物理文件且有尺寸的。"""
        rng = random.Random(self.args.seed)
        good = []
        for f in glob.glob(os.path.join(self.src, '*', 'images', '*.json')):
            try:
                d = json.load(open(f, encoding='utf-8'))
            except Exception:
                continue
            if d.get('asset_type') != atype:
                continue
            proj = _proj_of(f)
            p = self._find_img(proj, d.get('image_id', ''), atype)
            if p and d.get('width') and d.get('height'):
                good.append((f, d, p))
        rng.shuffle(good)
        n = self.args.image_count.get(atype, 10)
        for f, d, srcp in good[:n]:
            proj = _proj_of(f)
            media_id = d.get('image_id', '') + os.path.splitext(srcp)[1]
            rel = 'image/%s/%s' % (dst_sub, media_id)
            self._copy(srcp, rel)
            self.records.append({
                'uniq_id': 'traindata_%05d' % (len(self.records) + 1),
                'modality': 'image',
                'generation_type': gen_type,
                'media_id': media_id,
                'media_desc': '',
                'media_path': rel,
                'format': media_id.rsplit('.', 1)[-1],
                'width': d.get('width'),
                'height': d.get('height'),
                'duration': None, 'fps': None, 'resolution': None,
                'prompt': d.get('prompt', ''),
                'model_name': d.get('model'),
                'category': category,
                'tags': [],
                'session_id': None, 'round_index': None, 'parent_uniq_id': None,
                'audio_path': None,
                'origin_media_id': None, 'origin_media_path': None, 'mask_path': None,
                'reference_images': [],
                'ext_json': {'source_system': 'createnow', 'asset_type': atype,
                             'original_created_at': d.get('created_at')},
            })

    # ---- 视频采集 ----
    def collect_videos(self):
        """主视频采样：is_primary + 时长过滤 + 按项目分层分散。"""
        rng = random.Random(self.args.seed)
        # 收集候选（按项目）
        by_proj = defaultdict(list)
        for f in glob.glob(os.path.join(self.src, '*', 'videos', '*.json')):
            try:
                d = json.load(open(f, encoding='utf-8'))
            except Exception:
                continue
            if d.get('duration') != self.args.duration:
                continue
            if self.args.primary_only and d.get('is_primary') is not True:
                continue
            if not d.get('reference_media'):
                continue
            if d.get('status') != 'completed':
                continue
            proj = _proj_of(f)
            vid = d.get('video_id', '')
            p = os.path.join(self.src, proj, 'videos', 'files', vid + '.mp4')
            if os.path.exists(p):
                by_proj[proj].append((f, d, p))

        # 分配
        alloc = {}
        if self.args.by_project:
            # 非主力项目每项目 floor 分配，主力项目(候选最多)兜底补满
            for proj, cand in by_proj.items():
                per = max(1, self.args.video_count // len(by_proj)) if len(by_proj) else 1
                alloc[proj] = min(per, len(cand))
            dominant = max(by_proj, key=lambda p: len(by_proj[p])) if by_proj else None
            total_others = sum(alloc[p] for p in alloc if p != dominant)
            if dominant:
                alloc[dominant] = self.args.video_count - total_others
                if alloc[dominant] > len(by_proj[dominant]):
                    alloc[dominant] = len(by_proj[dominant])
        else:
            # 全局随机
            allcand = [x for v in by_proj.values() for x in v]
            rng.shuffle(allcand)
            for f, d, p in allcand[:self.args.video_count]:
                self._emit_video(_proj_of(f), d, p)
            return

        selected = []
        for proj, n in alloc.items():
            if n <= 0:
                continue
            cand = list(by_proj[proj])
            rng.shuffle(cand)
            for f, d, p in cand[:n]:
                selected.append((proj, d, p))
        rng.shuffle(selected)  # 打散顺序
        for proj, d, p in selected:
            self._emit_video(proj, d, p)

    def _emit_video(self, proj, d, srcp):
        vid = d.get('video_id', '')
        media_id = vid + '.mp4'
        rel = 'video/agent_generated/' + media_id
        self._copy(srcp, rel)
        # 参考图
        refs = []
        for r in (d.get('reference_media') or []):
            if not isinstance(r, dict):
                continue
            m = re.search(r'/images/files/([^/]+)/([^/]+)\.(png|jpg|jpeg)', r.get('url', ''))
            if not m:
                continue
            at, iid, ext = m.groups()
            p = os.path.join(self.src, proj, 'images', 'files', at, iid + '.' + ext)
            if os.path.exists(p):
                ref_rel = 'reference/input_images/%s_%s.%s' % (vid[:8], iid, ext)
                self._copy(p, ref_rel)
                refs.append(ref_rel)
        # 探测真实规格
        w = h = du = fps = None
        if self.ffmpeg:
            w, h, du, fps = probe_video(self.ffmpeg, os.path.join(self.out, rel))
        rec = {
            'uniq_id': 'traindata_%05d' % (len(self.records) + 1),
            'modality': 'video',
            'generation_type': 'agent_video',
            'media_id': media_id,
            'media_desc': '',
            'media_path': rel,
            'format': 'mp4',
            'width': w,
            'height': h,
            'resolution': [w, h] if w else None,
            'duration': du if du else d.get('duration'),
            'fps': fps,
            'prompt': d.get('prompt', ''),
            'model_name': d.get('model'),
            'category': '叙事片段',
            'tags': [],
            'session_id': None, 'round_index': None, 'parent_uniq_id': None,
            'audio_path': None,
            'origin_media_id': None, 'origin_media_path': None, 'mask_path': None,
            'reference_images': refs,
            'ext_json': {
                'source_system': 'createnow',
                'task_id': d.get('task_id'),
                'project_id': proj,
                'project_title': self._project_title(proj),
                'is_primary': bool(d.get('is_primary')),
                'original_created_at': d.get('created_at'),
                'n_refs': len(refs),
            },
        }
        self.records.append(rec)

    # ---- 音频素材（可选，不占 media 记录） ----
    def collect_audio(self):
        rng = random.Random(self.args.seed)
        af = glob.glob(os.path.join(self.src, '*', 'audios', '*.json'))
        rng.shuffle(af)
        got = []
        for f in af[:self.args.audio_count]:
            try:
                d = json.load(open(f, encoding='utf-8'))
            except Exception:
                continue
            proj = _proj_of(f)
            aid = d.get('audio_id', '')
            fmt = d.get('format', '')
            name = '%s.%s' % (aid, fmt) if fmt else aid
            srcp = os.path.join(self.src, proj, 'audios', 'files', name)
            if not os.path.exists(srcp):
                for ex in ('.wav', '.mp3'):
                    c = os.path.join(self.src, proj, 'audios', 'files', aid + ex)
                    if os.path.exists(c):
                        srcp, name = c, os.path.basename(c)
                        break
            if os.path.exists(srcp):
                rel = 'audio/generated/%s' % name
                self._copy(srcp, rel)
                got.append({'rel': rel, 'format': fmt, 'created_at': d.get('created_at')})
        return got

    # ---- 写出 meta + dataset_info ----
    def write_meta(self, audio_files):
        os.makedirs(os.path.join(self.out, 'meta'), exist_ok=True)
        with open(os.path.join(self.out, 'meta', 'meta.jsonl'), 'w', encoding='utf-8') as fh:
            for rec in self.records:
                fh.write(json.dumps(rec, ensure_ascii=False) + '\n')

        vids = [r for r in self.records if r['modality'] == 'video']
        vproj = Counter(r['ext_json'].get('project_id') for r in vids)
        info = {
            'dataset_name': 'createnow_traindata',
            'version': 'v1.0',
            'created_at': '2026-08-12',
            'collection_script': os.path.basename(__file__),
            'generation_types': sorted({r['generation_type'] for r in self.records}),
            'num_records': len(self.records),
            'num_images': sum(1 for r in self.records if r['modality'] == 'image'),
            'num_videos': len(vids),
            'video_duration_policy': '时长约 %s 秒（ffmpeg 探测/源字段）' % self.args.duration,
            'video_quality_policy': ('仅 is_primary=True 主视频' if self.args.primary_only else '不限主视频'),
            'video_project_distribution': {p.split('-')[0][:8]: n for p, n in vproj.items()},
            'video_ffmpeg_detected': bool(self.ffmpeg),
            'notes': [
                '按《AIGC多模态生成数据交付格式规范》整理，25字段/条。',
                '视频 width/height/resolution/duration/fps 用 ffmpeg 探测回填；无 ffmpeg 时 width/height/resolution/fps 为 null。',
                'media_desc/tags 未打标；category 为来源类型朴素值；aesthetic_score 等源系统未采集，null。',
                '音频(参考声)共 %d 条，复制于 audio/generated/，不占 media 记录(modality 仅 image/video)。' % len(audio_files),
                '编辑链(edit_image/edit_video/local_edit)源系统无历史数据，本批次不含。',
                '本脚本仅做物理复制与字段搬运，未做任何自动打标。',
            ],
            'audio_reference_files': audio_files,
        }
        with open(os.path.join(self.out, 'dataset_info.json'), 'w', encoding='utf-8') as fh:
            json.dump(info, fh, ensure_ascii=False, indent=2)
        return info


# ----------------------------------------------------------------------------
# 3. CLI
# ----------------------------------------------------------------------------
def parse_args(argv=None):
    p = argparse.ArgumentParser(description='CreateNow 训练数据采集/整理脚本')
    p.add_argument('--src', default=DEFAULT_SRC, help='源数据 projects 根目录')
    p.add_argument('--out', default=DEFAULT_OUT, help='输出目录(traindata)')
    p.add_argument('--video-count', type=int, default=30, help='视频数量')
    p.add_argument('--duration', type=int, default=15, help='只取该时长的视频(秒)')
    p.add_argument('--primary-only', dest='primary_only', action='store_true',
                   help='只取 is_primary=True 的主视频(默认)')
    p.add_argument('--no-primary-only', dest='primary_only', action='store_false',
                   help='不限制主视频')
    p.set_defaults(primary_only=True)
    p.add_argument('--by-project', dest='by_project', action='store_true',
                   help='按项目分层分散采样(默认)')
    p.add_argument('--global-random', dest='by_project', action='store_false',
                   help='全局随机采样(可能集中在少数项目)')
    p.set_defaults(by_project=True)
    p.add_argument('--image-count', default='10,10,10',
                   help='storyboard,character,scene 图片数量(逗号分隔)')
    p.add_argument('--audio-count', type=int, default=10, help='音频素材数量(默认10)')
    p.add_argument('--seed', type=int, default=42, help='随机种子(确定性可复现)')
    p.add_argument('--ffmpeg', default=None, help='ffmpeg/ffprobe 可执行文件路径(否则自动探测)')
    p.add_argument('--clean', action='store_true', help='先清空输出目录再重建')
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    if not os.path.isdir(args.src):
        print('[错误] 找不到源数据目录：%s' % args.src, file=sys.stderr)
        print('        请确认部署机上项目数据位于该路径，或用 --src 指定。', file=sys.stderr)
        return 1

    ic = [int(x.strip()) for x in args.image_count.split(',')]
    ic = (ic + [10, 10, 10])[:3]
    args.image_count = dict(zip(('storyboard', 'character', 'scene'), ic))

    ffmpeg = find_ffmpeg(args.ffmpeg)
    if ffmpeg:
        print('[信息] 使用 ffmpeg：%s' % ffmpeg)
    else:
        print('[警告] 未找到 ffmpeg，视频 width/height/resolution/fps 将可能为 null。'
              '可安装 ffmpeg 到 PATH 或用 --ffmpeg 指定。')

    if args.clean and os.path.isdir(args.out):
        shutil.rmtree(args.out)
    os.makedirs(args.out, exist_ok=True)

    c = Collector(args, ffmpeg)
    c.collect_images('storyboard', 'agent_generated', 'agent_image', '分镜图')
    c.collect_images('character', 'agent_generated', 'agent_image', '角色')
    c.collect_images('scene', 'user_generated', 'user_image', '场景')
    c.collect_videos()
    audio = c.collect_audio()
    info = c.write_meta(audio)

    print('完成：media 记录 %d 条 (image %d, video %d)，项目数 %d' % (
        info['num_records'], info['num_images'], info['num_videos'],
        len(info['video_project_distribution'])))
    print('输出目录：%s\n' % args.out + '  - meta/meta.jsonl\n'
          '  - dataset_info.json\n'
          '  - image/ video/ audio/ reference/')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
