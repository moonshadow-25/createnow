import { ToolCall, ToolResult } from '@/types';
import { Code } from 'lucide-react';

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  thinking?: string;
  isStreaming?: boolean;
}

export function MessageBubble({
  role,
  content,
  toolCalls,
  toolResults,
  thinking,
  isStreaming,
}: MessageBubbleProps) {
  return (
    <div className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-2xl rounded-lg p-4 ${
          role === 'user'
            ? 'bg-blue-600 text-white'
            : 'bg-gray-800 text-gray-100'
        }`}
      >
        {toolCalls && toolCalls.length > 0 && (
          <details className="mb-1" open={false}>
            <summary className="text-xs text-gray-400 cursor-pointer flex items-center gap-1 hover:text-gray-300">
              <Code size={12} />
              工具调用 ({toolCalls.length})
            </summary>
            <div className="text-xs text-gray-500 mt-1 space-y-1">
              {toolCalls.map((tool: ToolCall, idx: number) => (
                <div key={idx} className="bg-gray-900 rounded p-2">
                  <div className="font-mono text-blue-400">{tool.name}</div>
                  {tool.parameters && (
                    <pre className="text-xs text-gray-400 mt-1 overflow-x-auto">
                      {JSON.stringify(tool.parameters, null, 2)}
                    </pre>
                  )}
                  {toolResults?.find(r => r.name === tool.name) && (
                    <div className="mt-2 pt-2 border-t border-gray-700">
                      <div className="font-mono text-green-400">result</div>
                      <pre className="text-xs text-gray-300 mt-1 overflow-x-auto">
                        {JSON.stringify(toolResults.find(r => r.name === tool.name)?.result, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
        {thinking && (
          <details className="mb-1" open={false}>
            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300">
              思考过程
            </summary>
            <div className="text-xs text-gray-500 mt-1">{thinking}</div>
          </details>
        )}
        <div className="whitespace-pre-wrap">{content}</div>
        {isStreaming && <span className="inline-block ml-2 animate-pulse">▊</span>}
      </div>
    </div>
  );
}
