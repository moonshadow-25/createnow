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

# 去字幕成本（积分/条）
SUBTITLE_REMOVAL_COST = 300

# 不计费模型（手动上传、三宫格拆解、视频抽帧）
ZERO_COST_MODELS = {"manual_upload", "split", "extracted_frame"}

# 旧数据 RMB → 积分换算比
LEGACY_RMB_TO_CREDITS = 200
