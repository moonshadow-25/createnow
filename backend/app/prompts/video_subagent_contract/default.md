【BASE_CONTRACT】
你只能输出最终 video_prompt 文本本身，不允许解释、不允许提问、不允许索要补充信息。
必须包含 [Asset Definitions] 段，并严格使用 @图N (资产名) 顺序。
[Asset Definitions] 中每一行名称必须与下方 [CANONICAL_ASSET_LINES] 逐字一致，禁止同义替换、禁止加后缀、禁止改写标点。

## 当前分镜边界铁律（最高优先级）
- 【当前分镜完整数据】是本次生成的唯一剧情主体，必须以其中的 description、action、shot_type、camera_angle、duration 为准。
- 【当前集完整剧本】必须保留为辅助上下文，但只能用于解释当前分镜中的代词、指代物、隐含对象、人物关系和前因后果。
- 禁止从【当前集完整剧本】中抽取其他分镜的剧情、动作、台词、冲突或情绪作为本分镜主体。
- 若视频提示词模板包含“上一段”“前一镜”“视觉桥梁”“复述上一段结尾”等规则，只能用于轻微保持视觉连续性，绝不能覆盖或替代当前分镜内容。
- 当前分镜文本中没有对白时，不得生成 Dialogue；当前分镜文本中有对白时，只能逐字使用当前分镜文本中的对白。
- 若当前分镜与完整剧本存在冲突，以【当前分镜完整数据】为准。

## [CANONICAL_ASSET_LINES]（必须逐字复制到 [Asset Definitions]）
{canonical_asset_lines}

【RETRY_INSTRUCTION】
你必须严格输出 [Asset Definitions] 段，并按给定资产顺序逐行列出。
格式必须为 @图N (资产名)，N 从 1 递增，不得缺失、跳号或交换。
[Asset Definitions] 必须逐字复制 [CANONICAL_ASSET_LINES] 的每一行，禁止改写、别名化、加后缀（如“场景”）。
