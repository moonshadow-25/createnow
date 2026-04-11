import { useState, useCallback, useEffect, useRef } from 'react';
import { Message, StreamChunk, ToolCall } from '@/types';
import { useVibeDramaStore } from '@/store/vibeDramaStore';

export interface PendingConfirmation {
  token: string;
  toolName: string;
  description: string;
}

export function useChat(projectId: string, options?: { label?: string; episodeId?: string; tabName?: string }) {
  const removeSession = useVibeDramaStore(s => s.removeSession);
  const commitSession = useVibeDramaStore(s => s.commitSession);
  // 用 ref 包装，避免进入 useCallback 依赖数组导致 sendMessage 在流式传输途中被重建
  const commitSessionRef = useRef(commitSession);
  useEffect(() => { commitSessionRef.current = commitSession; }, [commitSession]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [currentThinking, setCurrentThinking] = useState('');
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  // 初始化时立即生成本地 UUID，避免首次对话前 conversationId 为空导致保存失败
  const [conversationId, setConversationId] = useState<string>(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);

  // 用 ref 保存最新 messages，避免 sendMessage 闭包中取到过期值
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // 审核轮询：存储待轮询的 asset_id 列表
  const pendingReviewAssetIdsRef = useRef<string[]>([]);
  // 用 ref 持有 startReviewPolling，供 _fetchStream 内部调用（避免循环依赖）
  const startReviewPollingRef = useRef<(() => void) | null>(null);

  const storageKey = options?.episodeId
    ? `conversation_${projectId}_${options.episodeId}`
    : `conversation_${projectId}_${options?.tabName || ''}`;

  // 加载历史对话
  useEffect(() => {
    setMessages([]);
    setConversationId('');
    setError(null);
    setPendingConfirmation(null);

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

  // 内部通用 fetch 方法（sendMessage 和 rawMessage 共用）
  const _fetchStream = useCallback(
    async (content: string, addToHistory: boolean) => {
      setIsStreaming(true);
      setError(null);
      setCurrentMessage('');
      setCurrentThinking('');
      setToolCalls([]);

      if (addToHistory) {
        const userMessage: Message = {
          message_id: Date.now().toString(),
          role: 'user',
          content,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMessage]);
      }

      try {
        const request = {
          message: content,
          conversation_id: conversationId || undefined,
          episode_id: options?.episodeId || undefined,
          context_messages: messagesRef.current.map(m => ({ role: m.role, content: m.content })),
        };

        const _token = localStorage.getItem('saas_token') || localStorage.getItem('admin_token');
        const response = await fetch('/api/projects/' + projectId + '/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(_token ? { Authorization: `Bearer ${_token}` } : {}),
          } as HeadersInit,
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
        const toolCallParamsCache: Record<string, any> = {};

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
                    break;
                  case 'tool_call':
                    if (chunk.tool_call) {
                      currentToolCalls.push(chunk.tool_call);
                      setToolCalls([...currentToolCalls]);
                      // 缓存参数供 tool_result 时使用
                      if (chunk.tool_call.name) {
                        toolCallParamsCache[chunk.tool_call.name] = chunk.tool_call.parameters;
                      }
                      if (chunk.tool_call.name?.startsWith('create_') ||
                          chunk.tool_call.name?.startsWith('update_') ||
                          chunk.tool_call.name?.startsWith('delete_') ||
                          chunk.tool_call.name?.startsWith('insert_') ||
                          chunk.tool_call.name === 'generate_storyboard') {
                        assetsWereCreated = true;
                      }
                    }
                    break;
                  case 'tool_result': {
                    const name = chunk.tool_name || '';
                    if (name === 'update_storyboard' || name === 'create_storyboard' || name === 'generate_storyboard') {
                      const params = toolCallParamsCache[name] as any;
                      const ids: string[] = [];
                      if (params?.asset_id) ids.push(params.asset_id);
                      if (params?.storyboard_id) ids.push(params.storyboard_id);
                      window.dispatchEvent(new CustomEvent('storyboard:tool-updated', { detail: { storyboard_ids: ids } }));
                    }
                    if (name === 'submit_images_for_review') {
                      const ids = (chunk.submitted || []).map(s => s.asset_id).filter(Boolean);
                      pendingReviewAssetIdsRef.current = ids;
                      startReviewPollingRef.current?.();
                    }
                    break;
                  }
                  case 'content_end':
                    break;
                  case 'confirmation_required':
                    if (chunk.token && chunk.description) {
                      setPendingConfirmation({
                        token: chunk.token,
                        toolName: chunk.tool_name || '',
                        description: chunk.description,
                      });
                    }
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

        if (assistantMessage) {
          const aiMessage: Message = {
            message_id: Date.now().toString(),
            role: 'assistant',
            content: assistantMessage,
            timestamp: new Date().toISOString(),
            thinking: assistantThinking || undefined,
            tool_calls: currentToolCalls.length > 0 ? currentToolCalls : undefined,
            assets_extracted: addToHistory && currentToolCalls.length > 0 ? {
              characters: currentToolCalls.filter((t: any) => t?.name === 'create_character').map((t: any) => t.parameters?.name),
              scenes: currentToolCalls.filter((t: any) => t?.name === 'create_scene').map((t: any) => t.parameters?.name),
              props: currentToolCalls.filter((t: any) => t?.name === 'create_prop').map((t: any) => t.parameters?.name),
              episodes: currentToolCalls.filter((t: any) => t?.name === 'create_episode').map((t: any) => t.parameters?.episode_number),
            } : undefined,
          };
          setMessages((prev) => [...prev, aiMessage]);
        }

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

  const sendMessage = useCallback(
    async (content: string) => {
      // 首次发消息时将当前上下文提升为正式历史 session
      commitSessionRef.current();
      await _fetchStream(content, true);
    },
    [_fetchStream]
  );

  // 内部方法：发送不显示在历史中的控制消息（确认/取消）
  const sendRawMessage = useCallback(
    async (content: string) => {
      await _fetchStream(content, false);
    },
    [_fetchStream]
  );

  const confirmPendingAction = useCallback(async () => {
    if (!pendingConfirmation) return;
    const { token, toolName } = pendingConfirmation;
    setPendingConfirmation(null);
    await sendRawMessage(`__CONFIRM__:${token}`);
    if (toolName === 'generate_all_asset_images') {
      // 生图完成 → 触发 AI 继续执行下一步（提交审核，无需确认）
      await sendRawMessage('继续执行下一步');
    }
    if (toolName === 'delete_all_storyboards') {
      // 分镜已清空 → 告知 AI 继续生成新分镜
      await sendRawMessage('分镜已全部删除，请继续生成新分镜');
    }
    // generate_all_storyboard_videos 确认完成后流程结束，不做任何事
  }, [pendingConfirmation, sendRawMessage]);

  const cancelPendingAction = useCallback(async () => {
    if (!pendingConfirmation) return;
    const token = pendingConfirmation.token;
    setPendingConfirmation(null);
    await sendRawMessage(`__CANCEL__:${token}`);
  }, [pendingConfirmation, sendRawMessage]);

  const startReviewPolling = useCallback(() => {
    const assetIds = pendingReviewAssetIdsRef.current;
    if (!assetIds || assetIds.length === 0) {
      sendRawMessage('审核已完成，请继续生成视频');
      return;
    }

    const _token = localStorage.getItem('saas_token') || localStorage.getItem('admin_token');
    let attempts = 0;

    const poll = async () => {
      attempts++;
      if (attempts > 60) return;
      try {
        const results = await Promise.all(
          assetIds.map(assetId =>
            fetch(`/api/projects/${projectId}/generate/assets/${assetId}/status`, {
              headers: _token ? { Authorization: `Bearer ${_token}` } : {},
            }).then(r => r.json()).catch(() => ({ status: 'Processing' }))
          )
        );

        // 通知分镜页面刷新徽章
        window.dispatchEvent(new CustomEvent('storyboard:review-status-updated', { detail: { projectId, episodeId: options?.episodeId } }));

        const allActive = results.every((r: any) => r.status === 'Active');
        if (allActive) {
          pendingReviewAssetIdsRef.current = [];
          await sendRawMessage('审核已完成，请继续生成视频');
        } else {
          setTimeout(poll, 8000);
        }
      } catch {
        setTimeout(poll, 8000);
      }
    };
    setTimeout(poll, 5000);
  }, [projectId, options?.episodeId, sendRawMessage]);

  // 同步 ref，供 _fetchStream 内部调用
  useEffect(() => { startReviewPollingRef.current = startReviewPolling; }, [startReviewPolling]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setConversationId('');
    setError(null);
    setPendingConfirmation(null);
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
    pendingConfirmation,
    confirmPendingAction,
    cancelPendingAction,
  };
}
