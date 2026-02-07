import { useRef, useCallback, useEffect, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { ToolCall, Message } from '@/types';
import { MessageBubble } from './MessageBubble';

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
  currentMessage,
  currentThinking,
  toolCalls,
  isStreaming,
  error,
  onClearMessages,
}: MessageListProps) {
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [hasUserScrolled, setHasUserScrolled] = useState(false);

  // 自动滚动到底部
  const scrollToBottom = useCallback((smooth = true) => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'instant',
      });
    }
  }, []);

  // 检查用户是否在底部
  const isAtBottom = useCallback(() => {
    if (!chatContainerRef.current) return true;
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    return scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  // 处理用户手动滚动
  const handleScroll = useCallback(() => {
    if (!chatContainerRef.current) return;
    const atBottom = isAtBottom();

    if (atBottom) {
      setHasUserScrolled(false);
    } else {
      setHasUserScrolled(true);
    }
  }, [isAtBottom]);

  // 监听滚动事件
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // 当消息更新或正在流式传输时，自动滚动
  useEffect(() => {
    if (!hasUserScrolled || (isStreaming && isAtBottom())) {
      scrollToBottom(true);
    }
  }, [messages, currentMessage, isStreaming, hasUserScrolled, isAtBottom, scrollToBottom]);

  return (
    <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-6">
      {/* 清除对话按钮 */}
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

      {messages.length === 0 ? (
        <div className="text-center text-gray-400 mt-12">
          <Sparkles size={48} className="mx-auto mb-4" />
          <p className="text-xl">开始对话，创作你的AI短片</p>
          <p className="text-sm mt-2">
            ��可以描述剧情、角色、场景，我会帮你提取和组织资产
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {messages
            .filter(msg => msg.role !== 'system')
            .map((msg) => (
            <MessageBubble
              key={msg.message_id}
              role={msg.role as 'user' | 'assistant'}
              content={msg.content}
              toolCalls={msg.tool_calls}
              thinking={msg.thinking}
            />
          ))}
          {currentMessage && (
            <MessageBubble
              role="assistant"
              content={currentMessage}
              toolCalls={toolCalls}
              thinking={currentThinking}
              isStreaming
            />
          )}
        </div>
      )}
      {error && <div className="text-red-400 mt-4">错误: {error}</div>}
    </div>
  );
}
