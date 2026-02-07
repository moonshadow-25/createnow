/**
 * 媒体工具函数
 * 用于处理图片和视频的URL获取
 */

/**
 * 获取图片URL
 * @param image 图片对象
 * @param projectId 项目ID
 * @returns 图片URL
 */
export const getImageUrl = (image: any, projectId: string): string => {
  if (image?.local_path) {
    return `/api/projects/${projectId}/images/files/${image.local_path}`;
  }
  return image?.image_path || '';
};

/**
 * 获取视频URL
 * @param video 视频对象
 * @param projectId 项目ID
 * @returns 视频URL
 */
export const getVideoUrl = (video: any, projectId: string): string => {
  // 优先使用本地路径
  if (video?.local_path) {
    return `/api/projects/${projectId}/videos/files/${video.local_path}`;
  }
  // 否则使用原始路径
  if (video?.video_path) {
    // 如果是远程URL，直接使用
    if (video.video_path.startsWith('http://') || video.video_path.startsWith('https://')) {
      return video.video_path;
    }
    // 如果是本地路径，转换为API路径
    return `/api/projects/${projectId}/videos/file/${video.video_id}`;
  }
  return '';
};
