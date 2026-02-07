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

// 中文数字序号
const CHINESE_NUMBERS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

export function SceneCard({ projectId, scriptId, scene, sceneNumber, characters, onRefresh }: SceneCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [lines, setLines] = useState<ShotLine[]>([]);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [hoveredLineId, setHoveredLineId] = useState<string | null>(null);

  useEffect(() => {
    loadLines();
  }, [scene]);

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
    try {
      await scriptApi.updateLine(projectId, scriptId, lineId, { content: editContent });
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
    let content = '';

    if (type === 'visual') {
      content = '△ [视觉描述]';
    } else if (type === 'dialogue') {
      const charName = characters.length > 0 ? characters[0].name : '角色名';
      content = `${charName}：[台词]`;
    } else {
      content = '[动作描述]';
    }

    try {
      await scriptApi.addLine(projectId, scriptId, scene.scene_id, {
        line_type: type,
        content,
        sequence: newSequence
      });
      await loadLines();
    } catch (error: any) {
      alert(`添加失败: ${error.response?.data?.detail || error.message}`);
    }
  };

  const getLineNumber = (sequence: number) => {
    const num = sequence || 1;
    return CHINESE_NUMBERS[num] || num;
  };

  // 渲染可编辑的行内容
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

    // 根��行类型渲染
    if (line.line_type === 'visual') {
      return (
        <div className="text-gray-200 w-full">
          <span className="text-green-400 font-mono mr-1">△</span>
          {line.content.substring(1).trim()}
        </div>
      );
    } else if (line.line_type === 'dialogue') {
      const parenthetical = line.parenthetical ? `（${line.parenthetical}）` : '';
      return (
        <div className="text-gray-200 w-full">
          <span className="text-yellow-400 font-semibold">{line.character}</span>
          {parenthetical}
          <span className="text-gray-400 mx-1">：</span>
          <span className="text-gray-200">{line.dialogue}</span>
        </div>
      );
    } else {
      return (
        <div className="text-gray-200 w-full">{line.content}</div>
      );
    }
  };

  return (
    <div className="bg-gray-800 overflow-hidden w-full min-w-0 max-w-none">
      {/* 场景头 */}
      <div
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between px-4 py-3 bg-gray-750 hover:bg-gray-700 cursor-pointer transition border-b border-gray-700 w-full"
      >
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          <span className="text-sm font-semibold text-gray-400">
            {getLineNumber(sceneNumber)}、
          </span>
          <span className="text-base font-semibold">{scene.location}</span>
          <span className="text-xs text-gray-500">
            {scene.time_of_day} · {scene.interior_exterior}
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDeleteScene();
          }}
          className="text-red-400 hover:text-red-300 p-1"
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
                  setEditContent(line.content);
                }}
              >
                {renderLineContent(line)}
              </div>
              {hoveredLineId === line.line_id && editingLineId !== line.line_id && (
                <button
                  onClick={() => handleDeleteLine(line.line_id)}
                  className="text-gray-400 hover:text-red-400 transition ml-2"
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
