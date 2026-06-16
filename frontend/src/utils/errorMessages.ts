/**
 * 视频生成 API 错误消息翻译映射。
 * 关键词均为不含变量的固定片段，用 includes 子串匹配。
 * 顺序按出现频率排列，命中第一个即返回。
 */

interface ErrorTranslation {
  keyword: string;
  cn: string;
}

const ERROR_TRANSLATIONS: ErrorTranslation[] = [
  { keyword: 'input image may contain real person', cn: '输入图片包含真实人脸，请更换图片' },
  { keyword: 'output video may contain sensitive information', cn: '生成视频可能包含敏感内容，请调整提示词或更换参考素材' },
  { keyword: 'output video may be related to copyright restrictions', cn: '生成视频可能涉及版权限制，请调整提示词或更换参考素材' },
  { keyword: 'must be less than or equal to 15.2 for model doubao', cn: '音频总时长超过模型上限（最多 15.2 秒），请缩短音频或减少对白/角色音色' },
  { keyword: 'be greater than or equal to 1.8 for model', cn: '音频时长低于模型下限（至少 1.8 秒），请延长音频或补足对白/角色音色' },
  { keyword: 'input text may contain sensitive information', cn: '输入文本含敏感词，请修改文案' },
  { keyword: 'parameter duration specified in the request is not valid', cn: '视频时长参数无效，请调整时长' },
  { keyword: 'audio contents but got', cn: '角色音色超过上限（最多3个）' },
  { keyword: 'input image may contain sensitive information', cn: '输入图片含敏感信息，请更换图片' },
  { keyword: 'audio total duration', cn: '音频总时长超限，请缩短角色音色' },
  { keyword: 'reference images but got', cn: '参考图片超过上限（最多9张）' },
  { keyword: 'copyright restrictions', cn: '生成结果涉及版权限制' },
  { keyword: 'parameter resolution specified in the request is not valid', cn: '分辨率参数无效，请检查设置' },
  { keyword: 'input video may contain real person', cn: '输入视频包含真实人脸，请更换视频' },
  { keyword: 'violate platform rules', cn: '输入图片违反平台规则' },
  { keyword: 'input image may be related to copyright', cn: '输入图片涉及版权限制' },
  { keyword: 'video duration (seconds) specified in the request must be greater than or equal to', cn: '输入视频时长不足，请更换更长视频' },
  { keyword: '413 Request Entity Too Large', cn: '请求数据过大，请减少参考素材' },
  { keyword: '502 Bad Gateway', cn: '上游服务异常，请稍后重试' },
  { keyword: 'Task not found', cn: '视频任务不存在或已过期' },
  { keyword: 'resource download failed', cn: '参考文件下载失败，请检查URL' },
  { keyword: 'Rate limit exceeded', cn: '请求频率超限，请稍后重试' },
  { keyword: 'image format is not supported', cn: '图片格式不被API支持' },
  { keyword: 'unexpected internal error', cn: '服务内部异常，请稍后重试' },
  { keyword: 'system is initialing', cn: '系统初始化中，请稍后重试' },
  { keyword: 'Missing model', cn: '缺少模型参数，请检查API配置' },
  { keyword: 'size is invalid', cn: '图片尺寸无效' },
  { keyword: '403 Forbidden', cn: '访问被拒绝，请检查API密钥' },
  { keyword: 'MISCONF Redis', cn: '服务存储异常，请联系管理员' },
  { keyword: 'All connection attempts failed', cn: '网络连接失败，请检查网络' },
];

/** 查找匹配的中文翻译，未命中返回 null */
export function translateError(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const lower = detail.toLowerCase();
  for (const item of ERROR_TRANSLATIONS) {
    if (lower.includes(item.keyword.toLowerCase())) {
      return item.cn;
    }
  }
  return null;
}

/** 从 axios 错误对象中提取 detail 字符串 */
export function extractErrorDetail(err: any): string {
  return err?.response?.data?.detail || err?.message || String(err || '未知错误');
}
