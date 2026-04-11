import { useState, useRef, useEffect } from 'react';
import { runWithConcurrency } from '../utils/concurrencyControl';
import { generationApi } from '@/services/api';

type ToastType = 'success' | 'error' | 'info';

interface UseOneClickGenerationProps {
  projectId: string;
  storyboards: any[];
  characters: any[];
  scenes: any[];
  props: any[];
  toast: (message: string, type?: ToastType, duration?: number) => void;
  loadStoryboards: () => Promise<any[]>;
  onUpdated: () => void;
}

export function useOneClickGeneration({
  projectId,
  storyboards,
  characters,
  scenes,
  props,
  toast,
  loadStoryboards,
  onUpdated
}: UseOneClickGenerationProps) {
  const [isOneClickGenerating, setIsOneClickGenerating] = useState(false);
  const [oneClickPhase, setOneClickPhase] = useState<'assets' | 'prompts' | 'images' | null>(null);
  const [oneClickProgress, setOneClickProgress] = useState({ current: 0, total: 0 });
  const [oneClickFailures, setOneClickFailures] = useState<Array<{ sequence: number; phase: string; error: string }>>([]);
  const oneClickAbortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (oneClickAbortRef.current) {
        oneClickAbortRef.current.abort();
      }
    };
  }, []);

  /** 返回有 image_prompt 且尚未生图的分镜数量 */
  const getEligibleCount = () =>
    storyboards.filter(sb => !sb.primary_image_url && sb.image_prompt).length;

  const handleOneClickGenerate = async () => {
    const storyboardsNeedImages = storyboards.filter(sb => !sb.primary_image_url && sb.image_prompt);

    if (storyboardsNeedImages.length === 0) {
      toast('暂无可生成的分镜（请先为分镜添加图片提示词）', 'info');
      return;
    }

    oneClickAbortRef.current = new AbortController();
    setIsOneClickGenerating(true);
    setOneClickFailures([]);

    try {
      setOneClickPhase('images');
      setOneClickProgress({ current: 0, total: storyboardsNeedImages.length });

      const imageResults = await runWithConcurrency(
        storyboardsNeedImages,
        async (sb: any) => {
          const referenceImageIds: string[] = [];

          if (sb.character_ids && sb.character_ids.length > 0) {
            for (const charId of sb.character_ids) {
              const char = characters.find(c => c.asset_id === charId);
              if (char?.image_id) referenceImageIds.push(char.image_id);
            }
          }
          if (sb.scene_id) {
            const scene = scenes.find(s => s.asset_id === sb.scene_id);
            if (scene?.image_id) referenceImageIds.push(scene.image_id);
          }
          if (sb.prop_ids && sb.prop_ids.length > 0) {
            for (const propId of sb.prop_ids) {
              const prop = props.find(p => p.asset_id === propId);
              if (prop?.image_id) referenceImageIds.push(prop.image_id);
            }
          }

          if (referenceImageIds.length > 0) {
            await generationApi.editImage(projectId, {
              assetId: sb.asset_id,
              assetType: 'storyboard',
              prompt: sb.image_prompt,
              referenceImageIds,
            });
          } else {
            await generationApi.generateImage(projectId, {
              asset_id: sb.asset_id,
              asset_type: 'storyboard',
              prompt: sb.image_prompt,
              negative_prompt: '',
              width: 1920,
              height: 1080,
            });
          }

          return { referenceImageIds };
        },
        10,
        (completed, total) => {
          if (isMountedRef.current) setOneClickProgress({ current: completed, total });
        },
        isMountedRef
      );

      const imageFailures = imageResults.filter(r => !r.success && r.error !== 'Aborted');
      imageFailures.forEach(r => {
        setOneClickFailures(prev => [...prev, {
          sequence: (r.task as any).sequence,
          phase: '图片生成',
          error: r.error?.message || '未知错误',
        }]);
      });

      if (!isMountedRef.current) return;

      const successCount = imageResults.filter(r => r.success).length;
      if (imageFailures.length > 0) {
        const failedSeqs = imageFailures.map(r => `#${(r.task as any).sequence}`).slice(0, 3).join(', ');
        toast(
          `图片生成完成: ${successCount}/${storyboardsNeedImages.length}，失败: ${failedSeqs}${imageFailures.length > 3 ? '...' : ''}`,
          'info'
        );
      } else {
        toast(`图片生成完成: ${successCount}个`, 'success');
      }

      await loadStoryboards();
      onUpdated();
    } catch (error: any) {
      if (isMountedRef.current && error.name !== 'AbortError') {
        toast('一键生成失败: ' + (error.message || '未知错误'), 'error');
      }
    } finally {
      if (isMountedRef.current) {
        setIsOneClickGenerating(false);
        setOneClickPhase(null);
        setOneClickProgress({ current: 0, total: 0 });
        oneClickAbortRef.current = null;
      }
    }
  };

  return {
    isOneClickGenerating,
    oneClickPhase,
    oneClickProgress,
    oneClickFailures,
    getEligibleCount,
    handleOneClickGenerate,
  };
}
