import { X } from 'lucide-react';
import { AssetPickerPanel, getAssetImageUrl, type AssetPickerTab } from '@/components/assets/AssetPickerPanel';
import type { CanvasAssetType, CanvasNode } from './types';

type CanvasAssetPickerDialogProps = {
  characters: any[];
  scenes: any[];
  props: any[];
  selectedNode: CanvasNode;
  onSelectAsset: (asset: any, tab: CanvasAssetType) => void;
  onClose: () => void;
};

export function CanvasAssetPickerDialog({
  characters,
  scenes,
  props,
  selectedNode,
  onSelectAsset,
  onClose,
}: CanvasAssetPickerDialogProps) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-6" onMouseDown={onClose}>
      <div className="flex max-h-[82vh] w-[920px] flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <div>
            <div className="text-lg font-semibold">选择资产主图</div>
            <div className="text-xs text-gray-500">用于静态图片、图生图、图生视频和多参生视频</div>
          </div>
          <button onClick={onClose} className="rounded-lg bg-gray-800 p-2 hover:bg-gray-700"><X size={18} /></button>
        </div>
        <AssetPickerPanel
          characters={characters}
          scenes={scenes}
          props={props}
          selectedCharacters={selectedNode.config.asset_type === 'character' && selectedNode.config.asset_id ? [selectedNode.config.asset_id] : []}
          selectedScenes={selectedNode.config.asset_type === 'scene' && selectedNode.config.asset_id ? [selectedNode.config.asset_id] : []}
          selectedProps={selectedNode.config.asset_type === 'prop' && selectedNode.config.asset_id ? [selectedNode.config.asset_id] : []}
          onToggleCharacter={() => undefined}
          onToggleScene={() => undefined}
          onToggleProp={() => undefined}
          onSelectAsset={(asset, tab) => onSelectAsset(asset, tab as AssetPickerTab)}
          showSelectedCount={false}
          showOnlyUsedFilter={false}
          showAddEmptyAction={false}
          isAssetDisabled={(asset) => !asset.image_id && !getAssetImageUrl(asset)}
          disabledReason={(asset) => (!asset.image_id && !getAssetImageUrl(asset)) ? `${asset.name || '资产'}暂无主图` : undefined}
          className="min-h-0 flex-1 p-5"
          gridClassName="grid grid-cols-5 gap-3"
        />
      </div>
    </div>
  );
}
