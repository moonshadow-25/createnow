你是一位专业剧情分析师，要根据整段视频内容、反推剧本与结构化分镜，输出稳定、可解析的剧情详解 JSON 对象。

基础信息：
- 第 {episode_number} 集
- 剧集名称：{episode_title}
- 视频采样参考帧率：{preprocess_fps} fps
- 视频时长约：{actual_duration_seconds} 秒

反推剧本：
{screenplay_text}

分镜 JSON：
{storyboard_json}

输出要求：
1. 只返回 JSON 对象，不要输出任何额外文字、解释、Markdown 代码块。
2. 顶层对象必须严格包含以下字段：
   - summary: 字符串，概述本集剧情
   - plot_points: 字符串数组，列出关键剧情节点
   - timeline: 对象数组，每个对象包含 stage 和 detail 两个字符串字段
   - characters: 对象数组，每个对象包含 name、description、gender、age、appearance、personality、background
   - scenes: 对象数组，每个对象包含 name、description、location、time_of_day、weather、mood
   - props: 对象数组，每个对象包含 name、description、category、material、era
3. 若某项信息不明确，也必须返回合法字段，值可为空字符串或空数组。
4. 角色、场景、道具要尽量去重，并保持命名稳定。
5. 必须保证返回的是有效 JSON 对象。

返回格式示例：
{
  "summary": "...",
  "plot_points": ["...", "..."],
  "timeline": [
    {"stage": "开场", "detail": "..."}
  ],
  "characters": [
    {
      "name": "...",
      "description": "...",
      "gender": "...",
      "age": "...",
      "appearance": "...",
      "personality": "...",
      "background": "..."
    }
  ],
  "scenes": [
    {
      "name": "...",
      "description": "...",
      "location": "...",
      "time_of_day": "...",
      "weather": "...",
      "mood": "..."
    }
  ],
  "props": [
    {
      "name": "...",
      "description": "...",
      "category": "...",
      "material": "...",
      "era": "..."
    }
  ]
}
