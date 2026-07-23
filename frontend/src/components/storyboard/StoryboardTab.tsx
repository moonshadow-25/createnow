import { StoryboardDetail } from './StoryboardDetail';
import { useThemeStore } from '@/store/themeStore';

interface Episode {
  episode_id: string;
  name: string;
  script_content: string;
  [key: string]: any;
}

interface Character {
  asset_id: string;
  name: string;
  [key: string]: any;
}

interface Scene {
  asset_id: string;
  name: string;
  [key: string]: any;
}

interface Prop {
  asset_id: string;
  name: string;
  [key: string]: any;
}

interface StoryboardTabProps {
  projectId: string;
  episodes: Episode[];
  characters: Character[];
  scenes: Scene[];
  props: Prop[];
  onUpdated: () => void;
  multimodalReference?: boolean;
  showAssetSubmit?: boolean;
  onStoryboardsReady?: () => void;
}

export function StoryboardTab({
  projectId,
  episodes,
  characters,
  scenes,
  props,
  onUpdated,
  multimodalReference = false,
  showAssetSubmit = false,
  onStoryboardsReady,
}: StoryboardTabProps) {
  const appearanceMode = useThemeStore(s => s.appearanceMode);
  return (
    <div className={`flex-1 p-6 flex flex-col h-full ${appearanceMode === 'vip' ? 'px-3 py-3' : ''}`}>
      <div className="mb-4 flex-shrink-0">
        <h2 className="text-xl font-semibold mb-2">剧本分镜管理</h2>
        <p className="text-sm text-gray-400">选择剧集，管理分镜，生成分镜图和视频</p>
      </div>
      <div className="flex-1 min-h-0">
        <StoryboardDetail
          projectId={projectId}
          episodes={episodes}
          characters={characters}
          scenes={scenes}
          props={props}
          onUpdated={onUpdated}
          multimodalReference={multimodalReference}
          showAssetSubmit={showAssetSubmit}
          onStoryboardsReady={onStoryboardsReady}
        />
      </div>
    </div>
  );
}
