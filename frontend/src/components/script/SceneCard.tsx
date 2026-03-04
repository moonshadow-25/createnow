import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { scriptApi } from '@/services/api';

interface SceneCardProps {
  projectId: string;
  scriptId: string;
  scene: {
    scene_id: string;
    episode_id: string;
    sequence: number;
    location: string;
    time_of_day: string;
    interior_exterior: string;
    content: string;
    time_start?: string;
    time_end?: string;
    act_title?: string;
  };
  sceneNumber: number;
  characters: Array<{ name: string }>;
  onRefresh: () => void;
}

interface ShotLine {
  line_id: string;
  scene_id: string;
  line_type: string;
  sequence: number;
  content: string;
  character?: string;
  parenthetical?: string;
  dialogue?: string;
  visual_type?: string;
  visual_description?: string;
}

const CHINESE_NUMBERS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/** 从原始文本中解析结构化字段，用于保存时同步后端 */
function parseLineFields(content: string, lineType: string): Record<string, unknown> {
  const fields: Record<string, unknown> = { content };

  if (lineType === 'visual' || lineType === 'narration') {
    const desc = content.startsWith('△') ? content.substring(1).trim() : content;
    fields.visual_description = desc;
  } else if (lineType === 'dialogue') {
    // 匹配：角色名（情绪）：台词  或  角色名：台词
    const m = content.match(/^([^（(：:]+)(?:[（(]([^）)]+)[）)])?[：:](.+)$/);
    if (m) {
      fields.character = m[1].trim();
      fields.parenthetical = m[2]?.trim() || null;
      fields.dialogue = m[3].trim();
    }
  }

  return fields;
}

export function SceneCard({ projectId, scriptId, scene, sceneNumber, characters, onRefresh }: SceneCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [lines, setLines] = useState<ShotLine[]>([]);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [hoveredLineId, setHoveredLineId] = useState<string | null>(null);

  useEffect(() => {
    loadLines();
  }, [scene.scene_id]);

  const loadLines = async () => {
    try {
      const response = await scriptApi.listLines(projectId, scriptId, scene.scene_id);
      setLines(response.data.lines || []);
    } catch (error) {
      console.error('Failed to load lines:', error);
    }
  };

  const handleDeleteScene = async () => {
    if (!confirm('确定删除该场景吗？')) return;
    try {
      await scriptApi.deleteScene(projectId, scriptId, scene.scene_id);
      onRefresh();
    } catch (error: any) {
      alert(`删除失败: ${error.response?.data?.detail || error.message}`);
    }
  };

  const handleUpdateLine = async (lineId: string) => {
    const line = lines.find(l => l.line_id === lineId);
    if (!line) return;
    try {
      // 解析 content，同步更新结构化字段
      const fields = parseLineFields(editContent, line.line_type);
      await scriptApi.updateLine(projectId, scriptId, lineId, fields);
      setEditingLineId(null);
      setEditContent('');
      await loadLines();
    } catch (error: any) {
      alert(`更新失败: ${error.response?.data?.detail || error.message}`);
    }
  };

  const handleDeleteLine = async (lineId: string) => {
    if (!confirm('确定删除该行吗？')) return;
    try {
      await scriptApi.deleteLine(projectId, scriptId, lineId);
      await loadLines();
    } catch (error: any) {
      alert(`删除失败: ${error.response?.data?.detail || error.message}`);
    }
  };

  const handleAddLine = async (type: 'visual' | 'dialogue' | 'action') => {
    const newSequence = lines.length > 0 ? Math.max(...lines.map(l => l.sequence)) + 1 : 1;
    const charName = characters.length > 0 ? characters[0].name : '角色名';

    let lineData: Record<string, unknown> = { line_type: type, sequence: newSequence };

    if (type === 'visual') {
      lineData.content = '△ [视觉描述]';
      lineData.visual_description = '[视觉描述]';
    } else if (type === 'dialogue') {
      lineData.content = `${charName}：[台词]`;
      lineData.character = charName;
      lineData.dialogue = '[台词]';
      lineData.parenthetical = null;
    } else {
      lineData.content = '[动作描述]';
      lineData.visual_description = '[动作描述]';
    }

    try {
      await scriptApi.addLine(projectId, scriptId, scene.scene_id, lineData as any);
      await loadLines();
    } catch (error: any) {
      alert(`添加失败: ${error.response?.data?.detail || error.message}`);
    }
  };

  const getLineNumber = (sequence: number) => {
    const num = sequence || 1;
    return CHINESE_NUMBERS[num] || num;
  };

  const renderLineContent = (line: ShotLine) => {
    if (editingLineId === line.line_id) {
      return (
        <input
          type="text"
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          className="w-full bg-gray-600 border border-blue-500 rounded px-3 py-2 text-sm"
          autoFocus
          onBlur={() => handleUpdateLine(line.line_id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleUpdateLine(line.line_id);
            } else if (e.key === 'Escape') {
              setEditingLineId(null);
              setEditContent('');
            }
          }}
        />
      );
    }

    if (line.line_type === 'visual' || line.line_type === 'narration') {
      // 优先用 visual_description，否则从 content 中去掉 △ 前缀
      const desc = line.visual_description
        || (line.content?.startsWith('△') ? line.content.substring(1).trim() : line.content);
      const prefix = line.line_type === 'narration' ? 'OS' : '△';
      const prefixClass = line.line_type === 'narration' ? 'text-blue-400' : 'text-green-400';
      return (
        <div className="text-gray-200 w-full">
          <span className={`${prefixClass} font-mono mr-1`}>{prefix}</span>
          {desc}
        </div>
      );
    }

    if (line.line_type === 'dialogue') {
      // 优先用结构化字段；若 character 为空则尝试从 content 解析
      let character = line.character;
      let parenthetical = line.parenthetical;
      let dialogue = line.dialogue;

      if (!character && line.content) {
        const m = line.content.match(/^([^（(：:]+)(?:[（(]([^）)]+)[）)])?[：:](.+)$/);
        if (m) {
          character = m[1].trim();
          parenthetical = m[2]?.trim();
          dialogue = m[3].trim();
        }
      }

      return (
        <div className="text-gray-200 w-full">
          <span className="text-yellow-400 font-semibold">{character || '?'}</span>
          {parenthetical && <span className="text-gray-400">（{parenthetical}）</span>}
          <span className="text-gray-400 mx-1">：</span>
          <span className="text-gray-200">{dialogue || line.content}</span>
        </div>
      );
    }

    // action / 其他
    return <div className="text-gray-400 italic w-full">{line.content}</div>;
  };

  return (
    <div className="bg-gray-800 overflow-hidden w-full min-w-0 max-w-none">
      {/* 场景头 */}
      <div
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between px-4 py-3 bg-gray-750 hover:bg-gray-700 cursor-pointer transition border-b border-gray-700 w-full"
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? <ChevronDown size={16} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />}
          <span className="text-sm font-semibold text-gray-400 flex-shrink-0">
            {getLineNumber(sceneNumber)}、
          </span>
          <span className="text-base font-semibold truncate">{scene.location}</span>
          <span className="text-xs text-gray-500 flex-shrink-0">
            {scene.time_of_day} · {scene.interior_exterior}
          </span>
          {scene.act_title && (
            <span className="text-xs text-purple-400 flex-shrink-0">
              {scene.time_start && `${scene.time_start}-${scene.time_end} `}{scene.act_title}
            </span>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); handleDeleteScene(); }}
          className="text-red-400 hover:text-red-300 p-1 flex-shrink-0"
          title="删除场景"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* 场景内容 */}
      {expanded && (
        <div className="p-4 space-y-1 w-full min-w-0">
          {lines.map((line) => (
            <div
              key={line.line_id}
              className={`flex items-center justify-between group py-2 px-3 rounded transition w-full min-w-0 ${
                hoveredLineId === line.line_id ? 'bg-gray-700' : ''
              }`}
              onMouseEnter={() => setHoveredLineId(line.line_id)}
              onMouseLeave={() => setHoveredLineId(null)}
            >
              <div
                className="flex-1 cursor-text min-w-0"
                onClick={() => {
                  setEditingLineId(line.line_id);
                  setEditContent(line.content || '');
                }}
              >
                {renderLineContent(line)}
              </div>
              {hoveredLineId === line.line_id && editingLineId !== line.line_id && (
                <button
                  onClick={() => handleDeleteLine(line.line_id)}
                  className="text-gray-400 hover:text-red-400 transition ml-2 flex-shrink-0"
                  title="删除"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}

          {/* 添加新行按钮 */}
          <div className="flex items-center gap-3 pt-3 mt-2 border-t border-gray-700">
            <button
              onClick={() => handleAddLine('visual')}
              className="text-xs text-green-400 hover:text-green-300 px-2 py-1 rounded hover:bg-gray-700"
            >
              + 视觉
            </button>
            <button
              onClick={() => handleAddLine('dialogue')}
              className="text-xs text-yellow-400 hover:text-yellow-300 px-2 py-1 rounded hover:bg-gray-700"
            >
              + 对话
            </button>
            <button
              onClick={() => handleAddLine('action')}
              className="text-xs text-gray-400 hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-700"
            >
              + 动作
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
