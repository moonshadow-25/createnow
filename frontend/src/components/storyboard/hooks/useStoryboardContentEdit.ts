import { useState, useEffect } from 'react';
import { useGlobalStyleStore } from '@/store/globalStyleStore';

function normalizeStoryboardResolution(globalResolution?: string): string {
  if (!globalResolution) return '1280x720';
  if (globalResolution === '1280x720' || globalResolution === '720x1280' || globalResolution === '21:9-720p') {
    return globalResolution;
  }

  if (globalResolution === '16:9-720p') return '1280x720';
  if (globalResolution === '9:16-720p') return '720x1280';

  if (globalResolution.endsWith('-480p')) return globalResolution.replace(/-480p$/, '-720p');
  if (globalResolution.endsWith('-1080p')) return globalResolution.replace(/-1080p$/, '-720p');

  return globalResolution;
}

export interface StoryboardContentEditState {
  contentExpanded: boolean;
  setContentExpanded: (v: boolean) => void;
  editDescription: string;
  setEditDescription: (v: string) => void;
  editScriptSceneLabel: string;
  setEditScriptSceneLabel: (v: string) => void;
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
  const [editScriptSceneLabel, setEditScriptSceneLabel] = useState('');
  const [editDialogue, setEditDialogue] = useState('');
  const [editAction, setEditAction] = useState('');
  const [editShotType, setEditShotType] = useState('中景');
  const [editCameraAngle, setEditCameraAngle] = useState('平视');
  const [editDuration, setEditDuration] = useState(6);
  const [editResolution, setEditResolution] = useState('1280x720');

  // 全局分辨率变化时同步更新
  useEffect(() => {
    setEditResolution(normalizeStoryboardResolution(global_resolution));
  }, [global_resolution]);

  const resetEditState = (storyboard?: any) => {
    if (storyboard) {
      setEditDescription(storyboard.description || '');
      setEditScriptSceneLabel(storyboard.script_scene_label || '');
      setEditDialogue(storyboard.dialogue || '');
      setEditAction(storyboard.action || '');
      setEditShotType(storyboard.shot_type || '中景');
      setEditCameraAngle(storyboard.camera_angle || '平视');
      setEditDuration(storyboard.duration || 6);
      setEditResolution(normalizeStoryboardResolution(global_resolution));
    } else {
      setEditDescription('');
      setEditScriptSceneLabel('');
      setEditDialogue('');
      setEditAction('');
      setEditShotType('中景');
      setEditCameraAngle('平视');
      setEditDuration(6);
      setEditResolution(normalizeStoryboardResolution(global_resolution));
    }
  };

  return {
    contentExpanded,
    setContentExpanded,
    editDescription,
    setEditDescription,
    editScriptSceneLabel,
    setEditScriptSceneLabel,
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
