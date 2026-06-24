import { useState } from 'react';
import { ChevronDown, ImagePlus, SlidersHorizontal } from 'lucide-react';
import {
  IMAGE_SIZE_OPTIONS,
  VIDEO_RATIO_OPTIONS,
  VIDEO_RESOLUTION_OPTIONS,
  type CreatenowModelSuggestion,
  type CreatenowServiceType,
} from '@/store/createnowModelConfigStore';

interface ModelSelectorProps {
  type: Extract<CreatenowServiceType, 'image' | 'video'>;
  value: string;
  suggestions: CreatenowModelSuggestion[];
  onChange: (value: string) => void;
  className?: string;
}

export function CreatenowModelSelector({ type, value, suggestions, onChange, className = '' }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const selected = suggestions.find(option => option.model === value);
  const label = selected?.label || value || '选择模型';

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="w-full flex items-center justify-between gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs transition"
        title={`当前${type === 'image' ? '图片' : '视频'}模型：${value}`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={12} className="shrink-0" />
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 left-0 bg-gray-700 border border-gray-600 rounded-lg shadow-lg z-50 overflow-hidden min-w-[240px]">
          <div className="p-2 border-b border-gray-600">
            <label className="block text-xs text-gray-400 mb-1">自定义模型</label>
            <input
              type="text"
              value={value}
              onChange={event => onChange(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') setOpen(false);
                if (event.key === 'Escape') setOpen(false);
              }}
              placeholder={`输入${type === 'image' ? '图片' : '视频'}模型名`}
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              autoFocus
            />
          </div>
          <div className="py-1 max-h-64 overflow-y-auto">
            <div className="px-4 py-1 text-xs text-gray-500">预设模型</div>
            {suggestions.map(option => (
              <button
                key={`${option.label}-${option.model}`}
                type="button"
                onClick={() => { onChange(option.model); setOpen(false); }}
                className={`block w-full text-left px-4 py-1.5 text-sm hover:bg-gray-600 whitespace-nowrap ${option.model === value ? 'text-blue-400' : ''}`}
                title={option.model}
              >
                <span>{option.label}</span>
                <span className="ml-2 text-xs text-gray-400">{option.model}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface OptionSelectorProps {
  value: string;
  onChange: (value: string) => void;
  kind: 'imageSize' | 'videoRatio' | 'videoResolution';
  className?: string;
}

export function GenerationOptionSelector({ value, onChange, kind, className = '' }: OptionSelectorProps) {
  const [open, setOpen] = useState(false);
  const options = kind === 'imageSize'
    ? IMAGE_SIZE_OPTIONS
    : kind === 'videoRatio'
      ? VIDEO_RATIO_OPTIONS
      : VIDEO_RESOLUTION_OPTIONS;
  const selected = options.find(option => option.value === value);
  const icon = kind === 'imageSize' ? <ImagePlus size={13} /> : <SlidersHorizontal size={13} />;

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs transition"
      >
        {icon}
        {selected?.label || value}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 left-0 bg-gray-700 border border-gray-600 rounded-lg shadow-lg z-50 overflow-hidden">
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => { onChange(option.value); setOpen(false); }}
              className={`block w-full text-left px-4 py-1.5 text-sm hover:bg-gray-600 whitespace-nowrap ${option.value === value ? 'text-blue-400' : ''}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
