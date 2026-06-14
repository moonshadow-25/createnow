import { Image as ImageIcon, X } from 'lucide-react';
import { AssetPickerPanel, getAssetImageUrl, type AssetPickerTab } from '@/components/assets/AssetPickerPanel';
import type { CanvasAssetType, CanvasNode } from './types';

type CanvasAssetPickerDialogProps = {
  assetTab: CanvasAssetType;
  characters: any[];
  scenes: any[];
  props: any[];
  storyboards: any[];
  selectedNode: CanvasNode;
  onAssetTabChange: (tab: CanvasAssetType) => void;
  onSelectAsset: (asset: any, tab: CanvasAssetType) => void;
  onClose: () => void;
};

export function CanvasAssetPickerDialog({
  assetTab,
  characters,
  scenes,
  props,
  storyboards,
  selectedNode,
  onAssetTabChange,
  onSelectAsset,
  onClose,
}: CanvasAssetPickerDialogProps) {
  const assetGroups = { character: characters, scene: scenes, prop: props, storyboard: storyboards };

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
        <div className="flex border-b border-gray-800 px-5">
          {(['character', 'scene', 'prop', 'storyboard'] as CanvasAssetType[]).map((tab) => (
            <button key={tab} onClick={() => onAssetTabChange(tab)} className={`border-b-2 px-4 py-3 text-sm ${assetTab === tab ? 'border-blue-400 text-blue-300' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
              {tab === 'character' ? '角色' : tab === 'scene' ? '场景' : tab === 'prop' ? '道具' : '分镜'} ({assetGroups[tab].length})
            </button>
          ))}
        </div>
        {assetTab === 'storyboard' ? (
          <div className="grid min-h-0 flex-1 grid-cols-5 gap-3 overflow-y-auto p-5">
            {storyboards.map((asset: any) => {
              const imageUrl = getAssetImageUrl(asset);
              return (
                <button key={asset.asset_id} onClick={() => onSelectAsset(asset, 'storyboard')} className="rounded-lg border border-gray-700 bg-gray-800 p-2 text-left hover:border-blue-400">
                  <div className="mb-2 flex h-28 items-center justify-center overflow-hidden rounded bg-gray-950">
                    {imageUrl ? <img src={imageUrl} alt={asset.name} draggable={false} className="h-full w-full object-contain" /> : <ImageIcon className="text-gray-600" />}
                  </div>
                  <div className="truncate text-sm text-gray-200">{asset.name || asset.description || asset.asset_id}</div>
                  <div className="truncate text-xs text-gray-500">{asset.image_id ? '有主图' : '暂无主图'}</div>
                </button>
              );
            })}
            {!storyboards.length && <div className="col-span-5 py-12 text-center text-gray-500">暂无分镜</div>}
          </div>
        ) : (
          <AssetPickerPanel
            characters={characters}
            scenes={scenes}
            props={props}
            selectedCharacters={assetTab === 'character' && selectedNode.config.asset_id ? [selectedNode.config.asset_id] : []}
            selectedScenes={assetTab === 'scene' && selectedNode.config.asset_id ? [selectedNode.config.asset_id] : []}
            selectedProps={assetTab === 'prop' && selectedNode.config.asset_id ? [selectedNode.config.asset_id] : []}
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
        )}
      </div>
    </div>
  );
}
