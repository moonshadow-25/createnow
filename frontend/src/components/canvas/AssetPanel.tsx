import { useState } from 'react';
import { ChevronRight, ChevronDown, PanelLeftClose, PanelLeft, User, Package, MapPin, Film, Sparkles, LucideIcon } from 'lucide-react';
import { useAssetStore } from '@/store/assetStore';
import { useCanvasStore } from '@/store/canvasStore';
import type { CanvasElementData } from '@/types/canvas';

interface AssetPanelProps {
  isOpen: boolean;
  onToggle: () => void;
}

type FolderType = 'character' | 'prop' | 'scene' | 'storyboard' | 'canvas_element';

interface FolderConfig {
  type: FolderType;
  label: string;
  icon: LucideIcon;
}

const FOLDERS: FolderConfig[] = [
  { type: 'character', label: '角色', icon: User },
  { type: 'prop', label: '道具', icon: Package },
  { type: 'scene', label: '场景', icon: MapPin },
  { type: 'storyboard', label: '分镜', icon: Film },
  { type: 'canvas_element', label: '融合', icon: Sparkles },
];

export function AssetPanel({ isOpen, onToggle }: AssetPanelProps) {
  const { characters, scenes, props, storyboards } = useAssetStore();
  const { canvasElements } = useCanvasStore();

  const [expandedFolders, setExpandedFolders] = useState<Set<FolderType>>(new Set());
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());

  // 获取文件夹中的资产
  const getFolderAssets = (type: FolderType): CanvasElementData[] => {
    switch (type) {
      case 'character':
        return characters.map(char => ({
          id: char.asset_id,
          type: 'character',
          name: char.name,
          imageUrl: char.primary_image_url || '',
          data: char
        }));
      case 'scene':
        return scenes.map(scene => ({
          id: scene.asset_id,
          type: 'scene',
          name: scene.name,
          imageUrl: scene.primary_image_url || '',
          data: scene
        }));
      case 'prop':
        return props.map(prop => ({
          id: prop.asset_id,
          type: 'prop',
          name: prop.name,
          imageUrl: prop.primary_image_url || '',
          data: prop
        }));
      case 'storyboard':
        return storyboards
          .sort((a, b) => a.sequence - b.sequence)  // 按序号排序
          .map(storyboard => ({
            id: storyboard.asset_id,
            type: 'storyboard',
            name: storyboard.description || `分镜 ${storyboard.sequence}`,
            imageUrl: storyboard.primary_image_url || '',
            data: storyboard
          }));
      case 'canvas_element':
        return Object.values(canvasElements);
      default:
        return [];
    }
  };

  // 切换文件夹展开状态
  const toggleFolder = (type: FolderType) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(type)) {
        newSet.delete(type);
      } else {
        newSet.add(type);
      }
      return newSet;
    });
  };

  // 处理资产点击（多选）
  const handleAssetClick = (e: React.MouseEvent, assetId: string) => {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd + 点击：切换选中状态
      setSelectedAssets(prev => {
        const newSet = new Set(prev);
        if (newSet.has(assetId)) {
          newSet.delete(assetId);
        } else {
          newSet.add(assetId);
        }
        return newSet;
      });
    } else {
      // 普通点击：单选
      setSelectedAssets(new Set([assetId]));
    }
  };

  // 处理资产拖拽开始
  const handleAssetDragStart = (e: React.DragEvent, assetId: string) => {
    // 如果拖拽的资产在选中列表中，拖拽所有选中的资产
    const assetsToDrag = selectedAssets.has(assetId)
      ? Array.from(selectedAssets)
      : [assetId];

    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'assets',
      assetIds: assetsToDrag
    }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  // 处理文件夹拖拽开始
  const handleFolderDragStart = (e: React.DragEvent, folderType: FolderType) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'folder',
      folderType: folderType
    }));
    e.dataTransfer.effectAllowed = 'copy';
    e.stopPropagation();
  };

  // 收起状态：只显示展开按钮
  if (!isOpen) {
    return (
      <div className="w-12 bg-gray-800 border-r border-gray-700 flex flex-col items-center py-4">
        <button
          onClick={onToggle}
          className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-400"
          title="展开资产面板"
        >
          <PanelLeft size={20} />
        </button>
      </div>
    );
  }

  // 展开状态：显示完整面板
  return (
    <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <h3 className="text-sm font-semibold text-gray-300">资产库</h3>
        <button
          onClick={onToggle}
          className="p-1 hover:bg-gray-700 rounded transition-colors"
          title="收起资产面板"
        >
          <PanelLeftClose size={18} className="text-gray-400" />
        </button>
      </div>

      {/* 文件夹列表 */}
      <div className="flex-1 overflow-y-auto">
        {FOLDERS.map(folder => {
          const assets = getFolderAssets(folder.type);
          const isExpanded = expandedFolders.has(folder.type);
          const Icon = folder.icon;

          return (
            <div key={folder.type} className="border-b border-gray-700">
              {/* 文件夹标题 */}
              <div
                className="flex items-center gap-2 px-4 py-2 hover:bg-gray-700 cursor-pointer select-none"
                draggable
                onDragStart={(e) => handleFolderDragStart(e, folder.type)}
              >
                <button
                  onClick={() => toggleFolder(folder.type)}
                  className="flex items-center gap-2 flex-1 text-left"
                >
                  {isExpanded ? (
                    <ChevronDown size={16} className="text-gray-400" />
                  ) : (
                    <ChevronRight size={16} className="text-gray-400" />
                  )}
                  <Icon size={16} className="text-gray-400" />
                  <span className="text-sm text-gray-300">{folder.label}</span>
                  <span className="text-xs text-gray-500">({assets.length})</span>
                </button>
              </div>

              {/* 文件夹内容 */}
              {isExpanded && (
                <div className="bg-gray-850">
                  {assets.length === 0 ? (
                    <div className="px-4 py-2 text-xs text-gray-500 text-center">
                      暂无{folder.label}
                    </div>
                  ) : (
                    assets.map(asset => (
                      <div
                        key={asset.id}
                        draggable
                        onDragStart={(e) => handleAssetDragStart(e, asset.id)}
                        onClick={(e) => handleAssetClick(e, asset.id)}
                        className={`flex items-center gap-2 px-6 py-2 hover:bg-gray-700 cursor-pointer transition-colors ${
                          selectedAssets.has(asset.id) ? 'bg-blue-900/30' : ''
                        }`}
                        title={asset.name}
                      >
                        {/* 缩略图 */}
                        <div className="w-8 h-8 bg-gray-900 rounded overflow-hidden flex-shrink-0">
                          {asset.imageUrl ? (
                            <img
                              src={asset.imageUrl.replace('/images/files/', '/thumbnails/')}
                              alt={asset.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-600">
                              <Icon size={14} />
                            </div>
                          )}
                        </div>
                        {/* 名称 */}
                        <span className="text-xs text-gray-300 truncate flex-1">
                          {asset.name}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 底部提示 */}
      <div className="px-4 py-3 border-t border-gray-700 text-xs text-gray-500">
        <p>拖拽元素或文件夹到画布</p>
        <p className="mt-1">Ctrl+点击多选</p>
      </div>
    </div>
  );
}
