import type { MaterialAsset } from '@/components/assets/MaterialLibraryPanel';
import type { AssetAuditState, NodeOutput, RefMedia } from './types';

export const MATERIAL_NODE_DEFAULT_PREFIX = '以下为同一人物素材参考，请保持人物身份、面部特征和妆造一致。';

function normalizeUrl(url?: string) {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  return url;
}

function imageAudit(imageId?: string, assetId?: string, status?: string): AssetAuditState | undefined {
  if (!imageId || !assetId) return undefined;
  return {
    refType: 'image',
    refKey: imageId,
    assetId,
    status: status || 'Active',
    updatedAt: new Date().toISOString(),
  };
}

export function buildMaterialNodeOutput(material: MaterialAsset, selectedLookIds: string[] = [], extraPrompt = '', fixedPrefix = MATERIAL_NODE_DEFAULT_PREFIX): { output: NodeOutput; auditState: Record<string, AssetAuditState> } {
  const media: RefMedia[] = [];
  const auditState: Record<string, AssetAuditState> = {};
  const addImage = (imageId: string | undefined, imageUrl: string | undefined, name: string, auditAssetId?: string, auditStatus?: string) => {
    if (!imageId && !imageUrl) return;
    const audit = imageAudit(imageId, auditAssetId, auditStatus);
    if (audit && imageId) auditState[`image:${imageId}`] = audit;
    media.push({
      type: 'image',
      id: imageId,
      url: normalizeUrl(imageUrl),
      name,
      sourceAssetId: material.asset_id,
      sourceAssetType: 'material',
      audit,
    });
  };

  addImage(material.front_image_id, material.front_image_url, `${material.name} 正脸`, material.front_audit_asset_id, material.front_audit_status);
  const selectedLooks = (material.looks || []).filter((look) => !selectedLookIds.length || selectedLookIds.includes(look.look_id));
  selectedLooks.forEach((look) => addImage(look.image_id, look.image_url, `${material.name} ${look.name}`, look.audit_asset_id, look.audit_status));
  (material.angle_images || []).forEach((image, index) => addImage(image.image_id, image.image_url, `${material.name} 角度${index + 1}`, image.audit_asset_id, image.audit_status));

  const lookPrompts = selectedLooks.map((look) => look.prompt).filter(Boolean).join('\n');
  const text = [fixedPrefix, `素材：${material.name}`, material.description || '', lookPrompts, extraPrompt]
    .map((item) => (item || '').trim())
    .filter(Boolean)
    .join('\n');
  const first = media[0];
  return {
    output: {
      image_id: first?.id,
      image_url: first?.url,
      media,
      text,
      raw: { kind: 'material.library', material, selectedLookIds },
    },
    auditState,
  };
}
