"""全局风格预设库

提供15个精选的图片和视频风格预设，用于统一全剧视觉风格。
风格后缀作为 {style_instruction} 变量传入提示词模板。
"""

# ==================== 图片风格预设（15个） ====================

IMAGE_STYLE_PRESETS = {
    # 1. 3D动画
    "pixar_3d": {
        "name": "皮克斯3D",
        "name_en": "Pixar 3D Style",
        "category": "3D动画",
        "suffix": "Pixar 3D animation style, vibrant colors, soft lighting, expressive characters, highly detailed textures, cinematic composition, 8K quality",
        "suffix_zh": "皮克斯3D风格，鲜艳色彩，柔和光影，生动角色，精细纹理，电影级构图，8K品质，杰作，8K，超高清"
    },

    "oriental_3d": {
        "name": "东方3D",
        "name_en": "Oriental 3D Animation (Ne Zha Style)",
        "category": "3D动画",
        "suffix": "Chinese 3D animation style, vibrant colors, traditional oriental aesthetics, dynamic poses, epic composition, Ne Zha movie quality",
        "suffix_zh": "中国3D动画风格，鲜艳色彩，东方美学，动态姿势，史诗级构图，哪吒之魔童降世品质，杰作，8K，超高清"
    },

    # 2. 2D动画
    "anime_japanese": {
        "name": "日本动漫",
        "name_en": "Japanese Anime Style",
        "category": "2D动画",
        "suffix": "Japanese anime style, cel-shaded coloring, expressive eyes, vibrant colors, clean linework, Studio Ghibli quality",
        "suffix_zh": "日本动漫风格，赛璐璐上色，富有表现力的眼睛，鲜艳色彩，清晰线条，吉卜力工作室品质，杰作，8K，超高清"
    },

    "ghibli_style": {
        "name": "吉卜力",
        "name_en": "Studio Ghibli Style",
        "category": "2D动画",
        "suffix": "Studio Ghibli animation style, watercolor backgrounds, soft gradients, whimsical atmosphere, hand-drawn art, nostalgic aesthetic",
        "suffix_zh": "吉卜力工作室风格，水彩背景，柔和渐变，奇幻氛围，手绘艺术，怀旧美学，杰作，8K，超高清"
    },

    # 3. 写实风格
    "photorealistic": {
        "name": "照片级写实",
        "name_en": "Photorealistic",
        "category": "写实",
        "suffix": "Photorealistic, DSLR quality, natural lighting, accurate anatomy, realistic textures, professional photography, 8K resolution",
        "suffix_zh": "照片级写实，单反品质，自然光照，准确解剖，真实质感，专业摄影，8K分辨率，杰作，8K，超高清"
    },

    "cinematic_realistic": {
        "name": "电影级写实",
        "name_en": "Cinematic Realistic",
        "category": "写实",
        "suffix": "Cinematic realism, Hollywood quality, dramatic lighting, shallow depth of field, color grading, professional cinematography, 4K",
        "suffix_zh": "电影级写实，好莱坞品质，戏剧性光影，浅景深，调色，专业电影摄影，4K，杰作，8K，超高清"
    },

    # 4. 题材风格
    "modern_urban": {
        "name": "现代都市",
        "name_en": "Modern Urban",
        "category": "题材",
        "suffix": "Modern urban setting, contemporary architecture, city lights, realistic street scenes, photographic quality, cinematic composition",
        "suffix_zh": "现代都市场景，当代建筑，城市灯光，真实街景，摄影级品质，电影级构图，杰作，8K，超高清"
    },

    "chinese_costume": {
        "name": "中国古装",
        "name_en": "Chinese Costume Drama",
        "category": "题材",
        "suffix": "Chinese historical costume drama style, traditional architecture, elegant hanfu clothing, classical aesthetics, cinematic quality",
        "suffix_zh": "中国古装剧风格，传统建筑，典雅汉服，古典美学，电影级品质，杰作，8K，超高清"
    },

    "oriental_fantasy": {
        "name": "东方魔幻",
        "name_en": "Oriental Fantasy (Fengshen)",
        "category": "题材",
        "suffix": "Oriental fantasy style, mythological creatures, ancient Chinese aesthetics, magical atmosphere, epic composition, Fengshen movie quality",
        "suffix_zh": "东方魔幻风格，神话生物，中国古代美学，魔幻氛围，史诗级构图，封神榜电影品质，杰作，8K，超高清"
    },

    "western_fantasy": {
        "name": "西方魔幻",
        "name_en": "Western Fantasy (LOTR)",
        "category": "题材",
        "suffix": "Western fantasy style, medieval architecture, epic landscapes, magical elements, detailed armor, Lord of the Rings aesthetic",
        "suffix_zh": "西方魔幻风格，中世纪建筑，史诗级风景，魔法元素，精致盔甲，指环王美学，杰作，8K，超高清"
    },

    "xianxia_cultivation": {
        "name": "修仙",
        "name_en": "Xianxia Cultivation",
        "category": "题材",
        "suffix": "Chinese xianxia cultivation style, flowing robes, mystical energy, mountain peaks, ethereal atmosphere, Chinese Paladin aesthetic",
        "suffix_zh": "中国修仙风格，飘逸长袍，神秘能量，山峰仙境，空灵氛围，仙剑奇侠传美学，杰作，8K，超高清"
    },

    "wuxia_martial": {
        "name": "武侠",
        "name_en": "Wuxia Martial Arts",
        "category": "题材",
        "suffix": "Chinese wuxia style, martial arts aesthetics, traditional robes, ancient architecture, dynamic poses, Jin Yong novel quality",
        "suffix_zh": "中国武侠风格，武术美学，传统服饰，古代建筑，动态姿势，金庸小说品质，杰作，8K，超高清"
    },

    "sci_fi_future": {
        "name": "科幻未来",
        "name_en": "Sci-Fi Future",
        "category": "题材",
        "suffix": "Futuristic sci-fi style, advanced technology, sleek design, neon lights, high-tech environment, cinematic quality",
        "suffix_zh": "科幻未来风格，先进科技，流线设计，霓虹灯光，高科技环境，电影级品质，杰作，8K，超高清"
    },

    # 5. 特殊风格
    "cyberpunk": {
        "name": "赛博朋克",
        "name_en": "Cyberpunk",
        "category": "特殊",
        "suffix": "Cyberpunk aesthetic, neon-lit urban environment, high-tech low-life, futuristic dystopia, glowing holograms, Blade Runner inspired",
        "suffix_zh": "赛博朋克美学，霓虹灯城市，高科技低生活，未来反乌托邦，发光全息图，银翼杀手风格，杰作，8K，超高清"
    },

    # 6. 默认
    "none": {
        "name": "无",
        "name_en": "None",
        "category": "默认",
        "suffix": "",
        "suffix_zh": ""
    }
}

# ==================== 视频风格预设（15个） ====================

VIDEO_STYLE_PRESETS = {
    # 1. CG动画
    "pixar_cg": {
        "name": "皮克斯CG动画",
        "name_en": "Pixar CG Animation",
        "category": "CG动画",
        "suffix": "Pixar-style CG animation, expressive character animation, smooth motion, vibrant colors, soft lighting, 24fps timing",
        "suffix_zh": "皮克斯CG动画，富有表现力的角色动画，流畅运动，鲜艳色彩，柔和光影，24帧节奏，杰作，8K，超高清"
    },

    "oriental_3d_video": {
        "name": "东方3D",
        "name_en": "Oriental 3D Animation (Ne Zha)",
        "category": "CG动画",
        "suffix": "Chinese 3D animation, dynamic action sequences, traditional aesthetics, vibrant visuals, epic camera work, Ne Zha movie quality",
        "suffix_zh": "中国3D动画，动态动作场景，传统美学，鲜艳视觉，史诗级镜头，哪吒之魔童降世品质，杰作，8K，超高清"
    },

    # 2. 2D动画
    "anime_2d": {
        "name": "日本动漫2D",
        "name_en": "Japanese Anime 2D",
        "category": "2D动画",
        "suffix": "Japanese anime 2D animation, cel-shaded coloring, dynamic action, expressive movements, dramatic camera angles, 24fps animation",
        "suffix_zh": "日本动漫2D动画，赛璐璐上色，动态动作，富有表现力的运动，戏剧性镜头角度，24帧动画，杰作，8K，超高清"
    },

    "hand_drawn_2d": {
        "name": "手绘2D动画",
        "name_en": "Hand-Drawn 2D Animation",
        "category": "2D动画",
        "suffix": "Hand-drawn 2D animation, traditional cel animation, fluid movements, expressive linework, vibrant colors, Studio Ghibli aesthetic",
        "suffix_zh": "手绘2D动画，传统赛璐璐动画，流畅运动，富有表现力的线条，鲜艳色彩，吉卜力美学，杰作，8K，超高清"
    },

    # 3. 写实风格
    "cinematic_realistic_video": {
        "name": "电影级写实",
        "name_en": "Cinematic Realistic",
        "category": "写实",
        "suffix": "Cinematic realism, Hollywood film quality, natural camera movements, dramatic lighting, shallow depth of field, professional cinematography, 4K",
        "suffix_zh": "电影级写实，好莱坞电影品质，自然相机运动，戏剧性光影，浅景深，专业电影摄影，4K，杰作，8K，超高清"
    },

    "photorealistic_video": {
        "name": "照片级写实视频",
        "name_en": "Photorealistic Video",
        "category": "写实",
        "suffix": "Photorealistic video, lifelike motion, accurate physics, realistic lighting, natural interactions, high-fidelity rendering, 60fps",
        "suffix_zh": "照片级写实视频，逼真运动，准确物理，真实光影，自然交互，高保真渲染，60帧，杰作，8K，超高清"
    },

    # 4. 题材风格
    "modern_urban_video": {
        "name": "现代都市剧",
        "name_en": "Modern Urban Drama",
        "category": "题材",
        "suffix": "Modern urban drama style, contemporary city scenes, realistic movements, natural lighting, cinematic camera work, TV series quality",
        "suffix_zh": "现代都市剧风格，当代城市场景，真实运动，自然光照，电影级镜头，电视剧品质，杰作，8K，超高清"
    },

    "chinese_costume_video": {
        "name": "中国古装剧",
        "name_en": "Chinese Costume Drama",
        "category": "题材",
        "suffix": "Chinese historical costume drama, traditional architecture, elegant movements, classical aesthetics, cinematic camera work, TV series quality",
        "suffix_zh": "中国古装剧，传统建筑，典雅动作，古典美学，电影级镜头，电视剧品质，杰作，8K，超高清"
    },

    "oriental_fantasy_video": {
        "name": "东方魔幻",
        "name_en": "Oriental Fantasy (Fengshen)",
        "category": "题材",
        "suffix": "Oriental fantasy video, mythological elements, magical effects, dynamic action, epic cinematography, Fengshen movie quality",
        "suffix_zh": "东方魔幻视频，神话元素，魔法特效，动态动作，史诗级电影摄影，封神榜电影品质，杰作，8K，超高清"
    },

    "western_fantasy_video": {
        "name": "西方魔幻",
        "name_en": "Western Fantasy (GoT)",
        "category": "题材",
        "suffix": "Western fantasy video, medieval settings, epic battles, dramatic camera work, detailed costumes, Game of Thrones aesthetic",
        "suffix_zh": "西方魔幻视频，中世纪场景，史诗战斗，戏剧性镜头，精致服饰，权力的游戏美学，杰作，8K，超高清"
    },

    "xianxia_cultivation_video": {
        "name": "修仙剧",
        "name_en": "Xianxia Cultivation Drama",
        "category": "题材",
        "suffix": "Xianxia cultivation drama, flowing movements, mystical energy effects, mountain scenery, ethereal atmosphere, Chinese Paladin quality",
        "suffix_zh": "修仙剧，飘逸动作，神秘能量特效，山峰仙境，空灵氛围，仙剑奇侠传品质，杰作，8K，超高清"
    },

    "wuxia_martial_video": {
        "name": "武侠剧",
        "name_en": "Wuxia Martial Arts Drama",
        "category": "题材",
        "suffix": "Wuxia martial arts drama, dynamic fight choreography, traditional robes, ancient settings, cinematic camera work, Jin Yong quality",
        "suffix_zh": "武侠剧，动态武打编排，传统服饰，古代场景，电影级镜头，金庸作品品质，杰作，8K，超高清"
    },

    "sci_fi_future_video": {
        "name": "科幻未来",
        "name_en": "Sci-Fi Future",
        "category": "题材",
        "suffix": "Futuristic sci-fi video, advanced technology, sleek movements, neon lighting, high-tech environments, cinematic quality",
        "suffix_zh": "科幻未来视频，先进科技，流畅运动，霓虹灯光，高科技环境，电影级品质，杰作，8K，超高清"
    },

    # 5. 特殊风格
    "cyberpunk_video": {
        "name": "赛博朋克",
        "name_en": "Cyberpunk",
        "category": "特殊",
        "suffix": "Cyberpunk video, neon-lit streets, futuristic urban scenes, dynamic camera movements, glowing effects, Blade Runner inspired",
        "suffix_zh": "赛博朋克视频，霓虹灯街道，未来都市场景，动态镜头运动，发光特效，银翼杀手风格，杰作，8K，超高清"
    },

    "claymation": {
        "name": "粘土定格动画",
        "name_en": "Claymation Stop-Motion",
        "category": "特殊",
        "suffix": "Claymation stop-motion animation, handcrafted characters, frame-by-frame movement, tactile textures, Aardman Animations style, 12-15fps",
        "suffix_zh": "粘土定格动画，手工制作角色，逐帧运动，触感质感，阿德曼动画风格，12-15帧，杰作，8K，超高清"
    },

    # 6. 默认
    "none": {
        "name": "无",
        "name_en": "None",
        "category": "默认",
        "suffix": "",
        "suffix_zh": ""
    }
}

# ==================== 工具函数 ====================

def get_image_style_suffix(preset_id: str, language: str = "zh") -> str:
    """获取图片风格后缀

    Args:
        preset_id: 预设ID
        language: 语言设置 (zh/en/auto)

    Returns:
        风格后缀字符串
    """
    preset = IMAGE_STYLE_PRESETS.get(preset_id, IMAGE_STYLE_PRESETS["none"])
    return preset["suffix_zh"] if language == "zh" else preset["suffix"]


def get_video_style_suffix(preset_id: str, language: str = "zh") -> str:
    """获取视频风格后缀

    Args:
        preset_id: 预设ID
        language: 语言设置 (zh/en/auto)

    Returns:
        风格后缀字符串
    """
    preset = VIDEO_STYLE_PRESETS.get(preset_id, VIDEO_STYLE_PRESETS["none"])
    return preset["suffix_zh"] if language == "zh" else preset["suffix"]


def get_all_image_presets():
    """获取所有图片风格预设列表（用于前端展示）

    Returns:
        预设列表，每个预设包含id、name、name_en、category
    """
    return [
        {
            "id": key,
            "name": value["name"],
            "name_en": value["name_en"],
            "category": value["category"]
        }
        for key, value in IMAGE_STYLE_PRESETS.items()
    ]


def get_all_video_presets():
    """获取所有视频风格预设列表（用于前端展示）

    Returns:
        预设列表，每个预设包含id、name、name_en、category
    """
    return [
        {
            "id": key,
            "name": value["name"],
            "name_en": value["name_en"],
            "category": value["category"]
        }
        for key, value in VIDEO_STYLE_PRESETS.items()
    ]
