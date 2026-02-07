import { useState, useCallback, useEffect } from 'react';
import { Message, StreamChunk, ToolCall } from '@/types';

export function useChat(projectId: string, options?: { onAssetsCreated?: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [currentThinking, setCurrentThinking] = useState('');
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // 加载历史对话
  useEffect(() => {
    // 从localStorage恢复conversationId
    const saved = localStorage.getItem(`conversation_${projectId}`);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setConversationId(data.conversationId);
        setMessages(data.messages || []);
      } catch (e) {
        console.error('Failed to load conversation:', e);
      }
    }
  }, [projectId]);

  // 保存对话到localStorage
  useEffect(() => {
    if (conversationId) {
      localStorage.setItem(`conversation_${projectId}`, JSON.stringify({
        conversationId,
        messages,
      }));
    }
  }, [conversationId, messages, projectId]);

  const sendMessage = useCallback(
    async (content: string) => {
      setIsStreaming(true);
      setError(null);
      setCurrentMessage('');
      setCurrentThinking('');
      setToolCalls([]);

      // 添加用户消息
      const userMessage: Message = {
        message_id: Date.now().toString(),
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);

      try {
        const request = {
          message: content,
          conversation_id: conversationId || undefined,
        };

        const response = await fetch('/api/projects/' + projectId + '/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        });

        if (!response.ok) throw new Error('Failed to send message');

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No reader');

        const decoder = new TextDecoder();
        let buffer = '';
        let assistantMessage = '';
        let assistantThinking = '';
        let currentToolCalls: ToolCall[] = [];
        let assetsWereCreated = false;

        // 改进的TOOL块过滤函数 - 同时清理多余空行
        const filterToolBlocks = (text: string): string => {
          // 移除完整的TOOL...END_TOOL块
          let filtered = text.replace(/TOOL:\s*\w+\s*\n[\s\S]*?END_TOOL/g, '');
          // 清理多余的连续空行（超过2个连续换行符替换为2个）
          filtered = filtered.replace(/\n{3,}/g, '\n\n');
          return filtered;
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const chunk: StreamChunk = JSON.parse(line.slice(6));

                switch (chunk.type) {
                  case 'thinking':
                    assistantThinking += chunk.content || '';
                    setCurrentThinking(assistantThinking);
                    break;
                  case 'thinking_end':
                    break;
                  case 'content':
                    // 过滤掉TOOL/END_TOOL原始JSON，只保留干净的文本
                    let content = filterToolBlocks(chunk.content || '');
                    assistantMessage += content;
                    setCurrentMessage(assistantMessage);
                    break;
                  case 'tool_call':
                    if (chunk.tool_call) {
                      currentToolCalls.push(chunk.tool_call);
                      setToolCalls([...currentToolCalls]);
                      // 检查是否是资产创建/更新工具或分镜相关工具
                      if (chunk.tool_call.name?.startsWith('create_') ||
                          chunk.tool_call.name?.startsWith('update_') ||
                          chunk.tool_call.name?.startsWith('delete_') ||
                          chunk.tool_call.name === 'generate_storyboard') {
                        assetsWereCreated = true;
                      }
                    }
                    break;
                  case 'tool_result':
                    // 工具执行结果不在消息中显示，只通过toast通知
                    // 不再添加到assistantMessage中
                    break;
                  case 'content_end':
                    break;
                  case 'done':
                    setConversationId(chunk.conversation_id || '');
                    break;
                  case 'error':
                    setError(chunk.content || 'Unknown error');
                    break;
                }
              } catch (e) {
                // Ignore parse errors for incomplete JSON
              }
            }
          }
        }

        // 最后再过滤一次，确保没有残留的TOOL块
        assistantMessage = filterToolBlocks(assistantMessage);

        // 添加助手消息
        const aiMessage: Message = {
          message_id: Date.now().toString(),
          role: 'assistant',
          content: assistantMessage,
          timestamp: new Date().toISOString(),
          thinking: assistantThinking || undefined,
          tool_calls: currentToolCalls.length > 0 ? currentToolCalls : undefined,
          assets_extracted: currentToolCalls.length > 0 ? {
            characters: currentToolCalls.filter((t: any) => t?.name === 'create_character').map((t: any) => t.parameters?.name),
            scenes: currentToolCalls.filter((t: any) => t?.name === 'create_scene').map((t: any) => t.parameters?.name),
            props: currentToolCalls.filter((t: any) => t?.name === 'create_prop').map((t: any) => t.parameters?.name),
            episodes: currentToolCalls.filter((t: any) => t?.name === 'create_episode').map((t: any) => t.parameters?.episode_number),
          } : undefined,
        };
        setMessages((prev) => [...prev, aiMessage]);

        // 如果创建了资产，触发回调
        if (assetsWereCreated && options?.onAssetsCreated) {
          options.onAssetsCreated();
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setIsStreaming(false);
        setCurrentMessage('');
        setCurrentThinking('');
        setToolCalls([]);
      }
    },
    [projectId, conversationId, options]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setConversationId('');
    setError(null);
    localStorage.removeItem(`conversation_${projectId}`);
  }, [projectId]);

  return {
    messages,
    currentMessage,
    currentThinking,
    toolCalls,
    isStreaming,
    error,
    sendMessage,
    clearMessages,
    conversationId,
  };
}
