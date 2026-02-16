"""
Generation API - 默认提示词模板

这些模板作为项目未自定义时的默认值，用户可通过 /prompt-templates API 查看和修改。
"""

# ==================== 方案B：预设模板库 ====================
# 每个模板类型包含多个预设（default, nine_grid等）
# 用户可基于预设创建自定义模板

DEFAULT_PRESETS = {
    # 图片提示词（资产）
    "image": {
        "default": {
            "name": "默认",
            "description": "通用资产图片生成，支持角色、场景、道具",
            "variables": ["{language_instruction}", "{asset_type}", "{description}", "{style_instruction}"],
            "content": """{language_instruction}，必须使用上述语言书写提示词

你是一位世界顶级的AI绘画提示词专家，精通主流AI绘画工具的提示词编写。

【任务】
根据提供的{asset_type}资产描述，生成高质量的AI绘画提示词。

【资产描述】
类型：{asset_type}
描述：{description}

【全局风格要求】
{style_instruction}

【提示词编写要求】

1. **提示词必须包含**：
   - 主体描述（详细、具体）
   - **全局风格要求中指定的风格**（必须融入提示词中）
   - 画面构图
   - 光影效果
   - 色彩基调
   - 质感细节
   - 氛围营造

2. **风格匹配指南**：
   - 如果全局风格要求不为空，必须优先使用全局风格
   - 如果描述包含"卡通"、"动画"、"Pixar"、"迪士尼"等 → 使用Pixar/Disney 3D animation style
   - 如果描述包含"日漫"、"二次元"、"anime"等 → 使用anime/manga style
   - 如果描述包含"写实"、"真实"、"真人"等 → 使用photorealistic/hyperrealistic style
   - 如果描述包含"油画"、"水彩"、"插画"等 → 使用相应绘画风格
   - 如果描述包含"3D"、"立体"、"拟人化"等 → 强调3D rendering, volumetric lighting

3. **特别注意事项**：
   - 仔细分析描述中的所有信息，不要遗漏重要细节
   - 如果描述中已有风格关键词，务必在提示词中体现并强化
   - 确保提示词逻辑清晰，前后一致
   - 使用专业的艺术和摄影术语

【输出格式】
只返回JSON，不要其他说明文字：
{{
  "prompt": "完整的符合用户语言要求的AI绘画提示词"
}}"""
        }
    },

    # 视频提示词
    "video": {
        "default": {
            "name": "默认",
            "description": "标准视频提示词生成，适合单个分镜",
            "variables": ["{language_instruction}", "{description}", "{characters}", "{scene}", "{props}", "{camera_movement}", "{duration}", "{style_instruction}"],
            "content": """{language_instruction}

你是一位专业的AI视频生成提示词专家，精通Sora、Runway、Pika等视频生成工具的提示词编写。

【任务】
根据分镜信息，生成高质量的视频生成提示词。

【分镜信息】
画面描述：{description}
出场角色：{characters}
场景：{scene}
道具：{props}
运镜方式：{camera_movement}
时长：{duration}秒

【全局风格要求】
{style_instruction}

【提示词编写要求】

1. **内容结构**：
   - 开场画面描述（静态场景建立）
   - 主体动作/运动（核心动态内容）
   - 镜头运动（与camera_movement参数保持一致）
   - 画面变化（光线、色彩、视角的演变）
   - 结尾画面（可留开放式结尾）

2. **必须包含的元素**：
   - **全局风格要求中指定的风格**（必须融入提示词中）
   - 运动描述：使用动态动词（如：moves slowly, camera pans to, zoom in on等）
   - 节奏控制：根据时长合理分配动作节奏
   - 视觉效果：lighting changes, color shifts, transitions等
   - 情感氛围：通过运动和变化传达的情绪

3. **运镜匹配**：
   - 平移（pan）：描述横扫过的场景元素
   - 推拉（zoom in/out）：描述前景/背景的变化
   - 跟踪（tracking）：描述跟随主体的运动
   - 升降（tilt）：描述上下视角的转换
   - 环绕（orbit）：描述环绕主体的全景展现

4. **时长考虑**：
   - 5秒：简洁动作，1-2个主要变化
   - 10秒：中等复杂度，2-3个变化阶段
   - 15秒以上：复杂运动，多阶段演变

5. **表达要求**：
   - 时态使用现在进行时（is moving, camera pans）
   - 详细的形容词和副词增强表现力
   - 专业的影视术语（如：depth of field, rack focus, slow motion等）
   - 如果全局风格要求不为空，必须将风格要求自然融入描述中

【输出格式】
返回JSON格式：
{{
  "prompt": "完整的视频生成提示词"
}}"""
        },
        "nine_grid": {
            "name": "九宫格",
            "description": "九宫格视频提示词，根据九宫格分镜和剧情生成导演思维的视频描述",
            "variables": ["{description}", "{dialogue}", "{characters}", "{scene}", "{props}"],
            "content": """你是一位世界顶级的视频导演，精通根据九宫格分镜图和剧情生成完整的视频提示词。

【任务】
这是一个九宫格视频生成任务。你将获得九宫格分镜提示词（描述了每个格子的画面），以及当前本段的剧情推进。请以导演思维描述每一个格子的剧情开展、对白或者旁白，最终输出给AI完整的参考图生视频提示词。

【输入信息】
九宫格分镜描述：{description}
剧情对白：{dialogue}
出场角色：{characters}
场景：{scene}
道具：{props}

【关键格式要求】
**CRITICAL（必须遵守）**：
1. **第一行**：必须先定义所有角色引用，格式为：@图1是角色名，@图2是角色名，@图3是角色名...
2. **第二行**：风格描述（如：风格:武侠史诗/青蓝色调/江南水墨意境/东方美学）
3. **第三行起**：镜头脚本（9个时间段）

**严禁在镜头脚本中重复使用 @图X 格式！**
- ❌ 错误：[0-2秒]@图1是范建端坐于...
- ✅ 正确：[0-2秒]范建端坐于...
- ❌ 错误：[2-4秒]镜头切至@图2是范闲...
- ✅ 正确：[2-4秒]镜头切至范闲...

【正确示例】
###以下是正确示例
@图1是女剑客，@图2是盲侠
风格:武侠史诗/青蓝色调/江南水墨意境/东方美学/轻功决斗

镜头脚本
[0-2秒][中景]身穿深色武服、发髻高束的女剑客持剑而立，眼神锐利。对面是身着灰袍、戴墨镜的盲侠，手握长棍静待。
[2-4秒][特写]女剑客眼中杀意凛然，长剑出鞘瞬间银光闪烁。硬切至盲侠面部特写，墨镜反射着湖光，嘴角微扬，棍法起势。
[4-6秒][中景]两人身形交错，剑棍相击，火花四溅。
[6-8秒][中远景]盲侠施展轻功，身形如燕掠过湖面，长棍轻巧应对女剑客的凌厉剑招，水花四溅，动作飘逸流畅。
[8-10秒][特写]女剑客剑锋直刺，盲侠侧身闪避，棍端点向她肩头。
[10-12秒][近景]女剑客借力旋身，长剑划出一道弧光。盲侠后退半步，长棍横扫。
[12-13秒][特写]两人眼神交汇，战意升腾。
[13-14秒][中景]盲侠棍法渐急，女剑客剑势凌厉，激战正酣。
[14-15秒][远景]湖面波光粼粼，两人身影在水面上空翻转腾挪，形成一幅动态水墨画。

【字幕效果】
严禁字幕

###以上是正确示例

【提示词编写要求】
1. 按照九宫格的9个画面，逐格描述镜头脚本
2. 每格标注时间段（假设每格约1.5-2秒，总时长15秒左右）
3. 标注景别（特写/近景/中景/远景等）
4. 描述剧情推进、角色动作、对白情绪
5. 如有对话，描述角色说话时的口型、表情、情绪
6. 保持九个画面的连贯性和叙事流畅性
7. **记住：只在开头定义角色引用，后续直接用角色名字！**
8. 无论任何时候，结尾必须添加“【字幕效果】严禁字幕”


【输出格式】
返回JSON格式：
{{
  "prompt": "完整的九宫格视频提示词，严格按照上述格式：第一行角色定义，第二行风格，第三行起镜头脚本"
}}"""
        }
    },

    # 视频反推
    "video_reverse": {
        "default": {
            "name": "默认",
            "description": "使用VLM根据图片反推视频提示词",
            "variables": ["{description}", "{characters}", "{scene}", "{props}", "{camera_movement}", "{duration}"],
            "content": """你是一位专业的AI视频生成提示词专家，擅长根据图片反推视频生成提示词。

【任务】
根据提供的图片和分镜信息，反推生成适合视频生成的提示词。

【图片分析要求】
仔细观察图片中的：
- 主体人物/物体的外观、姿态、表情
- 场景环境、光线、色调
- 构图、景深、视角
- 画面风格和艺术特征

【分镜信息】
画面描述：{description}
出场角色：{characters}
场景：{scene}
道具：{props}
运镜方式：{camera_movement}
时长：{duration}秒

【输出要求】
结合图片视觉信息和分镜文字信息，生成视频提示词，要求：
1. 以图片为基础，描述从静态到动态的转变
2. 包含运动描述、镜头运动、视觉效果
3. 使用现在进行时
4. 使用专业影视术语

【输出格式】
返回JSON格式：
{{
  "prompt": "完整的视频生成提示词"
}}"""
        }
    },

    # 分镜生成（批量生成分镜）
    "storyboard": {
        "default": {
            "name": "默认",
            "description": "根据剧本批量生成分镜描述",
            "variables": ["{script}"],
            "content": """你是一位专业的影视分镜设计师，精通视觉叙事和镜头语言设计。

【任务】
根据以下剧本内容，生成详细的AI分镜描述，用于自动生成分镜画面。

【剧本内容】
{script}

【分镜设计要求】

1. **镜头多样性**：
   - 使用不同景别：特写、近景、中景、全景、远景
   - 变换拍摄角度：平视、俯视、仰视、倾斜
   - 适当运用推、拉、摇、移、跟等运镜方式

2. **叙事节奏**：
   - 根据剧情高潮和低谷调整镜头长度
   - 关键情节使用特写或慢动作
   - 转场场景使用全景或空镜

3. **视觉呈现**：
   - 注重构图平衡和视觉引导
   - 考虑光线和阴影效果
   - 确保画面信息层次清晰

4. **设计输出**：
   为每个镜头生成详细的视觉描述，包括：
   - 画面主体和构图
   - 角色动作和表情
   - 环境细节和氛围
   - 色彩和光线建议

【输出格式】
返回JSON数组，每个分镜包含：
{{
  "sequence": 镜头序号,
  "shot_type": "镜头类型（特写/近景/中景/全景/远景）",
  "camera_angle": "镜头角度（平视/仰视/俯视/鸟瞰）",
  "description": "详细的画面描述",
  "action": "动作描述",
  "dialogue": "对白（如有）",
  "duration": "建议时长（秒）"
}}"""
        },
        "nine_grid": {
            "name": "九宫格",
            "description": "根据剧本自动拆分为九宫格分镜组（每组15秒），每个分镜包含9个段落的详细描述",
            "variables": ["{script}"],
            "content": """你是一位世界顶级的分镜设计师，精通九宫格分镜拆分技术。

【任务】
根据剧本，将其拆分为多个15秒的九宫格分镜。每个九宫格分镜包含9个画面段落的详细描述。

【输入信息】
剧本内容：{script}

【拆分要求】
1. **时长估计**：
   - 估算剧本总时长
   - 每个九宫格对应15秒视频
   - 例如：1分钟剧本 = 4个九宫格分镜

2. **九宫格描述**：
   - 每个九宫格包含9个画面段落
   - 每个段落约1.5-2秒
   - 在 description 字段中详细描述这9个段落的连续画面

3. **描述格式**：
   在 description 字段中按如下格式描述9个段落：

   【0-2秒】[景别] 画面描述1
   【2-4秒】[景别] 画面描述2
   【4-6秒】[景别] 画面描述3
   【6-8秒】[景别] 画面描述4
   【8-10秒】[景别] 画面描述5
   【10-12秒】[景别] 画面描述6
   【12-13秒】[景别] 画面描述7
   【13-14秒】[景别] 画面描述8
   【14-15秒】[景别] 画面描述9

【输出格式】
返回标准的分镜JSON数组，每个分镜包含：
{{
  "sequence": 镜头序号,
  "shot_type": "九宫格分镜",
  "camera_angle": "多角度",
  "description": "详细的9段画面描述（按上述格式）",
  "action": "主要动作描述",
  "dialogue": "对白（如有）",
  "duration": 15
}}

【示例】
{{
  "sequence": 1,
  "shot_type": "九宫格分镜",
  "camera_angle": "多角度",
  "description": "【0-2秒】[远景] 古城全景，青瓦白墙\n【2-4秒】[中景] 范闲躺在摇椅上翻书\n【4-6秒】[特写] 范闲若有所思的表情...",
  "action": "范闲思考人生",
  "dialogue": "范闲（OS）：来到这个世界已经二十年了...",
  "duration": 15
}}"""
        }
    },

    # 分镜转图片（文生图）
    "storyboard_image": {
        "default": {
            "name": "默认",
            "description": "分镜描述转AI绘画提示词（文生图）",
            "variables": ["{language_instruction}", "{description}", "{shot_type}", "{action}", "{camera_angle}", "{style_instruction}"],
            "content": """{language_instruction}

你是一位世界顶级的AI绘画专家，专精于将分镜描述转换为高质量的Midjourney/Stable Diffusion提示词。

【任务】
根据分镜描述，生成专业级的AI绘画提示词，确保输出的画面完全符合分镜要求。

【分镜信息】
镜头描述：{description}
镜头类型：{shot_type}
动作要求：{action}
镜头角度：{camera_angle}

【全局风格要求】
{style_instruction}

【提示词生成要求】

1. **精确还原**：
   - 完全遵循分镜的所有构图要求
   - 准确呈现角色动作和表情
   - 精确还原场景和道具细节

2. **艺术质量**：
   - 使用专业构图术语
   - 强调光影和色彩表现
   - 添加适当的细节描述

3. **风格匹配**：
   - **全局风格要求中指定的风格**（必须融入提示词中）
   - 如果全局风格要求不为空，必须优先使用全局风格
   - 根据镜头类型选择合适的艺术风格
   - 保持画风的一致性
   - 体现分镜的情感氛围

4. **技术优化**：
   - 8K超高清细节
   - 专业渲染参数
   - 最佳长宽比 --ar 16:9

【输出格式】
返回JSON格式：
{{
  "prompt": "完整的AI绘画提示词"
}}"""
        }
    },

    # 分镜图生图（参考图融合）
    "storyboard_image_edit": {
        "default": {
            "name": "默认",
            "description": "基于参考图生成分镜画面（图生图）",
            "variables": ["{language_instruction}", "{description}", "{shot_type}", "{action}", "{camera_angle}", "{style_instruction}"],
            "content": """{language_instruction}

你是一位世界顶级的影视分镜生成大师，精通图生图技术，能够将多个参考图像完美融合到一个分镜画面中。

【任务】
这是一个图生图任务。你将获得多个参考图像（按image1, image2, image3...顺序），请基于这些参考图像生成符合分镜要求的全新画面。

【输入信息】
{description}

【全局风格要求】
{style_instruction}

【提示词编写要求】

1. **引用格式**：
   - 使用 "the man in image1" / "the woman in image2" / "the table in image3" 格式引用参考图
   - 不要使用角色名字，图像API无法理解名字
   - 明确描述如何组合多个参考图像到一个画面中

2. **画面组合**：
   - 根据分镜要求，合理布局各个参考图像中的元素
   - 考虑角色之间的位置关系、前后景层次
   - 确保场景和道具自然融入画面

3. **镜头语言**：
   - 根据镜头类型（{shot_type}）选择合适的构图方式
   - 根据镜头角度（{camera_angle}）调整视角和透视
   - 添加运镜暗示，增强画面动感

4. **艺术质量**：
   - **全局风格要求中指定的风格**（必须融入提示词中）
   - 如果全局风格要求不为空，必须优先使用全局风格
   - 保持画面风格统一
   - 添加适当的光影效果和氛围描述
   - 强调细节质感和色彩和谐

【提示词编写示例】
- "Combine the man in image1 and the woman in image2 in the office scene from image3, with the table from image4 visible in the foreground, medium shot, soft lighting"
- "A close-up shot showing the character from image1 holding the prop from image5, dramatic shadows, emotional expression"

【输出格式】
返回JSON格式：
{{
  "prompt": "完整的图生图提示词，包含如何组合各参考图像的描述"
}}"""
        },
        "nine_grid": {
            "name": "九宫格",
            "description": "九宫格分镜图生图，结合多个参考图生成完整故事线的九宫格画面",
            "variables": ["{language_instruction}", "{description}", "{style_instruction}"],
            "content": """{language_instruction}

你是一位世界顶级的影视分镜生成大师，精通图生图技术，能够将多个参考图像完美构图到一个九宫格分镜画面中。

【角色设定】
你是一位顶级电影摄影师，擅长捕捉"生活碎片感"。你的任务是根据用户提供的参考图，在保持人物长相、服装和场景完全一致的前提下，创作一个关于【输入信息】的9帧动态分镜。

【任务】
本项目是一个真人写实风格电影，这是一个图生图任务。你将获得多个参考图像（按图1, 图2, 图3...顺序），请基于这些参考图像生成符合分镜要求的全新画面。

【输入信息】
{description}

【全局风格要求】
{style_instruction}

【提示词编写要求】

1. **引用格式**：
   - 使用 "图1中的男人" / "图2中的女人" / "图3中的场景" 格式引用参考图
   - 不要使用角色名字，图像API无法理解名字
   - 明确描述如何组合多个参考图像到一个画面中
   - 注意：你不是在做角色形象融合，而是多角色共同在一个分镜中的描述

2. **核心原则 - 视觉一致性**：
   - 参考图为准：严禁自行描述人物的衣着、场景等。所有画面必须直接继承参考图中的视觉资产
   - 镜头跳跃：每一帧必须切换景别，严禁连续出现两张相似角度的图片
   - 电影级氛围：强调高清，胶片，电影质感的构图美学

3. **风格要求**：
   - **全局风格要求中指定的风格**（必须融入提示词中）
   - 如果全局风格要求不为空，必须优先使用全局风格
   - 保持九宫格所有帧的风格统一性

4. **九宫格分镜结构**：
   将9帧分为三排，每排3帧，构成完整故事线：

   第一排：仪式感的开始 (The Prep)
   - 第1帧 [远景/环境]：沿用参考图场景，角色走进画面（全景），开始准备。强调空间感和治愈的氛围
   - 第2帧 [中景/侧拍]：角色站在台面旁，低头整理。焦点在人物与物品的互动
   - 第3帧 [特写/手部]：极近距离拍摄手部动作，颗粒感清晰可见

   第二排：核心过程 (The Process)
   - 第4帧 [俯拍/特写]：镜头对准核心对象，展现极其诱人的纹理细节
   - 第5帧 [过肩镜头]：从角色的肩膀后方视角拍摄，捕捉动态瞬间，背景虚化
   - 第6帧 [近景/表情]：角色专注的侧脸，微光照在脸上，捕捉平静且治愈的表情，眼神温柔

   第三排：沉浸式享受 (The Healing)
   - 第7帧 [极端微距]：核心对象的细节特写，呈现出极致的视觉感
   - 第8帧 [近景/动作]：角色互动瞬间，闭上眼睛享受，光影柔和
   - 第9帧 [俯拍/大远景]：结束画面。整体构图，营造出"时光静好"的电影收尾感

【最终输出格式范例】
严格按照三排九格的结构，每格描述镜头景别、构图、动作、情绪：

- 第一排：仪式感的开始
  * 第1帧 [远景/环境]：...
  * 第2帧 [中景/侧拍]：...
  * 第3帧 [特写/手部]：...

- 第二排：核心过程
  * 第4帧 [俯拍/特写]：...
  * 第5帧 [过肩镜头]：...
  * 第6帧 [近景/表情]：...

- 第三排：沉浸式享受
  * 第7帧 [极端微距]：...
  * 第8帧 [近景/动作]：...
  * 第9帧 [俯拍/大远景]：...

【输出格式】
返回JSON格式：
{{
  "positive_prompt": "完整的中文图生图提示词，包含如何组合各参考图像的描述，以及九宫格的完整分镜描述"
}}

注意：目的是让AI根据剧情和给定的素材图片，输出一次能够生成完整故事线的九宫格分镜图。"""
        }
    },

    # 图片编辑（子角色变体）
    "image_edit": {
        "default": {
            "name": "默认",
            "description": "基于主角色图片生成子角色变体",
            "variables": ["{parent_name}", "{parent_description}", "{parent_gender}", "{parent_age}", "{child_name}", "{child_description}", "{child_gender}", "{child_age}"],
            "content": """你是一个专业的AI图像编辑提示词专家。根据主角色和子角色的信息，生成用于图像编辑的提示词。

【主角色信息】
名称：{parent_name}
描述：{parent_description}
性别：{parent_gender}
年龄：{parent_age}

【子角色信息】
名称：{child_name}
描述：{child_description}
性别：{child_gender}
年龄：{child_age}

【任务】
基于主角色的参考图，生成图像编辑提示词，使其成为子角色的形象。保持主角色的基本面部特征和整体风格，但根据子角色的描述调整服装、发型、表情、姿态等细节。

【要求】
1. 保持角色面部特征的相似性（因为这是同一个角色的不同造型）
2. 根据子角色描述调整服装、发型、配饰等
3. 保持与主角色相同或相似的画风风格
4. 返回格式：prompt（描述需要做出的改变）

【输出格式】
返回JSON格式：
{{
  "prompt": "详细的图像编辑提示词"
}}"""
        },
        "character_sheet": {
            "name": "人设图",
            "description": "生成角色人设图（全身三视图+6张面部特写）",
            "variables": [],
            "content": """基于提供的参考图像生成完整的角色人设图。

【布局要求】
画面整体采用16:9横版构图，分为左右两部分：

左侧区域（占画面60%宽度）：
- 人物全身三视图（正面、侧面、背面）
- 从左到右依次排列，等高站立姿态
- 保持相同的服装、发型、配饰、体态
- 清晰展现服装设计细节和体型比例

右侧区域（占画面40%宽度）：
- 人物面部特写，2列3行网格排列，共6个特写
- 第1行：正面特写、45度侧面特写
- 第2行：左侧面特写、右侧面特写
- 第3行：微笑表情特写、严肃表情特写
- 所有特写保持相同的发型、五官特征、肤色

【风格要求】
- 保持与参考图完全一致的风格，禁止修改画风
- 统一的光照条件，避免阴影遮挡
- 纯白色或浅灰色背景，便于查看细节
- 专业角色设定图风格（character design sheet）
- 高清晰度，线条清晰，8K分辨率

【一致性要求】
- 服装款式、颜色、纹理在所有视图中完全相同
- 发型、发色在所有视图中保持一致
- 面部特征（眼睛、鼻子、嘴巴、脸型）在所有角度保持一致
- 体型比例在全身视图中保持统一

Character design sheet, reference sheet, turnaround, 16:9 aspect ratio, clean white background, professional quality, highly detailed"""
        }
    },

    # 三宫格
    "triple_grid": {
        "default": {
            "name": "默认",
            "description": "三宫格分镜拆解",
            "variables": ["{description}"],
            "content": """三联分镜，故事板，多角度，多镜头语言，场景一致性，风格复制；影片风格、色彩、光影、线条质感必须与原图严格保持一致。人物忠实还原，连贯叙事
剧情描述：
{description}"""
        }
    },

    # VLM通用模板
    "vlm": {
        "default": {
            "name": "默认",
            "description": "VLM图片分析通用模板",
            "variables": ["{user_goal}", "{storyboard_info}"],
            "content": """你是一个专业的动画分镜师和图像分析专家。

【用户目标】
{user_goal}

【分镜信息】
{storyboard_info}

【分析要求】
1. 结合图片和分镜文字信息进行综合分析：
   - 图片提供视觉信息（角色外观、场景环境、构图、光影、色彩）
   - 分镜信息提供意图和上下文（描述、镜头类型、动作等）

2. 仔细分析提供的图片内容：
   - 角色：外观、姿态、表情、服装、动作
   - 场景：环境、布局、空间关系、景深
   - 道具：物品、工具、特殊元素
   - 构图：视角、取景、画面重心
   - 光影：光源、明暗、色调、氛围
   - 风格：艺术风格、绘画技法、视觉特征

3. 根据用户目标生成详细、具体的描述：
   - 描述要适合用于图像生成或视频生成
   - 保持画面的连贯性和风格一致性
   - 使用专业的艺术和影视术语
   - 确保描述清晰、准确、可执行

4. 输出要求：
   - 只输出描述内容本身
   - 不要包含解释、分析或元信息
   - 不要使用"这张图片显示"、"我看到"等引导语
   - 直接给出可用于生成的提示词

【输出格式】
直接输出详细的画面描述："""
        }
    },

    # 多分镜融合视频
    "multi_scene_video": {
        "default": {
            "name": "默认",
            "description": "多分镜融合成一个连贯视频的提示词",
            "variables": ["{script_content}", "{storyboards_info}", "{characters_info}", "{scenes_info}", "{props_info}"],
            "content": """你是一位世界顶级的视频导演和分镜师，擅长将剧本转化为连贯的视频分镜提示词。

【任务目标】
根据提供的剧本片段和分镜信息，生成一个完整的、连贯的视频生成提示词，用于多分镜融合视频生成。

【输入信息】
剧本内容：
{script_content}

分镜列表：
{storyboards_info}

涉及资产：
角色：{characters_info}
场景：{scenes_info}
道具：{props_info}

【输出要求】
1. **整体描述**（必须包含）：
   - 视频风格定位（如：韩式高级时尚杂志大片风格、电影级叙事风格、动画风格等）
   - 总时长（根据所有分镜时长累加）
   - 画幅比例（9:16竖屏/16:9横屏，根据内容选择）
   - 色调风格（如：高对比度低饱和、暖色调、冷色调等）
   - 美学定位（如：极简奢华、写实主义、超现实等）
   - 整体氛围（如：冷冽疏离、温馨治愈、紧张悬疑等）

2. **分镜描述**（必须包含）：
   - 按时间轴顺序描述每个分镜
   - 每个分镜包含：
     * 时间段标注
     * 镜头运动（推、拉、摇、移、跟等）
     * 场景描述（环境、光影、氛围）
     * 角色动作（肢体语言、表情、位置关系）
     * 对话呈现（如有对话，描述角色说话时的口型、表情、情绪，以及字幕呈现方式）
     * 情绪表现（角色内心状态的外化）
     * 视觉效果（景深、bokeh、色彩、质感等）
   - 使用专业的电影术语
   - 分镜之间要有连贯性和流畅过渡
   - 在描述中使用资产的描述而非人名（如："穿红衣的年轻男人"而非"张三"）
   - 如果分镜有对话，必须在描述中体现角色说话的状态和对话内容的情绪表达

3. **声音说明**（可选但推荐）：
   - 背景音乐风格
   - 环境音效
   - 对话音效（如有）
   - 特殊音效节点

【输出格式】
严格按照以下格式输出：

【整体描述】
[风格定位]，[总时长]秒，[画幅比例]，[色调风格]，[美学定位]，[整体氛围]

【分镜描述】
[起始秒]-[结束秒]秒：[镜头运动]，[场景描述]；[角色动作和表情]；[如有对话：角色说话状态、口型、情绪，对话内容的情感表达]；[视觉效果]

[起始秒]-[结束秒]秒：[详细的镜头描述，包含对话呈现]

...

【声音说明】
[音乐风格描述]，[环境音效]，[对话音效说明]，[特殊音效节点]

【示例参考】
3-6秒：中景正面拍摄，咖啡厅温暖的暖黄色灯光；穿蓝色衬衫的年轻女性坐在窗边，双手捧着咖啡杯，眼神温柔地看向镜头；她轻启双唇说话，表情真挚而温暖，传达出关切和鼓励的情绪（对话："别担心，一切都会好起来的"）；背景虚化成柔和的bokeh光斑

【注意事项】
- 确保所有分镜时间连续，不重叠不遗漏
- 保持视觉风格的统一性
- 注重镜头之间的流畅过渡
- 使用资产描述而非角色名称
- 对话场景必须描述角色的说话状态、口型动作、情绪表达
- 提示词应具有强烈的画面感和可执行性"""
        }
    }
}

# ==================== 向后兼容：旧的扁平化模板 ====================
# 保留DEFAULT_PROMPT_TEMPLATES用于向后兼容
# 新代码应使用DEFAULT_PRESETS
# 这些模板从DEFAULT_PRESETS的default预设中提取

DEFAULT_PROMPT_TEMPLATES = {
    "image_prompt_template": DEFAULT_PRESETS["image"]["default"]["content"],
    "video_prompt_template": DEFAULT_PRESETS["video"]["default"]["content"],
    "video_reverse_prompt_template": DEFAULT_PRESETS["video_reverse"]["default"]["content"],
    "storyboard_generation_prompt_template": DEFAULT_PRESETS["storyboard"]["default"]["content"],
    "storyboard_image_prompt_template": DEFAULT_PRESETS["storyboard_image"]["default"]["content"],
    "storyboard_image_edit_prompt_template": DEFAULT_PRESETS["storyboard_image_edit"]["default"]["content"],
    "image_edit_prompt_template": DEFAULT_PRESETS["image_edit"]["default"]["content"],
    "triple_grid_prompt_template": DEFAULT_PRESETS["triple_grid"]["default"]["content"],
    "vlm_prompt_template": DEFAULT_PRESETS["vlm"]["default"]["content"],
    "multi_scene_video_prompt": DEFAULT_PRESETS["multi_scene_video"]["default"]["content"],
}

# 定义模板类型列表（用于遍历）
TEMPLATE_TYPES = [
    "image",
    "video",
    "video_reverse",
    "storyboard",
    "storyboard_image",
    "storyboard_image_edit",
    "image_edit",
    "triple_grid",
    "vlm",
    "multi_scene_video"
]

# 旧模板类型到新类型的映射（用于迁移）
OLD_TO_NEW_TEMPLATE_MAPPING = {
    "image_prompt_template": "image",
    "video_prompt_template": "video",
    "video_reverse_prompt_template": "video_reverse",
    "storyboard_generation_prompt_template": "storyboard",
    "storyboard_image_prompt_template": "storyboard_image",
    "storyboard_image_edit_prompt_template": "storyboard_image_edit",
    "image_edit_prompt_template": "image_edit",
    "triple_grid_prompt_template": "triple_grid",
    "vlm_prompt_template": "vlm",
    "multi_scene_video_prompt": "multi_scene_video",
}
