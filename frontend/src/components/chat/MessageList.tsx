import { useRef, useCallback, useEffect, useState } from 'react';
import { RefreshCw, Sparkles, Clapperboard, CheckCircle2 } from 'lucide-react';
import { ToolCall, Message } from '@/types';
import { MessageBubble } from './MessageBubble';

const FUNNY_MESSAGES = [
  '🎬 正在参考张艺谋的构镜手册...',
  '🍜 正在泡面等灵感，预计3分钟...',
  '🎭 正在向陈凯歌请教叙事结构...',
  '📽️ 正在翻阅《霸王别姬》完整分镜...',
  '🧠 GPU 正在高速运转（可能有点烫）...',
  '☕ 正在喝第三杯咖啡寻找创意...',
  '🎞️ 正在回顾戛纳金棕榈获奖作品...',
  '📚 正在翻阅麦基《故事》第七章...',
  '🌊 正在感受李安的情感节奏...',
  '🎬 正在请教黑泽明的运镜心得...',
  '🎪 正在与斯皮尔伯格的灵魂对话...',
  '🌙 正在翻查《卧虎藏龙》动作设计...',
  '🎨 正在向宫崎骏取经场景设计...',
  '🌀 正在模拟王家卫的即兴创作状态...',
  '🔮 正在占卜本集剧情走向...',
  '🎸 正在用汉斯·季默音乐调动创意...',
  '📸 正在翻阅维姆·文德斯的构图笔记...',
  '🎙️ 正在给自己打气：你是最棒的AI编剧！',
  '🦆 正在用橡皮鸭调试剧情逻辑...',
  '🌍 正在查阅全球15秒短视频大数据...',
];

const TOOL_LABELS: Record<string, string> = {
  create_storyboard: '新建分镜',
  update_storyboard: '更新分镜',
  delete_storyboard: '删除分镜',
  create_character: '创建角色',
  update_character: '更新角色',
  create_scene: '创建场景',
  update_scene: '更新场景',
  create_prop: '创建道具',
  update_prop: '更新道具',
  create_episode: '创建集数',
  update_episode: '更新集数',
  get_project_info: '读取项目信息',
  list_assets: '列出资产',
  generate_storyboard: '生成分镜',
};

interface MessageListProps {
  messages: Message[];
  currentMessage?: string;
  currentThinking?: string;
  toolCalls?: ToolCall[];
  isStreaming: boolean;
  error?: string | null;
  onClearMessages: () => void;
}

export function MessageList({
  messages,
  currentThinking,
  toolCalls,
  isStreaming,
  error,
  onClearMessages,
}: MessageListProps) {
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [hasUserScrolled, setHasUserScrolled] = useState(false);
  const [funnyIdx, setFunnyIdx] = useState(0);

  // 搞笑状态轮播
  useEffect(() => {
    if (!isStreaming) return;
    setFunnyIdx(Math.floor(Math.random() * FUNNY_MESSAGES.length));
    const id = setInterval(() => {
      setFunnyIdx(i => (i + 1) % FUNNY_MESSAGES.length);
    }, 2800);
    return () => clearInterval(id);
  }, [isStreaming]);

  const scrollToBottom = useCallback((smooth = true) => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'instant',
      });
    }
  }, []);

  const isAtBottom = useCallback(() => {
    if (!chatContainerRef.current) return true;
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    return scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  const handleScroll = useCallback(() => {
    if (!chatContainerRef.current) return;
    setHasUserScrolled(!isAtBottom());
  }, [isAtBottom]);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    if (!hasUserScrolled || (isStreaming && isAtBottom())) {
      scrollToBottom(true);
    }
  }, [messages, isStreaming, toolCalls, hasUserScrolled, isAtBottom, scrollToBottom]);

  return (
    <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-6">
      {messages.length > 0 && (
        <div className="flex justify-end mb-4">
          <button
            onClick={() => {
              if (confirm('确定清除所有对话历史吗？')) {
                onClearMessages();
              }
            }}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 px-3 py-1 rounded border border-gray-700 hover:border-gray-600 transition"
          >
            <RefreshCw size={14} />
            清除对话历史
          </button>
        </div>
      )}

      {messages.length === 0 && !isStreaming ? (
        <div className="text-center text-gray-400 mt-12">
          <Sparkles size={48} className="mx-auto mb-4" />
          <p className="text-xl">Vibe Drama，开拍！</p>
          <p className="text-sm mt-2">把剧本扔给我，我来搞定分镜和视频提示词</p>
        </div>
      ) : (
        <div className="space-y-6">
          {messages
            .filter(msg => msg.role !== 'system')
            .map(msg => (
              <MessageBubble
                key={msg.message_id}
                role={msg.role as 'user' | 'assistant'}
                content={msg.content}
                toolCalls={msg.tool_calls}
                thinking={msg.thinking}
              />
            ))}

          {/* 流式处理中：搞笑状态 + 实时工具调用 */}
          {isStreaming && (
            <div className="flex justify-start">
              <div className="max-w-sm rounded-xl p-4 bg-gray-800 border border-gray-700 text-gray-100 space-y-3">
                {/* 已执行的工具调用 */}
                {toolCalls && toolCalls.length > 0 && (
                  <div className="space-y-1.5">
                    {toolCalls.map((tool, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs">
                        <CheckCircle2 size={12} className="text-green-400 flex-shrink-0" />
                        <span className="font-mono text-blue-300">
                          {TOOL_LABELS[tool.name] ?? tool.name}
                        </span>
                        {tool.parameters?.sequence && (
                          <span className="text-gray-500">#{tool.parameters.sequence}</span>
                        )}
                        {tool.parameters?.name && (
                          <span className="text-gray-500 truncate max-w-[6rem]">
                            {tool.parameters.name}
                          </span>
                        )}
                      </div>
                    ))}
                    <div className="border-t border-gray-700 mt-2" />
                  </div>
                )}

                {/* 搞笑状态文字 */}
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Clapperboard size={14} className="text-indigo-400 animate-pulse flex-shrink-0" />
                  <span className="transition-all duration-500">{FUNNY_MESSAGES[funnyIdx]}</span>
                </div>

                {/* thinking 折叠 */}
                {currentThinking && (
                  <details className="mt-1">
                    <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
                      思考过程
                    </summary>
                    <div className="text-xs text-gray-600 mt-1 whitespace-pre-wrap max-h-32 overflow-y-auto">
                      {currentThinking}
                    </div>
                  </details>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {error && <div className="text-red-400 mt-4 text-sm">错误: {error}</div>}
    </div>
  );
}
