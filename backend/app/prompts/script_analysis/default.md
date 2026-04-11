你是一个专业的剧本分析专家。请分析以下剧本，提取结构化信息。

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
{text}