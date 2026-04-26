import { useState, useEffect } from 'react';
import { useChat } from '@/hooks/useChat';
import { MessageList } from './MessageList';
import { ChatInput, UploadedFile } from './ChatInput';
import { useVibeDramaStore } from '@/store/vibeDramaStore';

interface ChatTabProps {
  projectId: string;
  episodeId?: string;
  label?: string;
  tabName?: string;
  scriptContent?: string;
}

export function ChatTab({ projectId, episodeId, label, tabName, scriptContent }: ChatTabProps) {
  const [inputMessage, setInputMessage] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);

  const { messages, currentMessage, currentThinking, isStreaming, sendMessage, error, toolCalls, liveToolResults, clearMessages, pendingConfirmation, confirmPendingAction, cancelPendingAction } =
    useChat(projectId, { episodeId, label, tabName });

  const pendingMessage = useVibeDramaStore(s => s.pendingMessage);
  const setPendingMessage = useVibeDramaStore(s => s.setPendingMessage);
  const myKey = episodeId ? `${projectId}_${episodeId}` : `${projectId}_${tabName || ''}`;
  useEffect(() => {
    if (pendingMessage && pendingMessage.key === myKey && !isStreaming) {
      const msg = pendingMessage.message;
      setPendingMessage(null);
      sendMessage(msg);
    }
  }, [pendingMessage, isStreaming]);

  const handleSendMessage = async (message: string) => {
    if (isStreaming) return;
    setInputMessage('');
    setUploadedFiles([]);
    await sendMessage(message);
  };

  const handleFileLoaded = (file: UploadedFile) => {
    setUploadedFiles(prev => [...prev, file]);
  };

  const handleClearFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <MessageList
        messages={messages}
        currentMessage={currentMessage}
        currentThinking={currentThinking}
        toolCalls={toolCalls}
        liveToolResults={liveToolResults}
        isStreaming={isStreaming}
        error={error}
        onClearMessages={clearMessages}
        scriptContent={scriptContent}
        pendingConfirmation={pendingConfirmation}
        onConfirm={confirmPendingAction}
        onCancel={cancelPendingAction}
      />

      <ChatInput
        value={inputMessage}
        onChange={setInputMessage}
        onSend={handleSendMessage}
        isStreaming={isStreaming}
        uploadedFiles={uploadedFiles}
        onFileLoaded={handleFileLoaded}
        onClearFile={handleClearFile}
      />
    </div>
  );
}
