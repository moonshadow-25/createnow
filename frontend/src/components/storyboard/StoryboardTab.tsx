import { StoryboardDetail } from './StoryboardDetail';

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
}

export function StoryboardTab({
  projectId,
  episodes,
  characters,
  scenes,
  props,
  onUpdated,
}: StoryboardTabProps) {
  return (
    <div className="flex-1 p-6 flex flex-col h-full">
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
        />
      </div>
    </div>
  );
}
