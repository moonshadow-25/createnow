"""
统一计费常量

所有消耗计算从此处引用，不再散装硬编码。
"""

# 图片默认单价（RMB/张），用于无 actual_cost 的存量数据回退
DEFAULT_IMAGE_COST = 0.5

# 视频默认单价（RMB/秒），按分辨率
DEFAULT_VIDEO_PRICES = {
    "480p": 0.7,
    "720p": 1.0,
    "1080p": 2.8,
}

# 去字幕默认成本（RMB/次），待平台返回真实消耗后更新
DEFAULT_SUBTITLE_REMOVAL_COST = 0

# 不计费模型（手动上传、三宫格拆解）
ZERO_COST_MODELS = {"manual_upload", "split"}
