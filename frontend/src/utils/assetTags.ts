export type AssetLike = {
  asset_id?: string;
  parent_id?: string;
  tags?: string[] | null;
};

export type StoryboardLike = {
  episode_id?: string;
  character_ids?: string[] | null;
  scene_id?: string | null;
  scene_ids?: string[] | null;
  prop_ids?: string[] | null;
};

export interface UsedAssetIdsByType {
  characterIds: Set<string>;
  sceneIds: Set<string>;
  propIds: Set<string>;
}

function tagKey(tag: string): string {
  return tag.trim().toLocaleLowerCase();
}

export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  tags.forEach((tag) => {
    if (typeof tag !== 'string') return;
    const trimmed = tag.trim();
    if (!trimmed) return;
    const key = tagKey(trimmed);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(trimmed);
  });

  return result;
}

export function collectAssetTags(assets: AssetLike[]): string[] {
  return normalizeTags(assets.flatMap((asset) => asset.tags ?? []));
}

export function collectProjectAssetTags(
  characters: AssetLike[],
  scenes: AssetLike[],
  props: AssetLike[]
): string[] {
  return collectAssetTags([...characters, ...scenes, ...props]);
}

export function assetMatchesTags(asset: AssetLike, selectedTags: string[]): boolean {
  const selectedKeys = normalizeTags(selectedTags).map(tagKey);
  if (selectedKeys.length === 0) return true;

  const assetKeys = normalizeTags(asset.tags ?? []).map(tagKey);
  return selectedKeys.some((selectedKey) => assetKeys.includes(selectedKey));
}

export function filterAssetsByTags<T extends AssetLike>(assets: T[], selectedTags: string[]): T[] {
  if (normalizeTags(selectedTags).length === 0) return assets;
  return assets.filter((asset) => assetMatchesTags(asset, selectedTags));
}

export function toggleTag(tags: string[], tag: string): string[] {
  const normalizedTag = normalizeTags([tag])[0];
  if (!normalizedTag) return normalizeTags(tags);

  const current = normalizeTags(tags);
  const key = tagKey(normalizedTag);
  if (current.some((item) => tagKey(item) === key)) {
    return current.filter((item) => tagKey(item) !== key);
  }
  return [...current, normalizedTag];
}

export function getUsedAssetIdsForEpisode(
  storyboards: StoryboardLike[],
  episodeId?: string | null
): UsedAssetIdsByType {
  const characterIds = new Set<string>();
  const sceneIds = new Set<string>();
  const propIds = new Set<string>();

  if (!episodeId) return { characterIds, sceneIds, propIds };

  storyboards
    .filter((storyboard) => storyboard.episode_id === episodeId)
    .forEach((storyboard) => {
      storyboard.character_ids?.forEach((id) => characterIds.add(id));
      storyboard.scene_ids?.forEach((id) => sceneIds.add(id));
      if (storyboard.scene_id) sceneIds.add(storyboard.scene_id);
      storyboard.prop_ids?.forEach((id) => propIds.add(id));
    });

  return { characterIds, sceneIds, propIds };
}
