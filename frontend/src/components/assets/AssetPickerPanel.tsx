import { useMemo, useState } from 'react';
import { Check, Plus, Search, ZoomIn } from 'lucide-react';
import { ImagePreviewModal } from '@/components/common/ImagePreviewModal';
import { collectProjectAssetTags, filterAssetsByTags, toggleTag } from '@/utils/assetTags';
import type { UsedAssetIdsByType } from '@/utils/assetTags';

export type AssetPickerTab = 'character' | 'scene' | 'prop';

type AssetColor = 'blue' | 'green' | 'purple';

export interface AssetPickerPanelProps {
  characters: any[];
  scenes: any[];
  props: any[];
  selectedCharacters: string[];
  selectedScenes: string[];
  selectedProps: string[];
  onToggleCharacter: (id: string, asset: any) => void;
  onToggleScene: (id: string, asset: any) => void;
  onToggleProp: (id: string, asset: any) => void;
  showSelectedCount?: boolean;
  onSelectAsset?: (asset: any, tab: AssetPickerTab) => void;
  usedAssetIdsByType?: UsedAssetIdsByType;
  showOnlyUsedFilter?: boolean;
  showAddEmptyAction?: boolean;
  onAddEmptyAsset?: () => void;
  isAssetDisabled?: (asset: any, tab: AssetPickerTab) => boolean;
  disabledReason?: (asset: any, tab: AssetPickerTab) => string | undefined;
  className?: string;
  gridClassName?: string;
}

export function getAssetImageUrl(asset: any): string {
  return asset?.primary_image_url || asset?.image_url || '';
}

export function getAssetThumbnailUrl(asset: any): string {
  const url = getAssetImageUrl(asset);
  return url ? url.replace('/images/files/', '/thumbnails/') : '';
}

interface AssetGridItemProps {
  asset: any;
  selected: boolean;
  disabled: boolean;
  disabledTitle?: string;
  onToggle: () => void;
  onPreview: () => void;
  color: AssetColor;
}

function AssetGridItem({ asset, selected, disabled, disabledTitle, onToggle, onPreview, color }: AssetGridItemProps) {
  const borderColor = {
    blue: selected ? 'border-blue-400' : 'border-transparent hover:border-blue-600',
    green: selected ? 'border-green-400' : 'border-transparent hover:border-green-600',
    purple: selected ? 'border-purple-400' : 'border-transparent hover:border-purple-600',
  }[color];
  const checkColor = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    purple: 'bg-purple-500',
  }[color];

  const thumbnailUrl = getAssetThumbnailUrl(asset);
  const imageUrl = getAssetImageUrl(asset);
  const initial = (asset.name || '?')[0].toUpperCase();

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => { if (!disabled) onToggle(); }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      className={`relative group w-24 flex-shrink-0 flex flex-col items-center gap-1 p-2 rounded-lg bg-gray-700 hover:bg-gray-600 border-2 transition text-left ${disabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'} ${borderColor}`}
      title={disabledTitle || asset.name}
    >
      <div className="relative w-16 h-16 rounded overflow-hidden bg-gray-600 flex items-center justify-center flex-shrink-0">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={asset.name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <span className="text-2xl font-bold text-gray-400">{initial}</span>
        )}
        {imageUrl && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onPreview();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onPreview();
              }
            }}
            className="absolute inset-0 m-auto hidden h-8 w-8 items-center justify-center rounded-full bg-black/65 text-white transition hover:bg-black/80 group-hover:flex group-focus-within:flex"
            title="查看大图"
            aria-label={`查看${asset.name || '资产'}大图`}
          >
            <ZoomIn size={16} />
          </span>
        )}
      </div>
      <span className="text-xs text-center truncate w-full text-gray-200">{asset.name}</span>
      {selected && (
        <div className={`absolute top-1 right-1 w-5 h-5 rounded-full ${checkColor} flex items-center justify-center`}>
          <Check size={12} className="text-white" />
        </div>
      )}
    </div>
  );
}

export function AssetPickerPanel({
  characters,
  scenes,
  props,
  selectedCharacters,
  selectedScenes,
  selectedProps,
  onToggleCharacter,
  onToggleScene,
  onToggleProp,
  showSelectedCount = true,
  onSelectAsset,
  usedAssetIdsByType,
  showOnlyUsedFilter = true,
  showAddEmptyAction = true,
  onAddEmptyAsset,
  isAssetDisabled,
  disabledReason,
  className = '',
  gridClassName = 'flex flex-wrap gap-3 p-1',
}: AssetPickerPanelProps) {
  const [activeTab, setActiveTab] = useState<AssetPickerTab>('character');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyUsedInEpisode, setOnlyUsedInEpisode] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<any | null>(null);

  const tabs: { key: AssetPickerTab; label: string; count: number; selectedCount: number }[] = [
    { key: 'character', label: '角色', count: characters.length, selectedCount: selectedCharacters.length },
    { key: 'scene', label: '场景', count: scenes.length, selectedCount: selectedScenes.length },
    { key: 'prop', label: '道具', count: props.length, selectedCount: selectedProps.length },
  ];

  const tabColor: Record<AssetPickerTab, AssetColor> = {
    character: 'blue',
    scene: 'green',
    prop: 'purple',
  };
  const tabActiveClass: Record<AssetPickerTab, string> = {
    character: 'border-blue-500 text-blue-400',
    scene: 'border-green-500 text-green-400',
    prop: 'border-purple-500 text-purple-400',
  };

  const allTags = useMemo(() => collectProjectAssetTags(characters, scenes, props), [characters, scenes, props]);
  const baseAssets = activeTab === 'character' ? characters : activeTab === 'scene' ? scenes : props;
  const usedIds = activeTab === 'character'
    ? usedAssetIdsByType?.characterIds
    : activeTab === 'scene'
      ? usedAssetIdsByType?.sceneIds
      : usedAssetIdsByType?.propIds;
  const usedFilteredAssets = showOnlyUsedFilter && onlyUsedInEpisode && usedIds
    ? baseAssets.filter((asset) => usedIds.has(asset.asset_id))
    : baseAssets;
  const tagFilteredAssets = filterAssetsByTags(usedFilteredAssets, selectedTags);
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const currentAssets = normalizedSearchQuery
    ? tagFilteredAssets.filter((asset) => (asset.name || '').toLocaleLowerCase().includes(normalizedSearchQuery))
    : tagFilteredAssets;
  const isSelected = (id: string) =>
    activeTab === 'character' ? selectedCharacters.includes(id)
    : activeTab === 'scene' ? selectedScenes.includes(id)
    : selectedProps.includes(id);
  const onToggle = (asset: any) => {
    if (onSelectAsset) {
      onSelectAsset(asset, activeTab);
      return;
    }
    activeTab === 'character' ? onToggleCharacter(asset.asset_id, asset)
    : activeTab === 'scene' ? onToggleScene(asset.asset_id, asset)
    : onToggleProp(asset.asset_id, asset);
  };

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="flex border-b border-gray-700 mb-3">
        {tabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-2 text-sm font-medium border-b-2 transition ${
              activeTab === tab.key ? tabActiveClass[tab.key] : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label}
            <span className="ml-1.5 text-xs">
              ({tab.count}
              {showSelectedCount && tab.selectedCount > 0 && <span className="text-yellow-400">·已选{tab.selectedCount}</span>}
              )
            </span>
          </button>
        ))}
      </div>

      {(baseAssets.length > 0 || allTags.length > 0 || (showOnlyUsedFilter && usedAssetIdsByType)) && (
        <div className="mb-3 space-y-2 rounded-lg bg-gray-700/50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            {showOnlyUsedFilter && usedAssetIdsByType && (
              <button
                type="button"
                onClick={() => setOnlyUsedInEpisode((prev) => !prev)}
                className={`rounded-full px-3 py-1 text-xs transition ${
                  onlyUsedInEpisode
                    ? 'bg-yellow-600 text-white'
                    : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                }`}
              >
                本集使用
              </button>
            )}
            {(selectedTags.length > 0 || searchQuery) && (
              <button
                type="button"
                onClick={() => {
                  setSelectedTags([]);
                  setSearchQuery('');
                }}
                className="text-xs text-gray-400 hover:text-white"
              >
                清空筛选
              </button>
            )}
            <span className="text-xs text-gray-500">当前显示 {currentAssets.length} 个</span>
          </div>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="按名称搜索资产"
              className="w-full rounded-lg border border-gray-600 bg-gray-800 py-1.5 pl-8 pr-3 text-sm text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
          {allTags.length > 0 && (
            <div className="flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
              {allTags.map((tag) => {
                const selected = selectedTags.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase());
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setSelectedTags((prev) => toggleTag(prev, tag))}
                    className={`rounded-full px-2 py-0.5 text-xs transition ${
                      selected
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {currentAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500">
            <span>暂无{tabs.find(t => t.key === activeTab)?.label}</span>
            {showAddEmptyAction && onAddEmptyAsset && (
              <button
                type="button"
                onClick={onAddEmptyAsset}
                className="mt-2 text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                <Plus size={12} />添加一个
              </button>
            )}
          </div>
        ) : (
          <div className={gridClassName}>
            {currentAssets.map(asset => {
              const disabled = isAssetDisabled?.(asset, activeTab) ?? false;
              return (
                <AssetGridItem
                  key={asset.asset_id}
                  asset={asset}
                  selected={isSelected(asset.asset_id)}
                  disabled={disabled}
                  disabledTitle={disabledReason?.(asset, activeTab)}
                  onToggle={() => onToggle(asset)}
                  onPreview={() => setPreviewAsset(asset)}
                  color={tabColor[activeTab]}
                />
              );
            })}
          </div>
        )}
      </div>

      {previewAsset && (
        <ImagePreviewModal
          imageUrl={getAssetImageUrl(previewAsset)}
          title={previewAsset.name || '资产大图'}
          alt={previewAsset.name || '资产大图'}
          onClose={() => setPreviewAsset(null)}
        />
      )}
    </div>
  );
}
