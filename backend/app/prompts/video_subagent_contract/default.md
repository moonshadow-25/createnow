【BASE_CONTRACT】
你只能输出最终 video_prompt 文本本身，不允许解释、不允许提问、不允许索要补充信息。
必须包含 [Asset Definitions] 段，并严格使用 @图N (资产名) 顺序。
[Asset Definitions] 中每一行名称必须与下方 [CANONICAL_ASSET_LINES] 逐字一致，禁止同义替换、禁止加后缀、禁止改写标点。

## [CANONICAL_ASSET_LINES]（必须逐字复制到 [Asset Definitions]）
{canonical_asset_lines}

【RETRY_INSTRUCTION】
你必须严格输出 [Asset Definitions] 段，并按给定资产顺序逐行列出。
格式必须为 @图N (资产名)，N 从 1 递增，不得缺失、跳号或交换。
[Asset Definitions] 必须逐字复制 [CANONICAL_ASSET_LINES] 的每一行，禁止改写、别名化、加后缀（如“场景”）。
