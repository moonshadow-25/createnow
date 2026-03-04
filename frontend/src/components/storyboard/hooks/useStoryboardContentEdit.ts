import { useState } from 'react';

export interface StoryboardContentEditState {
  contentExpanded: boolean;
  setContentExpanded: (v: boolean) => void;
  editDescription: string;
  setEditDescription: (v: string) => void;
  editDialogue: string;
  setEditDialogue: (v: string) => void;
  editAction: string;
  setEditAction: (v: string) => void;
  editShotType: string;
  setEditShotType: (v: string) => void;
  editCameraAngle: string;
  setEditCameraAngle: (v: string) => void;
  editDuration: number;
  setEditDuration: (v: number) => void;
  editResolution: string;
  setEditResolution: (v: string) => void;
  resetEditState: (storyboard?: any) => void;
}

/**
 * 分镜内容编辑状态管理 Hook
 * 用于管理分镜的描述、对话、动作、镜头类型、机位角度等编辑状态
 *
 * @returns 编辑状态和设置函数
 */
export const useStoryboardContentEdit = (): StoryboardContentEditState => {
  const [contentExpanded, setContentExpanded] = useState(false);
  const [editDescription, setEditDescription] = useState('');
  const [editDialogue, setEditDialogue] = useState('');
  const [editAction, setEditAction] = useState('');
  const [editShotType, setEditShotType] = useState('中景');
  const [editCameraAngle, setEditCameraAngle] = useState('平视');
  const [editDuration, setEditDuration] = useState(6);
  const [editResolution, setEditResolution] = useState('1920x1080');

  const resetEditState = (storyboard?: any) => {
    if (storyboard) {
      setEditDescription(storyboard.description || '');
      setEditDialogue(storyboard.dialogue || '');
      setEditAction(storyboard.action || '');
      setEditShotType(storyboard.shot_type || '中景');
      setEditCameraAngle(storyboard.camera_angle || '平视');
      setEditDuration(storyboard.duration || 6);
      setEditResolution(storyboard.resolution || '1920x1080');
    } else {
      setEditDescription('');
      setEditDialogue('');
      setEditAction('');
      setEditShotType('中景');
      setEditCameraAngle('平视');
      setEditDuration(6);
      setEditResolution('1920x1080');
    }
  };

  return {
    contentExpanded,
    setContentExpanded,
    editDescription,
    setEditDescription,
    editDialogue,
    setEditDialogue,
    editAction,
    setEditAction,
    editShotType,
    setEditShotType,
    editCameraAngle,
    setEditCameraAngle,
    editDuration,
    setEditDuration,
    editResolution,
    setEditResolution,
    resetEditState,
  };
};
