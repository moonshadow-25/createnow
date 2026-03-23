import { useState, useCallback, useEffect, useRef } from 'react';
import { Message, StreamChunk, ToolCall } from '@/types';
import { useVibeDramaStore } from '@/store/vibeDramaStore';

export function useChat(projectId: string, options?: { label?: string; episodeId?: string; tabName?: string }) {
  const removeSession = useVibeDramaStore(s => s.removeSession);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [currentThinking, setCurrentThinking] = useState('');
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // 用 ref 保存最新 messages，避免 sendMessage 闭包中取到过期值
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const storageKey = options?.episodeId
    ? `conversation_${projectId}_${options.episodeId}`
    : `conversation_${projectId}_${options?.tabName || ''}`;

  // 加载历史对话
  useEffect(() => {
    setMessages([]);
    setConversationId('');
    setError(null);

    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setConversationId(data.conversationId);
        setMessages(data.messages || []);
      } catch (e) {
        console.error('Failed to load conversation:', e);
      }
    }
  }, [storageKey]);

  // 保存对话到 localStorage（附加 label + updatedAt）
  useEffect(() => {
    if (conversationId) {
      localStorage.setItem(storageKey, JSON.stringify({
        conversationId,
        messages,
        label: options?.label || '',
        updatedAt: new Date().toISOString(),
      }));
    }
  }, [conversationId, messages, storageKey, options?.label]);

  const sendMessage = useCallback(
    async (content: string) => {
      setIsStreaming(true);
      setError(null);
      setCurrentMessage('');
      setCurrentThinking('');
      setToolCalls([]);

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
          episode_id: options?.episodeId || undefined,
          context_messages: messagesRef.current.map(m => ({ role: m.role, content: m.content })),
        };

        const response = await fetch('/api/projects/' + projectId + '/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(localStorage.getItem('admin_token')
              ? { Authorization: `Bearer ${localStorage.getItem('admin_token')}` }
              : {}),
          },
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

        const filterToolBlocks = (text: string): string => {
          let filtered = text.replace(/TOOL:\s*\w+\s*\n[\s\S]*?END_TOOL/g, '');
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
                    assistantMessage += filterToolBlocks(chunk.content || '');
                    // 不实时更新 UI，等完成后一次性显示
                    break;
                  case 'tool_call':
                    if (chunk.tool_call) {
                      currentToolCalls.push(chunk.tool_call);
                      setToolCalls([...currentToolCalls]);
                      if (chunk.tool_call.name?.startsWith('create_') ||
                          chunk.tool_call.name?.startsWith('update_') ||
                          chunk.tool_call.name?.startsWith('delete_') ||
                          chunk.tool_call.name === 'generate_storyboard') {
                        assetsWereCreated = true;
                      }
                    }
                    break;
                  case 'tool_result':
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

        assistantMessage = filterToolBlocks(assistantMessage);

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

        // 用全局事件通知资产刷新，替代 onAssetsCreated prop
        if (assetsWereCreated) {
          window.dispatchEvent(new CustomEvent('vibe-drama:assets-created', { detail: { projectId } }));
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setError(err.message);
        }
      } finally {
        setIsStreaming(false);
        setCurrentMessage('');
        setCurrentThinking('');
        setToolCalls([]);
      }
    },
    [projectId, conversationId, options?.episodeId, options?.label]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setConversationId('');
    setError(null);
    localStorage.removeItem(storageKey);
    // 同步从历史面板移除该 session 条目
    const sessionKey = options?.episodeId
      ? `${projectId}_${options.episodeId}`
      : `${projectId}_${options?.tabName || ''}`;
    removeSession(sessionKey);
  }, [storageKey, projectId, options?.episodeId, options?.tabName, options?.label, removeSession]);

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
