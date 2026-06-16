import { Box, Brain, Clapperboard, Image as ImageIcon, Music, Play, Video, Zap, Library } from 'lucide-react';
import type { NodeDefinition, NodeKind } from './types';

export const NODE_WIDTH = 280;
export const NODE_HEIGHT = 174;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2.2;
export const PORT_SNAP_RADIUS = 48;
export const EDGE_HIT_STROKE = 24;
export const SIDEBAR_OPEN_DISTANCE = 48;

export const NODE_DEFINITIONS: NodeDefinition[] = [
  {
    type: 'static.image',
    label: '静态图片',
    description: '上传图片或选择资产主图',
    icon: ImageIcon,
    color: 'from-blue-500 to-cyan-500',
    inputs: [],
    outputs: [{ key: 'image', label: '图片', type: 'image' }],
    defaults: {},
  },
  {
    type: 'static.video',
    label: '静态视频',
    description: '上传本地视频作为参考',
    icon: Video,
    color: 'from-purple-500 to-fuchsia-500',
    inputs: [],
    outputs: [{ key: 'video', label: '视频', type: 'video' }],
    defaults: {},
  },
  {
    type: 'static.audio',
    label: '静态音频',
    description: '上传本地音频作为参考',
    icon: Music,
    color: 'from-emerald-500 to-teal-500',
    inputs: [],
    outputs: [{ key: 'audio', label: '音频', type: 'audio' }],
    defaults: {},
  },
  {
    type: 'material.library',
    label: 'lora',
    description: '选择lora，输出图片序列与提示词',
    icon: Library,
    color: 'from-fuchsia-500 to-purple-600',
    inputs: [],
    outputs: [{ key: 'image', label: '图片序列', type: 'image' }, { key: 'text', label: '提示词', type: 'text' }],
    defaults: { prompt: '' },
  },
  {
    type: 'gen.llm',
    label: 'LLM 文本',
    description: '调用现有项目对话接口生成文本',
    icon: Brain,
    color: 'from-amber-500 to-orange-500',
    inputs: [{ key: 'text', label: '文本', type: 'text' }],
    outputs: [{ key: 'text', label: '文本', type: 'text' }],
    defaults: { prompt: '请根据输入内容生成提示词：\n{{input}}' },
  },
  {
    type: 'gen.image',
    label: '文生图',
    description: '使用广场图片生成接口',
    icon: Zap,
    color: 'from-sky-500 to-blue-600',
    inputs: [{ key: 'text', label: '提示词', type: 'text' }],
    outputs: [{ key: 'image', label: '图片', type: 'image' }],
    defaults: { prompt: '', size: '16x9' },
  },
  {
    type: 'gen.image_edit',
    label: '图生图',
    description: '使用现有 image-edit 接口',
    icon: ImageIcon,
    color: 'from-pink-500 to-rose-500',
    inputs: [{ key: 'image', label: '参考图', type: 'image' }, { key: 'text', label: '提示词', type: 'text' }],
    outputs: [{ key: 'image', label: '图片', type: 'image' }],
    defaults: { prompt: '', size: '16x9' },
  },
  {
    type: 'director.stage',
    label: '导演台',
    description: '编排多图位置，输出有序图片序列和提示词',
    icon: Clapperboard,
    color: 'from-violet-500 to-indigo-600',
    inputs: [{ key: 'image', label: '输入图', type: 'image' }],
    outputs: [{ key: 'image', label: '图片序列', type: 'image' }, { key: 'text', label: '提示词', type: 'text' }],
    defaults: { prompt: '', size: '16x9', director_markers: [] },
  },
  {
    type: 'gen.video.text',
    label: '文生视频',
    description: '无图片参考的视频生成',
    icon: Video,
    color: 'from-red-500 to-orange-600',
    inputs: [{ key: 'text', label: '提示词', type: 'text' }],
    outputs: [{ key: 'video', label: '视频', type: 'video' }],
    defaults: { prompt: '', duration: 6, resolution: '720p', ratio: '16:9', generate_audio: true },
  },
  {
    type: 'gen.video.image',
    label: '图生视频',
    description: '图片作为参考生成视频',
    icon: Play,
    color: 'from-indigo-500 to-violet-600',
    inputs: [{ key: 'image', label: '参考图', type: 'image' }, { key: 'text', label: '提示词', type: 'text' }],
    outputs: [{ key: 'video', label: '视频', type: 'video' }],
    defaults: { prompt: '', duration: 6, resolution: '720p', ratio: '16:9', generate_audio: true },
  },
  {
    type: 'gen.video.multi',
    label: '多参生视频',
    description: '图片、视频、音频多参考生成视频',
    icon: Box,
    color: 'from-yellow-500 to-lime-500',
    inputs: [
      { key: 'image', label: '图片', type: 'image' },
      { key: 'video', label: '视频', type: 'video' },
      { key: 'audio', label: '音频', type: 'audio' },
      { key: 'text', label: '提示词', type: 'text' },
    ],
    outputs: [{ key: 'video', label: '视频', type: 'video' }],
    defaults: { prompt: '', duration: 6, resolution: '720p', ratio: '16:9', generate_audio: true },
  },
];

export const IMAGE_SIZE_OPTIONS = [
  { label: '16:9 横版', value: '16x9' },
  { label: '9:16 竖版', value: '9x16' },
  { label: '1:1 方形', value: '1x1' },
  { label: '4:3 标准', value: '4x3' },
  { label: '3:4 竖版', value: '3x4' },
];

export const VIDEO_RATIO_OPTIONS = ['16:9', '9:16', '21:9'];
export const VIDEO_RESOLUTION_OPTIONS = ['480p', '720p', '1080p'];

export function getDefinition(type: NodeKind): NodeDefinition {
  return NODE_DEFINITIONS.find((item) => item.type === type) || NODE_DEFINITIONS[0];
}
