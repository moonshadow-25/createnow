import { useState } from 'react';
import { useChat } from '@/hooks/useChat';
import { MessageList } from './MessageList';
import { ChatInput, UploadedFile } from './ChatInput';

interface ChatTabProps {
  projectId: string;
  onAssetsCreated?: () => void;
}

export function ChatTab({ projectId, onAssetsCreated }: ChatTabProps) {
  const [inputMessage, setInputMessage] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);

  const { messages, currentMessage, currentThinking, isStreaming, sendMessage, error, toolCalls, clearMessages } =
    useChat(projectId, {
      onAssetsCreated,
    });

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
    <div className="flex-1 flex flex-col">
      <MessageList
        messages={messages}
        currentMessage={currentMessage}
        currentThinking={currentThinking}
        toolCalls={toolCalls}
        isStreaming={isStreaming}
        error={error}
        onClearMessages={clearMessages}
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
