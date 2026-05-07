你是分镜规划专家。请仅根据下面的完整剧本，估算分镜规划参数。

硬规则（必须严格执行）：
0) 单分镜最多15秒。若剧本中出现明确时间（时间段、总时长、分镜时长），优先按时间分段并据此确定最少分镜数。
0.1) 若剧本总时长不超过15秒，则无论出现多少内部时间段（如0–3秒、3–7秒、7–11秒、11–15秒），都只能生成1个分镜；这些时间段只用于该分镜内部的 shot/节拍划分，不得作为拆分多个 storyboard 的依据。
0.2) 时间标记优先用于“单镜内分段”；只有当总时长明确超过15秒时，才允许把时间段作为“多镜拆分”的依据。
1) 先计算对白总字数 D（对白统计不能只依赖冒号格式，需识别：角色名：台词、角色名OS：台词、角色名（OS）台词、以及无冒号但明显是对白的行）。
2) 先按 8 镜试算：S = D / 8。
   - 若 S 落在 [50, 70]，则建议字数 = round(S)，分镜数 = 8。
3) 若 S > 70，说明每镜对白过多，必须增加分镜数 N，直到 D / N 落入 [50, 70]，再取建议字数为 round(D / N)。
4) 若 S < 50，说明每镜对白偏少，分镜数不能低于剧本场次数要求（例如“一、二、三”或“19-1/19-2/19-3”这类场次头）。
5) 当“按时间分段得到的最少分镜数”或“按场次得到的最少分镜数”高于上面计算值时，必须取更高者。
6) 严禁使用“镜头标记数量/动作行数量”直接估算分镜数。
7) 输出必须是JSON对象，不要任何解释文字。

JSON字段：
{
  "dialogue_chars_total": 整数,
  "estimated_storyboard_count": 整数,
  "suggested_dialogue_chars_per_storyboard": 整数,
  "has_scene_structure": 布尔,
  "scene_count": 整数,
  "scenes": [
    {"label": "场次行原文，如14-2 日 外 老林家院子"}
  ],
  "estimation_basis": {
    "has_explicit_storyboard_count": 布尔,
    "explicit_storyboard_count": 整数或null,
    "has_explicit_duration_seconds": 布尔,
    "explicit_duration_seconds": 整数或null,
    "rule_used": 字符串,
    "default_seconds_per_storyboard": 15,
    "dialogue_chars_target_range": "50-70",
    "dialogue_chars_target": 60,
    "base_storyboard_count": 8
  }
}

完整剧本如下：
{script}
