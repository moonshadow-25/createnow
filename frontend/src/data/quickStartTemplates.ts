export interface QuickStartTemplate {
  id: string;
  name: string;
  subtitle: string;
  coverImage: string;
  minutesPerEpisode: number;
  globalResolution: string;
  imageStylePrompt: string;
  videoStylePrompt: string;
  scriptContent: string;
}

export const QUICK_START_TEMPLATES: QuickStartTemplate[] = [
  {
    id: 'cosmetics-ad',
    name: '广告《LUMINA美妆》',
    subtitle: '化妆品广告（15秒，横版）',
    coverImage: '/templates/cosmetics-ad.png',
    minutesPerEpisode: 0.25,
    globalResolution: '1280x720',
    imageStylePrompt:
      '高端商业广告摄影风格，极简奢华，纯白大理石背景，柔和自然光，浅景深，产品质感细腻',
    videoStylePrompt:
      '广告级商业摄影质感，缓慢优雅推拉运镜，柔和暖光氛围，画面干净简洁',
    scriptContent: `第1集 · 时光轻触

【画面一 0–3秒】
产品特写：晶莹剔透的精华瓶矗立于洁白大理石台面，晨光穿过窗棱，在瓶身折射出虹色光晕，水珠缓缓从瓶身滑落。
（背景音：轻柔钢琴，若有若无）

【画面二 3–7秒】
中景：妆容精致的女性轻轻拧开瓶盖，指尖一滴透明精华缓缓滴落掌心，如清晨露珠。
（画外音）"每一滴，都是时光的礼物。"

【画面三 7–11秒】
近景：女性以指腹轻拍面颊，肌肤随之泛起温润光泽，眼神舒然，嘴角微扬。

【画面四 11–15秒】
静物全景：三件套产品整齐排列于台面，品牌名从右上角淡入，金色烫字。
（画外音）"让时光，温柔以待。"
黑场。`,
  },
  {
    id: 'chinese-drama',
    name: '短剧《玲珑》',
    subtitle: '中国古装真人剧（1分钟，竖版）',
    coverImage: '/templates/chinese-drama.png',
    minutesPerEpisode: 1,
    globalResolution: '720x1280',
    imageStylePrompt:
      '中国古装剧风格，传统建筑，典雅汉服，古典美学，电影级品质，真人写实，电视剧真实质感，禁止卡通，禁止动漫，杰作，8K，超高清',
    videoStylePrompt:
      '中国古装剧风格，传统建筑，典雅汉服，古典美学，电影级品质，真人写实，电视剧真实质感，禁止卡通，禁止动漫，杰作，8K，超高清',
    scriptContent: `第1集 · 朱砂痣

场景：皇宫偏殿，黄昏。烛火摇曳，檀香袅袅。

【画面一 0–8秒】
远景：宫殿廊道，穿素色宫装的少女提着食盒低头疾行，宫灯映红她的裙摆。
（内心OS）"三年了，他已贵为太子。而我，不过是他记不住的一张脸。"

【画面二 8–20秒】
中景：少女侧身绕过巡逻侍卫，不意与迎面来人撞个正着，食盒倾翻，瓷碗碎于地。
特写：一双皂靴停在碎片前。

【画面三 20–35秒】
近景对切：少女慌忙跪地拾碎片，手指划破，血珠渗出。头顶传来男声，低沉而缓："抬起头来。"
少女抬头——一双漆黑深眼正静静凝视她。
（台词·男）"……是你。"

【画面四 35–48秒】
特写：少女眸中震惊与委屈交织；男子眼底情绪翻涌，片刻后敛去，转身吩咐随从："送她去太医处。"

【画面五 48–60秒】
长镜：男子背影渐行渐远，廊下烛光勾勒出他的轮廓。少女攥紧划破的手指，苦笑一闪而逝。
（OS）"原来，他还认得我。"
黑场，片名《玲珑》浮现。`,
  },
  {
    id: 'western-film',
    name: '电影《黑鹰计划》',
    subtitle: '欧美电影大片（1分钟，横版）',
    coverImage: '/templates/western-film.png',
    minutesPerEpisode: 1,
    globalResolution: '1280x720',
    imageStylePrompt:
      '好莱坞电影级写实，16:9横构图，青橙色调（teal & orange），大景深虚化，电影感颗粒质感，动作片氛围',
    videoStylePrompt:
      '好莱坞商业片剪辑节奏，快切追逐，手持微抖，爆炸与动作升格，配乐冲击感强',
    scriptContent: `第1集 · No Way Back

场景：近未来城市，夜雨。

字幕淡入："2031. New Chicago."

【画面一 0–8秒】
航拍：霓虹倒映于湿润沥青，摩天楼间无人机呼啸穿行。低沉配乐起。
特写：一双手快速拆解手枪，检查弹夹——18发，装回，枪套插回腰间。

【画面二 8–20秒】
男主角靠在停车场水泥柱后，耳机里传来女声："They said you were dead, Kane."
他苦笑，低声回应："They were almost right."

【画面三 20–35秒】
动作剪辑：男主快步穿越雨中街道，身后两辆黑色SUV逆向冲来，人群惊散尖叫。
特写：男主眼神锁定远处霓虹楼道入口，身体起跑。

【画面四 35–50秒】
追逐序列：楼道攀爬，踢翻路障，在最后一刻跃入一辆启动的摩托车后座。
身后爆炸光焰腾起，碎玻璃四散飞落。

【画面五 50–60秒】
摩托疾驰，男主回望燃烧的街道，面无表情。
（耳机女声）"Package is still in play. ETA to extraction: 4 minutes."
（男主）"Make it two."
黑场，标题冲击：NO WAY BACK`,
  },
];
