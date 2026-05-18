/** 积分换算：1 RMB = 200 积分 */
export const POINTS_PER_YUAN = 200;

/** 默认图片单价（RMB），仅当后端未返回 total_compute_spent 时用作回退 */
export const DEFAULT_IMAGE_COST = 0.5;

/** 默认视频单价（RMB/秒），仅当后端未返回时用作回退 */
export const DEFAULT_VIDEO_COST_PER_SEC = 1.0;

export function toPoints(rmb: number): number {
  return Math.round(rmb * POINTS_PER_YUAN);
}
