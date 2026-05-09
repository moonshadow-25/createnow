"""所有工具的 JSON Schema 定义"""

TOOLS = [
    {
        "name": "create_character",
        "description": "创建角色资产。当用户描述角色或剧本中出现新角色时调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "角色名称"},
                "description": {"type": "string", "description": "角色详细描述"},
                "gender": {"type": "string", "description": "性别"},
                "age": {"type": "string", "description": "年龄"},
                "appearance": {"type": "string", "description": "外貌描述"},
                "personality": {"type": "string", "description": "性格特点"},
                "background": {"type": "string", "description": "背景故事"},
                "image_prompt": {"type": "string", "description": "角色图片生成提示词（中文），包含完整外貌/服装/颜色/风格描述，融入全局图片风格"}
            },
            "required": ["name", "description"]
        }
    },
    {
        "name": "update_character",
        "description": "更新现有角色的信息。当用户要求修改、完善或补充角色信息时调用。⚠️ 必须先调用 get_asset 读取该角色的当前完整信息，再在原有内容基础上做修改，不得凭空覆盖。需要提供角色名称或asset_id。",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "角色名称（用于查找）"},
                "asset_id": {"type": "string", "description": "资产ID（如果提供则直接使用）"},
                "description": {"type": "string", "description": "新的角色描述"},
                "gender": {"type": "string", "description": "性别"},
                "age": {"type": "string", "description": "年龄"},
                "appearance": {"type": "string", "description": "外貌描述"},
                "personality": {"type": "string", "description": "性格特点"},
                "background": {"type": "string", "description": "背景故事"},
                "image_prompt": {"type": "string", "description": "角色图片生成提示词（中文），包含完整外貌/服装/颜色/风格描述，融入全局图片风格"}
            },
            "required": []
        }
    },
    {
        "name": "create_scene",
        "description": "创建场景资产。当用户描述场景或剧本中出现新场景时调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "场景名称"},
                "description": {"type": "string", "description": "场景详细描述"},
                "location": {"type": "string", "description": "地点"},
                "time_of_day": {"type": "string", "description": "时间（日/夜/黄昏/黎明）"},
                "weather": {"type": "string", "description": "天气"},
                "mood": {"type": "string", "description": "氛围"},
                "image_prompt": {"type": "string", "description": "场景图片生成提示词（中文），包含完整环境/光线/氛围/风格描述，融入全局图片风格"}
            },
            "required": ["name", "description", "location"]
        }
    },
    {
        "name": "update_scene",
        "description": "更新现有场景的信息。当用户要求修改、完善或补充场景信息时调用。⚠️ 必须先调用 get_asset 读取该场景的当前完整信息，再在原有内容基础上做修改，不得凭空覆盖。需要提供场景名称或asset_id。",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "场景名称（用于查找）"},
                "asset_id": {"type": "string", "description": "资产ID（如果提供则直接使用）"},
                "description": {"type": "string", "description": "新的场景描述"},
                "location": {"type": "string", "description": "地点"},
                "time_of_day": {"type": "string", "description": "时间"},
                "weather": {"type": "string", "description": "天气"},
                "mood": {"type": "string", "description": "氛围"},
                "image_prompt": {"type": "string", "description": "场景图片生成提示词（中文），包含完整环境/光线/氛围/风格描述，融入全局图片风格"}
            },
            "required": []
        }
    },
    {
        "name": "create_prop",
        "description": "创建道具资产。仅当道具与剧情强烈相关时调用（不要提取无关道具）。",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "道具名称"},
                "description": {"type": "string", "description": "道具详细描述"},
                "category": {"type": "string", "description": "类别（兵器/装饰/日常用品等）"},
                "era": {"type": "string", "description": "年代"},
                "image_prompt": {"type": "string", "description": "道具图片生成提示词（中文），包含完整外观/材质/颜色/风格描述，融入全局图片风格"}
            },
            "required": ["name", "description"]
        }
    },
    {
        "name": "update_prop",
        "description": "更新现有道具的信息。当用户要求修改、完善或补充道具信息时调用。⚠️ 必须先调用 get_asset 读取该道具的当前完整信息，再在原有内容基础上做修改，不得凭空覆盖。需要提供道具名称或asset_id。",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "道具名称（用于查找）"},
                "asset_id": {"type": "string", "description": "资产ID（如果提供则直接使用）"},
                "description": {"type": "string", "description": "新的道具描述"},
                "category": {"type": "string", "description": "类别"},
                "era": {"type": "string", "description": "年代"},
                "image_prompt": {"type": "string", "description": "道具图片生成提示词（中文），包含完整外观/材质/颜色/风格描述，融入全局图片风格"}
            },
            "required": []
        }
    },
    {
        "name": "create_storyboard",
        "description": "创建单个分镜（视频段落）。每个分镜是一段独立的15秒视频，由video_prompt驱动。需要指定所属的剧集ID。",
        "parameters": {
            "type": "object",
            "properties": {
                "episode_id": {"type": "string", "description": "所属剧集的ID"},
                "plan_id": {"type": "string", "description": "自动生成/重新生成流程的规划标签；由 estimate_storyboard_plan 返回，手工创建可不传"},
                "sequence": {"type": "integer", "description": "分镜序号"},
                "script_scene_label": {"type": "string", "description": "剧本中的场次行原文。若剧本存在场次结构，则该字段必填"},
                "description_start_text": {"type": "string", "description": "当前场正文中的起始锚点原文，必须来自正文本体，不得使用场次行或出场人物行；若命中不唯一应继续扩展直到唯一"},
                "description_end_text": {"type": "string", "description": "当前场正文中的结束锚点原文，必须来自正文本体，不得使用场次行或出场人物行；若命中不唯一应继续扩展直到唯一"},
                "video_prompt": {"type": "string", "description": "Seedance 2.0格式的视频提示词。@图N编号规则（严格执行）：按character_ids数组顺序依次编为@图1、@图2...，scene_ids紧接所有角色之后继续编号，prop_ids再接其后。"},
                "duration": {"type": "integer", "description": "视频时长（秒），默认15秒"},
                "character_ids": {"type": "array", "items": {"type": "string"}, "description": "出场角色ID列表（可选）"},
                "scene_ids": {"type": "array", "items": {"type": "string"}, "description": "场景ID列表（可选）"},
                "scene_id": {"type": "string", "description": "场景ID（兼容旧版，优先使用scene_ids）"},
                "prop_ids": {"type": "array", "items": {"type": "string"}, "description": "道具ID列表（可选）"},
                "action": {"type": "string", "description": "动作描述（可选，新版已弃用）"},
                "dialogue": {"type": "string", "description": "对白（可选，新版已弃用）"},
                "camera_angle": {"type": "string", "description": "镜头角度（可选，新版已弃用）"},
                "shot_type": {"type": "string", "description": "镜头类型（可选，新版已弃用）"},
                "dialogue_units": {"type": "array", "items": {"type": "string"}, "description": "AI上报的对白原文数组（逐条）"},
                "dialogue_chars_declared": {"type": "integer", "description": "AI上报的对白总字数（去空白后）"},
                "short_dialogue_reason": {"type": "string", "description": "当对白偏短时的原因说明（建议填写）", "enum": ["REACTION_SHOT", "TIMECODE_CONSTRAINT", "SOURCE_TEXT_SHORT", "SCENE_BOUNDARY_CONSTRAINT"]},
                "short_dialogue_time_evidence": {"type": "string", "description": "仅当 short_dialogue_reason=TIMECODE_CONSTRAINT 时必填：剧本中包含时间数字的原文片段（如'站着不动3秒'）"},
                "suggested_dialogue_chars": {"type": "integer", "description": "自动生成/重新生成流程中必须显式传入：对白建议字数，且必须等于 estimate_storyboard_plan 返回的 suggested_dialogue_chars_per_storyboard；手工创建可不传"},
                "suggested_dialogue_tolerance": {"type": "integer", "description": "建议字数浮动范围，默认20"}
            },
            "required": ["episode_id", "sequence", "dialogue_units", "dialogue_chars_declared"]
        }
    },
    {
        "name": "update_storyboard",
        "description": "更新现有分镜的信息。当用户要求修改、完善或补充分镜信息时调用。⚠️ 必须先调用 get_storyboard 读取该分镜的当前完整信息（包括 description、video_prompt、image_prompt），再在原有内容基础上做修改，不得凭空覆盖。必须提供 storyboard_id 或同时提供 episode_id 和 sequence。\n\n🚫 严禁擅自更新 description：仅当用户明确要求\"修改描述\"\"更新描述\"\"改一下描述\"等时才可传入 description 字段。以下场景绝对不要传 description：生成/修改 video_prompt、生成/修改 image_prompt、匹配/调整角色(character_ids)、匹配/调整场景(scene_ids)、匹配/调整道具(prop_ids)、修改对白/动作/镜头参数。",
        "parameters": {
            "type": "object",
            "properties": {
                "storyboard_id": {"type": "string", "description": "分镜ID（如果提供则直接使用）"},
                "episode_id": {"type": "string", "description": "所属剧集ID（用于查找）"},
                "sequence": {"type": "integer", "description": "镜头序号（用于查找）"},
                "description": {"type": "string", "description": "新的画面描述"},
                "script_scene_label": {"type": "string", "description": "剧本中的场次行原文。若剧本存在场次结构，更新分镜时应保持该字段填写正确"},
                "video_prompt": {"type": "string", "description": "Seedance 2.0格式的视频提示词。"},
                "duration": {"type": "integer", "description": "视频时长（秒）"},
                "character_ids": {"type": "array", "items": {"type": "string"}, "description": "角色ID列表"},
                "scene_ids": {"type": "array", "items": {"type": "string"}, "description": "场景ID列表"},
                "scene_id": {"type": "string", "description": "场景ID（兼容旧版）"},
                "prop_ids": {"type": "array", "items": {"type": "string"}, "description": "道具ID列表"},
                "action": {"type": "string", "description": "动作描述（可选）"},
                "dialogue": {"type": "string", "description": "对白（可选）"},
                "camera_angle": {"type": "string", "description": "镜头角度（可选）"},
                "shot_type": {"type": "string", "description": "镜头类型（可选）"},
                "dialogue_units": {"type": "array", "items": {"type": "string"}, "description": "AI上报的对白原文数组（逐条）"},
                "dialogue_chars_declared": {"type": "integer", "description": "AI上报的对白总字数（去空白后）"},
                "short_dialogue_reason": {"type": "string", "description": "当对白偏短时的原因说明（建议填写）", "enum": ["REACTION_SHOT", "TIMECODE_CONSTRAINT", "SOURCE_TEXT_SHORT", "SCENE_BOUNDARY_CONSTRAINT"]},
                "short_dialogue_time_evidence": {"type": "string", "description": "仅当 short_dialogue_reason=TIMECODE_CONSTRAINT 时必填：剧本中包含时间数字的原文片段（如'站着不动3秒'）"}
            },
            "required": []
        }
    },
    {
        "name": "delete_storyboard",
        "description": "删除指定的分镜。当用户要求删除、移除某个分镜时调用。若分镜已有视频提示词，必须传入confirmed=true才能删除（先告知用户再确认）。",
        "parameters": {
            "type": "object",
            "properties": {
                "storyboard_id": {"type": "string", "description": "要删除的分镜ID"},
                "episode_id": {"type": "string", "description": "所属剧集ID（用于查找）"},
                "sequence": {"type": "integer", "description": "镜头序号（用于查找）"},
                "confirmed": {"type": "boolean", "description": "用户是否已确认删除（默认false）。若分镜有内容，必须传true"}
            },
            "required": []
        }
    },
    {
        "name": "delete_all_storyboards",
        "description": "删除指定剧集的全部分镜（一次确认，原子操作）。⚠️ 重新生成分镜前必须先调用此工具清空旧分镜，而不是逐个调用 delete_storyboard。需要传入 confirmed=true 才会执行。",
        "parameters": {
            "type": "object",
            "properties": {
                "episode_id": {"type": "string", "description": "剧集ID（UUID格式）"},
                "confirmed": {"type": "boolean", "description": "用户是否已确认删除全部分镜（默认false）。必须传true才会执行删除"},
                "description": {"type": "string", "description": "向用户说明此次操作的意义（显示在确认弹窗中），如'清空第1集全部分镜，准备重新生成'"}
            },
            "required": ["episode_id"]
        }
    },
    {
        "name": "insert_storyboard",
        "description": "在指定位置插入新分镜，自动将该位置及之后的分镜序号依次后移。这是拆分分镜时必须使用的工具。",
        "parameters": {
            "type": "object",
            "properties": {
                "episode_id": {"type": "string", "description": "所属剧集的asset_id（必须是UUID格式的ID，不要用集数名称如'第2集'）"},
                "insert_at_sequence": {"type": "integer", "description": "插入位置（在这个序号前插入，插入后的新分镜使用此序号）"},
                "description": {"type": "string", "description": "分镜画面描述（可选，新版主要使用video_prompt）"},
                "script_scene_label": {"type": "string", "description": "剧本中的场次行原文。若剧本存在场次结构，则该字段必填，description 中不得再重复场次行"},
                "video_prompt": {"type": "string", "description": "Seedance 2.0格式的视频提示词。"},
                "duration": {"type": "integer", "description": "视频时长（秒），默认15秒"},
                "character_ids": {"type": "array", "items": {"type": "string"}, "description": "出场角色ID列表（可选）"},
                "scene_ids": {"type": "array", "items": {"type": "string"}, "description": "场景ID列表（可选）"},
                "scene_id": {"type": "string", "description": "场景ID（兼容旧版）"},
                "prop_ids": {"type": "array", "items": {"type": "string"}, "description": "道具ID列表（可选）"},
                "action": {"type": "string", "description": "动作描述（可选）"},
                "dialogue": {"type": "string", "description": "对白（可选）"},
                "camera_angle": {"type": "string", "description": "镜头角度（可选）"},
                "shot_type": {"type": "string", "description": "镜头类型（可选）"},
                "dialogue_units": {"type": "array", "items": {"type": "string"}, "description": "AI上报的对白原文数组（逐条）"},
                "dialogue_chars_declared": {"type": "integer", "description": "AI上报的对白总字数（去空白后）"},
                "short_dialogue_reason": {"type": "string", "description": "当对白偏短时的原因说明（建议填写）", "enum": ["REACTION_SHOT", "TIMECODE_CONSTRAINT", "SOURCE_TEXT_SHORT", "SCENE_BOUNDARY_CONSTRAINT"]},
                "short_dialogue_time_evidence": {"type": "string", "description": "仅当 short_dialogue_reason=TIMECODE_CONSTRAINT 时必填：剧本中包含时间数字的原文片段（如'站着不动3秒'）"}
            },
            "required": ["episode_id", "insert_at_sequence", "dialogue_units", "dialogue_chars_declared"]
        }
    },
    {
        "name": "list_all_assets",
        "description": "获取当前项目所有资产（角色、场景、道具、剧集）的摘要列表。当需要了解项目现有资产时调用。",
        "parameters": {"type": "object", "properties": {}, "required": []}
    },
    {
        "name": "get_episode_storyboards",
        "description": "获取指定剧集的完整分镜列表，包含每个分镜的描述、提示词、时长、关联资产等信息。",
        "parameters": {
            "type": "object",
            "properties": {
                "episode_id": {"type": "string", "description": "剧集ID（UUID格式）"}
            },
            "required": ["episode_id"]
        }
    },
    {
        "name": "list_assets",
        "description": "列出指定类型的所有资产。当用户询问有哪些角色、场景、道具或剧集时调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "asset_type": {"type": "string", "description": "资产类型：character（角色）、scene（场景）、prop（道具）、episode（剧集）"}
            },
            "required": ["asset_type"]
        }
    },
    {
        "name": "get_asset",
        "description": "获取单个资产的详细信息。当用户询问某个具体资产的详情时调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "asset_type": {"type": "string", "description": "资产类型：character、scene、prop、episode"},
                "asset_id": {"type": "string", "description": "资产ID（优先使用）"},
                "name": {"type": "string", "description": "资产名称（如果没有ID则用名称查找）"}
            },
            "required": ["asset_type"]
        }
    },
    {
        "name": "list_storyboards",
        "description": "列出指定剧集的所有分镜。当用户询问某集有多少分镜、分镜列表时调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "episode_id": {"type": "string", "description": "剧集ID"}
            },
            "required": ["episode_id"]
        }
    },
    {
        "name": "get_storyboard",
        "description": "获取单个分镜的详细信息。必须提供 storyboard_id，或同时提供 episode_id + sequence 两个字段才能定位分镜；只传 sequence 无法查询。",
        "parameters": {
            "type": "object",
            "properties": {
                "storyboard_id": {"type": "string", "description": "分镜ID（优先使用，有此字段可不填episode_id和sequence）"},
                "episode_id": {"type": "string", "description": "剧集ID（按序号查找时必填，需配合sequence一起使用）"},
                "sequence": {"type": "integer", "description": "分镜序号（按序号查找时必填，需配合episode_id一起使用）"}
            },
            "required": []
        }
    },
    {
        "name": "get_project_config",
        "description": "读取项目的全局配置，包括视频风格、图片风格、提示词语言等。在修改配置前应先调用此工具了解当前值。",
        "parameters": {"type": "object", "properties": {}, "required": []}
    },
    {
        "name": "get_ai_instructions",
        "description": "读取当前项目的AI自定义指令（类似CLAUDE.md）。在修改指令前应先调用此工具查看现有内容。",
        "parameters": {"type": "object", "properties": {}, "required": []}
    },
    {
        "name": "get_prompt_template",
        "description": "读取某个生成模板的当前内容。⚠️ 仅用于修改模板前先读取现有内容（配合 update_prompt_template 使用），生成内容时禁止调用此工具——格式规范已在系统提示词中。返回值包含 content（模板全文）和 variables（变量占位符列表）。",
        "parameters": {
            "type": "object",
            "properties": {
                "key": {
                    "type": "string",
                    "description": "模板key。中文对照：分镜图生图（图生图）→storyboard_image_edit，分镜图文生图→storyboard_image，分镜视频提示词→video，资产图片提示词（角色/场景/道具）→image",
                    "enum": ["storyboard_image_edit", "storyboard_image", "video", "image"]
                }
            },
            "required": ["key"]
        }
    },
    {
        "name": "update_project_config",
        "description": "修改项目全局配置的指定字段。此操作会持久化，对所有后续操作生效，需要用户确认后才执行。",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "配置路径。修改全局风格（视频+图片同时改）用 global_style；只改视频用 video_style.custom_suffix；只改图片用 image_style.custom_suffix；改提示词语言用 prompt_language",
                    "enum": ["global_style", "video_style.custom_suffix", "image_style.custom_suffix", "prompt_language"]
                },
                "value": {"description": "新值"},
                "description": {"type": "string", "description": "向用户说明这次修改的意义（将显示在确认弹窗中）"}
            },
            "required": ["path", "value", "description"]
        }
    },
    {
        "name": "update_ai_instructions",
        "description": "写入或追加项目级AI自定义指令（类似CLAUDE.md，会注入到每次对话的系统提示末尾）。此操作持久化且影响所有后续对话，需要用户确认。⚠️ replace模式前必须先调用 get_ai_instructions 读取现有指令，在原有内容基础上修改，不得凭空覆盖。",
        "parameters": {
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "Markdown格式的指令内容"},
                "mode": {"type": "string", "description": "replace（完整替换，默认）或 append（追加到现有指令末尾）"},
                "description": {"type": "string", "description": "向用户说明这次修改的意义（将显示在确认弹窗中）"}
            },
            "required": ["content", "description"]
        }
    },
    {
        "name": "update_prompt_template",
        "description": "更新某个生成模板并激活'AI自定义'模板。必须先调用 get_prompt_template 读取当前激活模板。默认 patch 模式支持一次调用批量 edits（推荐，一次确认即可），仅当用户明确要求整篇重写时才用 replace 模式。此操作持久化，需要用户确认。",
        "parameters": {
            "type": "object",
            "properties": {
                "key": {
                    "type": "string",
                    "description": "模板key。中文对照：分镜图生图（图生图）→storyboard_image_edit，分镜图文生图→storyboard_image，分镜视频提示词→video，资产图片提示词（角色/场景/道具）→image",
                    "enum": ["storyboard_image_edit", "storyboard_image", "video", "image"]
                },
                "mode": {"type": "string", "description": "更新模式：patch（默认，局部编辑）或 replace（整篇替换）", "enum": ["patch", "replace"]},
                "edits": {
                    "type": "array",
                    "description": "patch 推荐：批量替换步骤，按顺序应用。每项支持 old_string/new_string/replace_all/occurrence。提供 edits 时优先使用 edits。",
                    "items": {
                        "type": "object",
                        "properties": {
                            "old_string": {"type": "string", "description": "要匹配的原文片段"},
                            "new_string": {"type": "string", "description": "替换后的文本；删除时传空字符串"},
                            "replace_all": {"type": "boolean", "description": "是否替换全部命中，默认 false"},
                            "occurrence": {"type": "integer", "description": "replace_all=false 且命中多处时可指定替换第几处（从1开始）"}
                        },
                        "required": ["old_string", "new_string"]
                    }
                },
                "operation": {"type": "string", "description": "patch 单步操作类型：replace_text（替换）、delete_text（删除）、insert_after_anchor（在锚点后插入）、insert_before_anchor（在锚点前插入）", "enum": ["replace_text", "delete_text", "insert_after_anchor", "insert_before_anchor"]},
                "old_string": {"type": "string", "description": "单步 patch 时使用：要匹配的原文片段；也可作为 insert 操作的后备锚点"},
                "new_string": {"type": "string", "description": "单步 patch 的替换/插入文本，delete_text 可留空"},
                "anchor": {"type": "string", "description": "insert_* 操作推荐提供：唯一锚点文本（优先于 old_string）"},
                "replace_all": {"type": "boolean", "description": "单步 replace_text/delete_text 可选：是否替换全部命中，默认 false"},
                "occurrence": {"type": "integer", "description": "单步 replace_all=false 且命中多处时可指定替换第几处（从1开始）"},
                "normalize_punctuation": {"type": "boolean", "description": "patch 后是否自动清理重复标点（默认 true）"},
                "content": {"type": "string", "description": "replace 模式必填：完整模板内容（Markdown）"},
                "description": {"type": "string", "description": "向用户说明这次修改的意义（将显示在确认弹窗中）"}
            },
            "required": ["key", "description"]
        }
    },
    {
        "name": "get_episode_script",
        "description": "读取当前剧集的完整剧本内容。当用户提到剧本有变化、需要按剧本操作、修改剧本、或任何涉及剧情内容的操作前，必须先调用此工具读取最新剧本，禁止向用户索要剧本内容。",
        "parameters": {
            "type": "object",
            "properties": {
                "episode_id": {"type": "string", "description": "剧集ID，使用系统提示中注入的当前 episode_id"}
            },
            "required": ["episode_id"]
        }
    },
    {
        "name": "estimate_storyboard_plan",
        "description": "在自动生成或重新生成分镜前，使用LLM对当前剧本进行显式规划，返回plan_id和分镜建议字数。手工单镜头创建不要调用此工具。",
        "parameters": {
            "type": "object",
            "properties": {
                "episode_id": {"type": "string", "description": "剧集ID（UUID格式，工具内部会据此读取完整剧本）"}
            },
            "required": ["episode_id"]
        }
    },
    {
        "name": "update_episode_script",
        "description": "写入或追加剧集的剧本内容。当用户希望AI创作或修改剧本时调用。⚠️ replace模式前必须先调用 get_episode_script 读取现有剧本内容，在原有内容基础上修改，不得凭空覆盖。",
        "parameters": {
            "type": "object",
            "properties": {
                "episode_id": {"type": "string", "description": "剧集的asset_id（UUID格式）"},
                "script": {"type": "string", "description": "剧本内容"},
                "mode": {"type": "string", "description": "replace（完整替换，默认）或 append（追加到现有剧本末尾）"}
            },
            "required": ["episode_id", "script"]
        }
    },
    {
        "name": "generate_asset_image",
        "description": "为单个角色/场景/道具资产生成图片。资产必须已有 image_prompt。需要用户确认后执行。",
        "parameters": {
            "type": "object",
            "properties": {
                "asset_type": {"type": "string", "description": "资产类型：character、scene、prop"},
                "asset_id": {"type": "string", "description": "资产ID"},
                "description": {"type": "string", "description": "向用户说明此次生图的意义（显示在确认弹窗中）"}
            },
            "required": ["asset_type", "asset_id", "description"]
        }
    },
    {
        "name": "generate_all_asset_images",
        "description": "批量为所有角色/场景/道具资产生成图片（跳过无 image_prompt 的资产）。需要用户确认后执行。",
        "parameters": {
            "type": "object",
            "properties": {
                "asset_types": {"type": "array", "items": {"type": "string"}, "description": "要生图的资产类型列表，默认 [\"character\", \"scene\", \"prop\"]"},
                "description": {"type": "string", "description": "向用户说明此次批量生图的意义（显示在确认弹窗中）"}
            },
            "required": ["description"]
        }
    },
    {
        "name": "generate_storyboard_image",
        "description": "为单个分镜生成图片（图生图，使用关联角色/场景的主图作为参考）。分镜必须已有 image_prompt 且关联资产有主图。需要用户确认后执行。",
        "parameters": {
            "type": "object",
            "properties": {
                "storyboard_id": {"type": "string", "description": "分镜ID"},
                "description": {"type": "string", "description": "向用户说明此次生图的意义（显示在确认弹窗中）"}
            },
            "required": ["storyboard_id", "description"]
        }
    },
    {
        "name": "generate_storyboard_video_prompt_subagent",
        "description": "独立子代生成：仅处理单个分镜并保存 video_prompt，强制校验 @图N 与分镜资产顺序一致。批量时请在同一轮发起多个该工具调用（每次一个 storyboard_id）。执行时无需确认。",
        "parameters": {
            "type": "object",
            "properties": {
                "storyboard_id": {"type": "string", "description": "分镜ID（单次仅支持一个）"},
                "storyboard_description": {"type": "string", "description": "可选：覆盖分镜 description 参与本次生成（不写回 description）"},
                "dialogue": {"type": "string", "description": "可选：覆盖分镜 dialogue 参与本次生成"},
                "action": {"type": "string", "description": "可选：覆盖分镜 action 参与本次生成"},
                "shot_type": {"type": "string", "description": "可选：覆盖分镜 shot_type 参与本次生成"},
                "camera_angle": {"type": "string", "description": "可选：覆盖分镜 camera_angle 参与本次生成"},
                "duration": {"type": "integer", "description": "可选：覆盖分镜 duration 参与本次生成"},
                "character_ids": {"type": "array", "items": {"type": "string"}, "description": "可选：覆盖本次生成的角色顺序"},
                "scene_ids": {"type": "array", "items": {"type": "string"}, "description": "可选：覆盖本次生成的场景顺序"},
                "prop_ids": {"type": "array", "items": {"type": "string"}, "description": "可选：覆盖本次生成的道具顺序"},
                "description": {"type": "string", "description": "向用户说明此次生成意义（显示在确认弹窗中）"}
            },
            "required": ["storyboard_id"]
        }
    },
    {
        "name": "generate_storyboard_video",
        "description": "为单个分镜生成视频。分镜必须已有 video_prompt 且关联资产有主图。需要用户确认后执行。",
        "parameters": {
            "type": "object",
            "properties": {
                "storyboard_id": {"type": "string", "description": "分镜ID"},
                "episode_id": {"type": "string", "description": "所属剧集ID（可选，优先从分镜数据中读取）"},
                "description": {"type": "string", "description": "向用户说明此次生视频的意义（显示在确认弹窗中）"}
            },
            "required": ["storyboard_id", "description"]
        }
    },
    {
        "name": "generate_all_storyboard_images",
        "description": "批量为某集（或全部）分镜生成图片。跳过无 image_prompt 或关联资产无主图的分镜。需要用户确认后执行。",
        "parameters": {
            "type": "object",
            "properties": {
                "episode_id": {"type": "string", "description": "剧集ID（不传则处理所有集的分镜）"},
                "description": {"type": "string", "description": "向用户说明此次批量生图的意义（显示在确认弹窗中）"}
            },
            "required": ["description"]
        }
    },
    {
        "name": "generate_all_storyboard_videos",
        "description": "批量为某集（或全部）分镜生成视频。跳过无 video_prompt 或关联资产无主图的分镜。需要用户确认后执行。",
        "parameters": {
            "type": "object",
            "properties": {
                "episode_id": {"type": "string", "description": "剧集ID（不传则处理所有集的分镜）"},
                "description": {"type": "string", "description": "向用户说明此次批量生视频的意义（显示在确认弹窗中）"}
            },
            "required": ["description"]
        }
    },
    {
        "name": "submit_images_for_review",
        "description": "将分镜图片提交到素材库（Volcengine/CreateNow），用于后续视频生成时使用 asset:// URI。可指定 image_ids 或 episode_id，不传则提交所有分镜主图。需要用户确认后执行。",
        "parameters": {
            "type": "object",
            "properties": {
                "episode_id": {"type": "string", "description": "剧集ID，只提交该集的分镜主图（与 image_ids 二选一）"},
                "image_ids": {"type": "array", "items": {"type": "string"}, "description": "指定要提交的图片ID列表（与 episode_id 二选一）"},
                "description": {"type": "string", "description": "向用户说明此次提交的意义（显示在确认弹窗中）"}
            },
            "required": ["description"]
        }
    }
]

# OpenAI Function Calling 格式（全工具集，含分镜工具）
OPENAI_TOOLS = [
    {"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["parameters"]}}
    for t in TOOLS
]

# 仅资产工具（不含分镜工具），用于资产 tab
_STORYBOARD_TOOL_NAMES = {
    "create_storyboard", "update_storyboard", "delete_storyboard",
    "insert_storyboard", "generate_storyboard", "create_child_asset",
    "get_episode_storyboards", "delete_all_storyboards", "estimate_storyboard_plan",
}
ASSET_ONLY_TOOLS = [t for t in OPENAI_TOOLS if t["function"]["name"] not in _STORYBOARD_TOOL_NAMES]
