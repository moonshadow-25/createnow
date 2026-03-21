import { useState, useEffect } from 'react';
import { useGlobalStyleStore } from '@/store/globalStyleStore';

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

export const useStoryboardContentEdit = (): StoryboardContentEditState => {
  const global_resolution = useGlobalStyleStore(s => s.global_resolution);
  const [contentExpanded, setContentExpanded] = useState(false);
  const [editDescription, setEditDescription] = useState('');
  const [editDialogue, setEditDialogue] = useState('');
  const [editAction, setEditAction] = useState('');
  const [editShotType, setEditShotType] = useState('中景');
  const [editCameraAngle, setEditCameraAngle] = useState('平视');
  const [editDuration, setEditDuration] = useState(6);
  const [editResolution, setEditResolution] = useState('1280x720');

  // 全局分辨率变化时同步更新
  useEffect(() => {
    setEditResolution(global_resolution || '1280x720');
  }, [global_resolution]);

  const resetEditState = (storyboard?: any) => {
    if (storyboard) {
      setEditDescription(storyboard.description || '');
      setEditDialogue(storyboard.dialogue || '');
      setEditAction(storyboard.action || '');
      setEditShotType(storyboard.shot_type || '中景');
      setEditCameraAngle(storyboard.camera_angle || '平视');
      setEditDuration(storyboard.duration || 6);
      setEditResolution(global_resolution || '1280x720');
    } else {
      setEditDescription('');
      setEditDialogue('');
      setEditAction('');
      setEditShotType('中景');
      setEditCameraAngle('平视');
      setEditDuration(6);
      setEditResolution(global_resolution || '1280x720');
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
