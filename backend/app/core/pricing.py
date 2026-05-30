"""
统一计费常量

所有消耗计算从此处引用，不再散装硬编码。
单位：积分（credits）。
"""

# 图片默认单价（积分/张），用于无 actual_cost 的存量数据回退
DEFAULT_IMAGE_COST = 100  # 原 0.5 RMB × 200

# 视频默认单价（积分/秒），按分辨率
DEFAULT_VIDEO_PRICES = {
    "480p": 140,   # 原 0.7 RMB × 200
    "720p": 200,   # 原 1.0 RMB × 200
    "1080p": 560,  # 原 2.8 RMB × 200
}

# 去字幕默认成本（积分/次），待平台返回真实消耗后更新
DEFAULT_SUBTITLE_REMOVAL_COST = 0

# 不计费模型（手动上传、三宫格拆解）
ZERO_COST_MODELS = {"manual_upload", "split"}

# 旧数据 RMB → 积分换算比
LEGACY_RMB_TO_CREDITS = 200
