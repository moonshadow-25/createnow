"""
Generation API - 工具函数
"""


def parse_size(size_str: str) -> tuple[int, int]:
    """
    解析尺寸字符串，支持多种格式：
    - "1024x1024" -> (1024, 1024)
    - "1x1" -> (1536, 1536)
    - "16x9" -> (2048, 1152)
    - "1920x1080" -> (1920, 1080)
    """
    if not size_str:
        return 1536, 1536

    try:
        parts = size_str.lower().split("x")
        if len(parts) != 2:
            return 1536, 1536

        w_ratio = float(parts[0].strip())
        h_ratio = float(parts[1].strip())

        # 如果是比例格式（如 1x1, 16x9），转换为实际像素
        if w_ratio < 100 or h_ratio < 100:
            # 特殊比例映射
            ratio_key = f"{int(w_ratio)}:{int(h_ratio)}"
            special_ratios = {
                "6:19": (576, 1824),   # 三宫格竖图
                "19:6": (1824, 576),   # 三宫格横图
            }
            if ratio_key in special_ratios:
                return special_ratios[ratio_key]

            # 1x1 -> 1536x1536
            # 16x9 -> 2048x1152
            if abs(w_ratio - h_ratio) < 0.01:  # 正方形
                return 1536, 1536
            elif w_ratio > h_ratio:  # 横向 (如16x9)
                return 2048, 1152
            else:  # 纵向
                return 1152, 2048
        else:
            # 直接是像素值
            return int(w_ratio), int(h_ratio)
    except (ValueError, ZeroDivisionError):
        return 1536, 1536
