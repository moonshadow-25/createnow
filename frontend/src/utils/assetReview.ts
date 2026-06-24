export function isAssetUnsupportedVideoModel(model?: string | null): boolean {
  const normalized = String(model || '').trim().toLowerCase();
  if (!normalized) return false;
  return normalized === 'happyhorse-1.0-r2v' || normalized.includes('vip');
}
