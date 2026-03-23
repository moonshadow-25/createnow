import json
from typing import Dict, List, Optional
from app.services.ai_service import LLMService


class PromptService:
    """提示词生成服务"""

    # 模板在 data/config/default_prompt_templates.json 中修改，此处只是防止为空
    CHARACTER_ANALYSIS_PROMPT = """你是一个专业的影视角色分析专家。请从以下文本中提取角色信息。

返回格式必须是JSON数组，每个角色包含：
- name: 角色名称
- description: 详细描述（外貌、性格、背景等）
- gender: 性别
- age: 年龄
- appearance: 外貌描述
- personality: 性格特点
- background: 背景故事

如果文本中没有角色信息，返回空数组。

文本内容：
{text}"""

    # 模板在 data/config/default_prompt_templates.json 中修改，此处只是防止为空
    SCENE_ANALYSIS_PROMPT = """你是一个专业的影视场景分析专家。请从以下文本中提取场景信息。

返回格式必须是JSON数组，每个场景包含：
- name: 场景名称
- description: 详细描述
- location: 地点
- time_of_day: 时间（日/夜/黄昏/黎明）
- weather: 天气（如果有）
- mood: 氛围描述

如果文本中没有场景信息，返回空数组。

文本内容：
{text}"""

    # 模板在 data/config/default_prompt_templates.json 中修改，此处只是防止为空
    PROP_ANALYSIS_PROMPT = """你是一个专业的影视道具分析专家。请从以下文本中提取道具信息。

返回格式必须是JSON数组，每个道具包含：
- name: 道具名称
- description: 详细描述
- category: 类别（如：兵器、装饰、日常用品等）
- era: 年代（如果有）

如果文本中没有道具信息，返回空数组。

文本内容：
{text}"""

    # 模板在 data/config/default_prompt_templates.json 中修改，此处只是防止为空
    SCRIPT_ANALYSIS_PROMPT = """你是一个专业的剧本分析专家。请分析以下剧本，提取结构化信息。

返回格式必须是JSON对象，包含：
- episodes: 剧集列表，每集包含：
  - episode_number: 集数
  - title: 标题（如果有）
  - script: 剧本内容
  - summary: 剧情摘要
  - characters: 出场角色列表
  - scenes: 场景列表
  - duration: 预估时长

- characters: 所有角色信息（同角色分析格式）
- scenes: 所有场景信息（同场景分析格式）
- props: 所有道具信息（同道具分析格式）

剧本内容：
{text}"""

    # 模板在 data/config/default_prompt_templates.json 中修改，此处只是防止为空
    IMAGE_PROMPT_TEMPLATE = """你是一个专业的AI绘提示词专家。根据以下资产描述，生成优化的文生图提示词。

{asset_type}描述：
{description}

要求：
1. 生成专业级的Midjourney/Stable Diffusion风格提示词
2. 包含画风、构图、光线、细节等要素
3. 用英文返回，格式为：
   - positive_prompt: 正向提示词（详细描述）
   - negative_prompt: 负向提示词（避免的内容，如：模糊、低质量等）

返回JSON格式。"""

    # 模板在 data/config/default_prompt_templates.json 中修改，此处只是防止为空
    IMAGE_EDIT_PROMPT_TEMPLATE = """你是一个专业的AI图像编辑提示词专家。根据主角色和子角色的信息，生成用于图像编辑的提示词。

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
4. 用英文返回，格式为：
   - prompt: 图像编辑提示词（描述需要做出的改变）

【输出格式】
返回JSON格式：
{{
  "prompt": "详细的英文图像编辑提示词"
}}
"""

    # 模板在 data/config/default_prompt_templates.json 中修改，此处只是防止为空
    VIDEO_PROMPT_TEMPLATE = """你是一个专业的AI视频生成提示词专家。根据以下分镜描述，生成优化的图生视频提示词。

分镜信息：
- 画面描述：{description}
- 对白：{dialogue}
- 动作：{action}
- 景别：{shot_type}
- 角度：{camera_angle}
- 角色：{characters}
- 场景：{scene}
- 道具：{props}
- 时长：{duration}秒

要求：
1. 描述画面如何运动和变化
2. 描述角色动作和表情变化
3. 描述镜头运动方式
4. 结合对白内容描述角色嘴型和情感表达
5. 用英文返回，作为video prompt

返回JSON格式：
{{
  "prompt": "视频生成提示词"
}}"""

    # 模板在 data/config/default_prompt_templates.json 中修改，此处只是防止为空
    STORYBOARD_DESC_TEMPLATE = """你是一个专业的分镜设计师。根据以下剧本片段，生成详细的分镜描述。

剧本内容：
{script}

请为这个剧本片段设计分镜，严格按照以下JSON数组格式返回（不要包含任何其他文字说明，直接返回JSON数组）：

[
  {{
    "sequence": 1,
    "description": "画面描述",
    "shot_type": "特写",
    "camera_angle": "平视",
    "action": "动作描述",
    "dialogue": "对白",
    "camera_angle": "平视"
  }}
]

注意：
1. 必须返回有效的JSON数组，不要包含markdown代码块标记
2. sequence字段必须从1开始连续递增
3. 如果剧本内容为空或无法识别，返回空数组[]
4. 只关注可以视觉化的镜头，省略纯对话或没有画面变化的部分
"""

    @staticmethod
    async def extract_characters(llm: LLMService, text: str) -> List[Dict]:
        """从文本中提取角色信息"""
        from app.services.global_prompt_service import get_group_b_template
        template = get_group_b_template("character_analysis") or PromptService.CHARACTER_ANALYSIS_PROMPT
        prompt = template.format(text=text)
        result = await llm.chat([{"role": "user", "content": prompt}])

        try:
            content = result.get("content", "")
            # 尝试提取JSON
            import re
            json_match = re.search(r'\[.*\]', content, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
        except:
            pass

        return []

    @staticmethod
    async def extract_scenes(llm: LLMService, text: str) -> List[Dict]:
        """从文本中提取场景信息"""
        from app.services.global_prompt_service import get_group_b_template
        template = get_group_b_template("scene_analysis") or PromptService.SCENE_ANALYSIS_PROMPT
        prompt = template.format(text=text)
        result = await llm.chat([{"role": "user", "content": prompt}])

        try:
            content = result.get("content", "")
            import re
            json_match = re.search(r'\[.*\]', content, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
        except:
            pass

        return []

    @staticmethod
    async def extract_props(llm: LLMService, text: str) -> List[Dict]:
        """从文本中提取道具信息"""
        from app.services.global_prompt_service import get_group_b_template
        template = get_group_b_template("prop_analysis") or PromptService.PROP_ANALYSIS_PROMPT
        prompt = template.format(text=text)
        result = await llm.chat([{"role": "user", "content": prompt}])

        try:
            content = result.get("content", "")
            import re
            json_match = re.search(r'\[.*\]', content, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
        except:
            pass

        return []

    @staticmethod
    async def analyze_script(llm: LLMService, script: str) -> Dict:
        """分析剧本，提取所有资产"""
        from app.services.global_prompt_service import get_group_b_template
        template = get_group_b_template("script_analysis") or PromptService.SCRIPT_ANALYSIS_PROMPT
        prompt = template.format(text=script)
        result = await llm.chat([{"role": "user", "content": prompt}])

        try:
            content = result.get("content", "")
            import re
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
        except:
            pass

        return {
            "episodes": [],
            "characters": [],
            "scenes": [],
            "props": []
        }

    @staticmethod
    async def generate_image_prompt(
        llm: LLMService,
        asset_type: str,
        description: str,
        custom_template: Optional[str] = None,
        language: str = "zh",
        style_suffix: str = ""
    ) -> Dict[str, str]:
        """生成图片提示词

        Args:
            llm: LLM服务实例
            asset_type: 资产类型
            description: 资产描述
            custom_template: 自定义模板（可选）
            language: 语言设置 (zh/en/auto)
            style_suffix: 全局风格后缀
        """
        # 生成语言指令
        if language == "zh":
            language_instruction = "请用中文生成提示词。"
        elif language == "en":
            language_instruction = "Please generate the prompt in English."
        else:  # auto
            language_instruction = "请根据输入内容自动选择最合适的语言生成提示词。"

        # 处理风格指令
        if style_suffix:
            style_instruction = f"必须应用以下全局风格要求：{style_suffix}"
        else:
            style_instruction = "无特殊风格要求，根据描述自由发挥。"

        # 使用自定义模板或默认模板
        template = custom_template or PromptService.IMAGE_PROMPT_TEMPLATE

        try:
            prompt = template.format(
                language_instruction=language_instruction,
                style_instruction=style_instruction,
                asset_type=asset_type,
                description=description
            )
        except KeyError:
            # 如果模板不支持新变量，回退到旧格式
            prompt = template.format(
                asset_type=asset_type,
                description=description
            )

        result = await llm.chat([{"role": "user", "content": prompt}])

        try:
            content = result.get("content", "")
            import re
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if json_match:
                data = json.loads(json_match.group())
                # 向后兼容：如果没有prompt字段，用positive_prompt作为prompt
                if "prompt" not in data and "positive_prompt" in data:
                    data["prompt"] = data["positive_prompt"]
                return data
        except:
            pass

        # 回退
        return {
            "prompt": description
        }

    @staticmethod
    async def generate_video_prompt(
        llm: LLMService,
        description: str,
        dialogue: str = "",
        action: str = "",
        shot_type: str = "",
        camera_angle: str = "",
        characters: List[str] = None,
        scene: str = "",
        props: List[str] = None,
        duration: int = 6,
        custom_template: Optional[str] = None,
        language: str = "zh",
        style_suffix: str = "",
        assets_desc: str = "",
        audios_desc: str = ""
    ) -> str:
        """生成视频提示词

        Args:
            llm: LLM服务实例
            description: 画面描述
            dialogue: 对白
            action: 动作
            shot_type: 镜头类型
            camera_angle: 镜头角度
            characters: 角色列表
            scene: 场景
            props: 道具列表
            duration: 时长
            custom_template: 自定义模板（可选）
            language: 语言设置 (zh/en/auto)
            style_suffix: 全局风格后缀
            assets_desc: 资产描述（按图编号，供模板中 {assets_desc} 使用）
        """
        characters = characters or []
        props = props or []

        # 生成语言指令
        if language == "zh":
            language_instruction = "请用中文生成提示词。"
        elif language == "en":
            language_instruction = "Please generate the prompt in English."
        else:  # auto
            language_instruction = "请根据输入内容自动选择最合适的语言生成提示词。"

        # 处理风格指令
        if style_suffix:
            style_instruction = f"必须应用以下全局风格要求：{style_suffix}"
        else:
            style_instruction = "无特殊风格要求，根据描述自由发挥。"

        # 使用自定义模板或默认模板
        template = custom_template or PromptService.VIDEO_PROMPT_TEMPLATE

        # 准备模板参数（同时支持 camera_angle 和 camera_movement 两种命名）
        camera_angle_value = camera_angle or "平视"

        try:
            prompt = template.format(
                language_instruction=language_instruction,
                style_instruction=style_instruction,
                description=description,
                dialogue=dialogue or "无",
                action=action or "无",
                shot_type=shot_type or "中景",
                camera_angle=camera_angle_value,
                camera_movement=camera_angle_value,  # 兼容旧模板
                characters=", ".join(characters) if characters else "无",
                scene=scene or "无",
                props=", ".join(props) if props else "无",
                duration=duration,
                assets_desc=assets_desc or "（无参考资产）",
                audios_desc=audios_desc or ""
            )
        except KeyError:
            # 如果模板不支持某些新变量，回退到精简格式（保留核心变量）
            prompt = template.format(
                language_instruction=language_instruction,
                style_instruction=style_instruction,
                description=description,
                dialogue=dialogue or "无",
                action=action or "无",
                shot_type=shot_type or "中景",
                camera_angle=camera_angle_value,
                camera_movement=camera_angle_value,
                characters=", ".join(characters) if characters else "无",
                scene=scene or "无",
                props=", ".join(props) if props else "无",
                duration=duration,
                assets_desc=assets_desc or "（无参考资产）"
            )

        result = await llm.chat([{"role": "user", "content": prompt}])

        try:
            content = result.get("content", "")
            import re
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if json_match:
                data = json.loads(json_match.group())
                prompt_result = data.get("prompt", description)
                # 如果模板返回数组（多段视频），序列化为 JSON 字符串
                if isinstance(prompt_result, list):
                    return json.dumps(prompt_result, ensure_ascii=False)
                return prompt_result
        except:
            pass

        return description

    @staticmethod
    async def generate_image_edit_prompt(
        llm: LLMService,
        parent_character: Dict,
        child_character: Dict,
        custom_template: Optional[str] = None
    ) -> str:
        """生成图像编辑提示词（用于子角色基于父角色形象生成图片）"""
        # 使用自定义模板或默认模板
        from app.services.global_prompt_service import get_group_b_template
        template = custom_template or get_group_b_template("image_edit_prompt") or PromptService.IMAGE_EDIT_PROMPT_TEMPLATE

        prompt = template.format(
            parent_name=parent_character.get("name", ""),
            parent_description=parent_character.get("description", ""),
            parent_gender=parent_character.get("gender", ""),
            parent_age=parent_character.get("age", ""),
            child_name=child_character.get("name", ""),
            child_description=child_character.get("description", ""),
            child_gender=child_character.get("gender", ""),
            child_age=child_character.get("age", "")
        )
        result = await llm.chat([{"role": "user", "content": prompt}])

        try:
            content = result.get("content", "")
            import re
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if json_match:
                data = json.loads(json_match.group())
                return data.get("prompt", f"Edit the character to {child_character.get('name', 'new variant')}")
        except:
            pass

        # 回退到简单提示词
        return f"Transform the character into {child_character.get('name', 'a new variant')} with these changes: {child_character.get('description', '')}"

    @staticmethod
    async def generate_storyboard_image_prompt(
        llm: LLMService,
        description: str,
        shot_type: str = "",
        action: str = "",
        camera_angle: str = "",
        custom_template: Optional[str] = None,
        language: str = "zh",
        style_suffix: str = ""
    ) -> Dict[str, str]:
        """生成分镜图片提示词（支持分镜特有的参数）

        Args:
            llm: LLM服务实例
            description: 分镜描述
            shot_type: 镜头类型
            action: 动作
            camera_angle: 镜头角度
            custom_template: 自定义模板（可选）
            language: 语言设置 (zh/en/auto)
            style_suffix: 全局风格后缀
        """
        # 生成语言指令
        if language == "zh":
            language_instruction = "请用中文生成提示词。"
        elif language == "en":
            language_instruction = "Please generate the prompt in English."
        else:  # auto
            language_instruction = "请根据输入内容自动选择最合适的语言生成提示词。"

        # 处理风格指令
        if style_suffix:
            style_instruction = f"必须应用以下全局风格要求：{style_suffix}"
        else:
            style_instruction = "无特殊风格要求，根据描述自由发挥。"

        # 使用自定义模板或默认模板
        template = custom_template or PromptService.IMAGE_PROMPT_TEMPLATE

        try:
            # 尝试使用分镜模板格式化
            prompt = template.format(
                language_instruction=language_instruction,
                style_instruction=style_instruction,
                description=description,
                shot_type=shot_type,
                action=action,
                camera_angle=camera_angle
            )
        except KeyError:
            # 如果模板不支持分镜参数，回退到通用格式
            try:
                prompt = template.format(
                    language_instruction=language_instruction,
                    style_instruction=style_instruction,
                    asset_type="storyboard",
                    description=description
                )
            except KeyError:
                # 如果模板不支持新变量，回退到最旧格式
                prompt = template.format(
                    asset_type="storyboard",
                    description=description
                )

        result = await llm.chat([{"role": "user", "content": prompt}])

        try:
            content = result.get("content", "")
            import re
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if json_match:
                data = json.loads(json_match.group())
                # 向后兼容：如果没有prompt字段，用positive_prompt作为prompt
                if "prompt" not in data and "positive_prompt" in data:
                    data["prompt"] = data["positive_prompt"]
                return data
        except:
            pass

        # 回退
        return {
            "prompt": description
        }

    @staticmethod
    async def generate_storyboard_descriptions(
        llm: LLMService,
        script: str,
        custom_template: Optional[str] = None
    ) -> List[Dict]:
        """生成分镜描述"""
        # 使用自定义模板或默认模板
        from app.services.global_prompt_service import get_group_b_template
        template = custom_template or get_group_b_template("storyboard_desc") or PromptService.STORYBOARD_DESC_TEMPLATE
        prompt = template.format(script=script)
        result = await llm.chat([{"role": "user", "content": prompt}])

        try:
            content = result.get("content", "")
            print(f"[DEBUG] generate_storyboard_descriptions - LLM response length: {len(content)}")
            print(f"[DEBUG] LLM response starts with: {content[:100]}")
            print(f"[DEBUG] LLM response ends with: {content[-100:]}")

            # 移除markdown代码块标记
            import re
            # 匹配 ```json ... ``` 或 ``` ... ```
            code_block_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', content)
            if code_block_match:
                content = code_block_match.group(1).strip()
                print(f"[DEBUG] Extracted from code block, length: {len(content)}")

            # 直接尝试解析整个内容
            try:
                parsed = json.loads(content)
                print(f"[DEBUG] Successfully parsed JSON, type: {type(parsed)}, length: {len(parsed) if isinstance(parsed, list) else 'N/A'}")
                return parsed
            except json.JSONDecodeError as e:
                print(f"[ERROR] JSON decode failed: {e}")
                print(f"[DEBUG] Attempting to extract JSON array with regex...")

                # 作为回退方案，尝试查找 JSON 数组（使用贪婪匹配）
                json_match = re.search(r'\[([\s\S]*)\]', content)
                if json_match:
                    extracted = '[' + json_match.group(1) + ']'
                    print(f"[DEBUG] Extracted JSON length: {len(extracted)}")
                    print(f"[DEBUG] Extracted JSON preview: {extracted[:200]}...")
                    try:
                        parsed = json.loads(extracted)
                        print(f"[DEBUG] Successfully parsed extracted JSON, length: {len(parsed)}")
                        return parsed
                    except json.JSONDecodeError as e2:
                        print(f"[ERROR] Failed to parse extracted JSON: {e2}")

            print(f"[WARNING] No valid JSON found in response")
            print(f"[DEBUG] Full content for inspection: {content[:500]}...")
            return []

        except Exception as e:
            print(f"[ERROR] Unexpected error: {str(e)}")
            import traceback
            traceback.print_exc()
            return []

    @staticmethod
    async def generate_nine_grid_combined_prompts(
        llm,
        description: str,
        episode_script: str,
        assets_desc: str,
        language: str = "zh",
        style_suffix: str = "",
        ai_config: Optional[dict] = None
    ) -> Dict:
        """一次LLM调用生成九宫格分镜的图片提示词和视频提示词"""
        from app.services.global_prompt_service import get_prompt_content
        template = get_prompt_content("nine_grid_combined_prompts", ai_config)

        if language == "zh":
            language_instruction = "请使用中文生成所有提示词内容"
        elif language == "en":
            language_instruction = "Please generate all prompt content in English"
        else:
            language_instruction = "请根据输入内容自动选择最合适的语言生成提示词"

        if style_suffix:
            style_instruction = f"必须应用以下全局风格要求：{style_suffix}"
        else:
            style_instruction = "无特殊风格要求，根据描述自由发挥"

        prompt = template.format(
            description=description,
            episode_script=episode_script,
            assets_desc=assets_desc,
            language_instruction=language_instruction,
            style_instruction=style_instruction
        )
        result = await llm.chat([{"role": "user", "content": prompt}])

        try:
            content = result.get("content", "")
            import re
            code_block_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', content)
            if code_block_match:
                content = code_block_match.group(1).strip()
            data = json.loads(content)
            video_prompt = data.get("video_prompt", [])
            if isinstance(video_prompt, str):
                video_prompt = [video_prompt] if video_prompt else []
            return {
                "image_prompt": data.get("image_prompt", ""),
                "video_prompt": video_prompt
            }
        except Exception as e:
            print(f"[ERROR] generate_nine_grid_combined_prompts parse failed: {e}")
            return {"image_prompt": "", "video_prompt": []}

    # 模板在 data/config/default_prompt_templates.json 中修改，此处只是防止为空
    VIDEO_REVERSE_PROMPT_TEMPLATE = """你是一位专业的AI视频生成提示词专家，擅长根据图片反推视频生成提示词。

【任务】
根据提供的图片和分镜信息，反推生成适合视频生成的英文提示词。

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
3. 全英文，使用现在进行时
4. 使用专业影视术语

【输出格式】
返回JSON格式：
{{
  "prompt": "完整的英文视频生成提示词"
}}"""

    @staticmethod
    async def generate_video_reverse_prompt(
        vlm: LLMService,
        image_base64: str,
        description: str,
        dialogue: str = "",
        action: str = "",
        shot_type: str = "",
        camera_angle: str = "",
        characters: List[str] = None,
        scene: str = "",
        props: List[str] = None,
        duration: int = 6,
        custom_template: Optional[str] = None
    ) -> str:
        """使用VLM反推视频提示词（根据图片+分镜信息）"""
        characters = characters or []
        props = props or []

        # 使用自定义模板或默认模板
        template = custom_template or PromptService.VIDEO_REVERSE_PROMPT_TEMPLATE

        # 准备模板参数
        camera_angle_value = camera_angle or "平视"
        text_prompt = template.format(
            description=description,
            dialogue=dialogue or "无",
            action=action or "无",
            shot_type=shot_type or "中景",
            camera_angle=camera_angle_value,
            camera_movement=camera_angle_value,
            characters=", ".join(characters) if characters else "无",
            scene=scene or "无",
            props=", ".join(props) if props else "无",
            duration=duration
        )

        # 构建多模态消息（图片+文本）
        messages = [{
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": image_base64  # data:image/jpeg;base64,...
                    }
                },
                {
                    "type": "text",
                    "text": text_prompt
                }
            ]
        }]

        result = await vlm.chat(messages)

        try:
            content = result.get("content", "")
            import re
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if json_match:
                data = json.loads(json_match.group())
                return data.get("prompt", description)
        except:
            pass

        return description

    @staticmethod
    @staticmethod
    async def call_vlm_with_images(
        vlm: LLMService,
        system_prompt: str,
        image_base64_list: List[str],
        user_text: str = "请分析这些图片："
    ) -> str:
        """通用VLM图片分析方法

        Args:
            vlm: VLM服务实例
            system_prompt: 系统提示词（已填充user_goal等占位符）
            image_base64_list: 图片base64列表（data:image/...格式）
            user_text: 用户消息文本（可选）

        Returns:
            VLM分析结果
        """
        # 构建用户消息内容
        user_content = [{"type": "text", "text": user_text}]

        # 添加所有图片
        for img_base64 in image_base64_list:
            user_content.append({
                "type": "image_url",
                "image_url": {"url": img_base64}
            })

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content}
        ]

        result = await vlm.chat(messages)

        # 统一的返回值处理
        content = result.get("content", "")
        return content.strip()

    # 模板在 data/config/default_prompt_templates.json 中修改，此处只是防止为空
    AUTO_MATCH_ASSETS_PROMPT = """你是一个专业的影视分镜资产匹配专家。根据分镜描述、剧集剧本和资产库，智能匹配最适合的资产。

【分镜信息】
画面描述：{storyboard_description}
对白：{storyboard_dialogue}
动作：{storyboard_action}

【剧集剧本】（如果有）
{episode_script}

【可用资产】

角色列表：
{characters_list}

场景列表：
{scenes_list}

道具列表：
{props_list}

【匹配规则】
1. 场景最多选择1个（scene_id）
2. 角色和道具总共不超过3个（character_ids + prop_ids）
3. 总计不超过4个资产
4. 按照重要性排序
5. 只选择真正需要的资产，不要过度匹配

【输出格式】
返回JSON格式：
{{
  "scene_id": "场景ID（如无则为空字符串）",
  "character_ids": ["角色ID1", "角色ID2"],
  "prop_ids": ["道具ID1"],
  "explanation": "匹配理由（简短说明为什么选择这些资产）"
}}

注意：
- 必须返回有效的JSON格式
- ID必须从提供的资产列表中选择
- 如果没有合适的资产，对应字段返回空数组或空字符串
- 优先匹配剧本中明确提到的资产
"""

    @staticmethod
    async def auto_match_storyboard_assets(
        llm: LLMService,
        storyboard_description: str,
        storyboard_dialogue: str = "",
        storyboard_action: str = "",
        episode_script: str = "",
        characters: List[Dict] = None,
        scenes: List[Dict] = None,
        props: List[Dict] = None
    ) -> Dict:
        """自动匹配分镜资产

        Args:
            llm: LLM服务实例
            storyboard_description: 分镜描述
            storyboard_dialogue: 对白
            storyboard_action: 动作
            episode_script: 剧集剧本
            characters: 角色列表
            scenes: 场景列表
            props: 道具列表

        Returns:
            匹配结果 {"scene_id": str, "character_ids": [str], "prop_ids": [str], "explanation": str}
        """
        characters = characters or []
        scenes = scenes or []
        props = props or []

        # 构建资产列表文本
        def format_assets(assets: List[Dict], asset_type: str) -> str:
            if not assets:
                return "（无）"
            lines = []
            for asset in assets:
                asset_id = asset.get("asset_id", "")
                name = asset.get("name", "")
                description = asset.get("description", "")
                lines.append(f"- ID: {asset_id}, 名称: {name}, 描述: {description}")
            return "\n".join(lines)

        characters_list = format_assets(characters, "character")
        scenes_list = format_assets(scenes, "scene")
        props_list = format_assets(props, "prop")

        # 构建提示词
        from app.services.global_prompt_service import get_group_b_template
        _template = get_group_b_template("auto_match_assets") or PromptService.AUTO_MATCH_ASSETS_PROMPT
        prompt = _template.format(
            storyboard_description=storyboard_description or "无",
            storyboard_dialogue=storyboard_dialogue or "无",
            storyboard_action=storyboard_action or "无",
            episode_script=episode_script or "无",
            characters_list=characters_list,
            scenes_list=scenes_list,
            props_list=props_list
        )

        # 调用LLM
        result = await llm.chat([{"role": "user", "content": prompt}])

        try:
            content = result.get("content", "")
            import re
            # 提取JSON
            json_match = re.search(r'\{[\s\S]*\}', content)
            if json_match:
                data = json.loads(json_match.group())
                # 验证和清理数据
                return {
                    "scene_id": data.get("scene_id", ""),
                    "character_ids": data.get("character_ids", []),
                    "prop_ids": data.get("prop_ids", []),
                    "explanation": data.get("explanation", "")
                }
        except Exception as e:
            print(f"[ERROR] Failed to parse auto-match result: {e}")
            pass

        # 如果解析失败，返回空结果
        return {
            "scene_id": "",
            "character_ids": [],
            "prop_ids": [],
            "explanation": "匹配失败"
        }
