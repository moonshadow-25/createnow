import { useState, useRef, useEffect } from 'react';
import { runWithConcurrency } from '../utils/concurrencyControl';
import { generationApi, storyboardApi } from '@/services/api';

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
  // 一键生成分镜图状态
  const [isOneClickGenerating, setIsOneClickGenerating] = useState(false);
  const [oneClickPhase, setOneClickPhase] = useState<'assets' | 'prompts' | 'images' | null>(null);
  const [oneClickProgress, setOneClickProgress] = useState({ current: 0, total: 0 });
  const [oneClickFailures, setOneClickFailures] = useState<Array<{ sequence: number; phase: string; error: string }>>([]);
  const oneClickAbortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  // 组件卸载时清理
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (oneClickAbortRef.current) {
        oneClickAbortRef.current.abort();
      }
    };
  }, []);

  /**
   * 一键生成分镜图：自动匹配资产、生成提示词、生成图片
   */
  const handleOneClickGenerate = async () => {
    // 0. 预检查
    if (storyboards.length === 0) {
      toast('当前没有分镜，请先生成或创建分镜', 'error');
      return;
    }

    // 统计各阶段需要处理的分镜数量
    // 关键：如果已经有图片了，就认为该分镜已完成，不再处理
    const needAssets = storyboards.filter(sb =>
      !sb.primary_image_url && // 没有图片才处理
      !sb.scene_id &&
      (!sb.character_ids || sb.character_ids.length === 0)
    );
    const needPrompts = storyboards.filter(sb =>
      !sb.primary_image_url && // 没有图片才处理
      !sb.image_prompt
    );
    const needImages = storyboards.filter(sb => !sb.primary_image_url);

    // 检查是否有提示词但无资产的情况
    // 关键：如果已经有图片了，就认为该分镜已完成，不再处理
    const hasPromptNoAssets = storyboards.filter(sb =>
      !sb.primary_image_url && // 没有图片才处理
      sb.image_prompt &&
      !sb.scene_id &&
      (!sb.character_ids || sb.character_ids.length === 0)
    );

    if (needAssets.length === 0 && needPrompts.length === 0 && needImages.length === 0) {
      toast('所有分镜已完成生成', 'info');
      return;
    }

    // 确认对话框
    let confirmMessage = `即将执行一键生成分镜图（最多10个并发）：\n`;
    if (needAssets.length > 0) confirmMessage += `- 匹配资产：${needAssets.length}个分镜\n`;
    if (needPrompts.length > 0) confirmMessage += `- 生成提示词：${needPrompts.length}个分镜\n`;
    if (needImages.length > 0) confirmMessage += `- 生成图片：${needImages.length}个分镜\n`;
    if (hasPromptNoAssets.length > 0) {
      confirmMessage += `\n注意：检测到${hasPromptNoAssets.length}个分镜有提示词但无资产，将先匹配资产后重新生成提示词\n`;
    }
    confirmMessage += `\n此操作可能需要一定时间，确认继续？`;

    if (!confirm(confirmMessage)) {
      return;
    }

    // 创建 AbortController
    oneClickAbortRef.current = new AbortController();
    setIsOneClickGenerating(true);
    setOneClickFailures([]);

    try {
      // 清空有提示词但无资产的分镜的提示词
      if (hasPromptNoAssets.length > 0) {
        await Promise.all(
          hasPromptNoAssets.map(sb =>
            storyboardApi.update(projectId, sb.asset_id, { image_prompt: null })
          )
        );
        // 刷新分镜列表
        await loadStoryboards();
      }

      const failedAssetMatches = new Set<string>();
      const failedPromptGenerations = new Set<string>();

      // 阶段1：自动匹配资产（并发）
      // 关键：如果已经有图片了，就认为该分镜已完成，不再处理
      const storyboardsNeedAssets = storyboards.filter(sb =>
        !sb.primary_image_url && // 没有图片才处理
        !sb.scene_id &&
        (!sb.character_ids || sb.character_ids.length === 0)
      );

      if (storyboardsNeedAssets.length > 0 && isMountedRef.current) {
        setOneClickPhase('assets');
        setOneClickProgress({ current: 0, total: storyboardsNeedAssets.length });

        const assetResults = await runWithConcurrency(
          storyboardsNeedAssets,
          async (sb: any) => {
            const response = await storyboardApi.autoMatchAssets(projectId, sb.asset_id);
            return response.data;
          },
          10,
          (completed, total) => {
            if (isMountedRef.current) {
              setOneClickProgress({ current: completed, total });
            }
          },
          isMountedRef
        );

        // 统计失败
        const assetFailures = assetResults.filter(r => !r.success && r.error !== 'Aborted');
        assetFailures.forEach(r => {
          failedAssetMatches.add((r.task as any).asset_id);
          setOneClickFailures(prev => [...prev, {
            sequence: (r.task as any).sequence,
            phase: '资产匹配',
            error: r.error?.message || '未知错误'
          }]);
        });

        if (!isMountedRef.current) return;

        const successCount = assetResults.filter(r => r.success).length;
        if (assetFailures.length > 0) {
          const failedSeqs = assetFailures.map(r => `#${(r.task as any).sequence}`).slice(0, 3).join(', ');
          toast(
            `资产匹配完成: ${successCount}/${storyboardsNeedAssets.length}\n失败: ${failedSeqs}${assetFailures.length > 3 ? '...' : ''}`,
            'info'
          );
        } else if (successCount > 0) {
          toast(`资产匹配完成: ${successCount}个`, 'success');
        }

        // 刷新分镜列表获取最新的资产匹配结果
        await loadStoryboards();
      }

      // 阶段2：生成提示词（并发）
      if (isMountedRef.current) {
        // ✅ 重新从API获取最新数据（包含阶段1匹配的资产）
        const updatedStoryboards = await loadStoryboards();

        // 筛选需要生成提示词的分镜
        // 关键：如果已经有图片了，就认为该分镜已完成，不再处理
        const storyboardsNeedPrompts = updatedStoryboards.filter((sb: any) => {
          if (sb.primary_image_url) return false; // 已有图片，跳过
          if (sb.image_prompt) return false; // 已有提示词，跳过

          // 九宫格分镜：只要没有提示词就处理（资产匹配后直接生成）
          if (sb.storyboard_mode === 'nine_grid') return true;

          const hasAssets = sb.scene_id || (sb.character_ids && sb.character_ids.length > 0);
          const assetMatchFailed = failedAssetMatches.has(sb.asset_id);

          // 有资产 或者 资产匹配失败（尝试无资产生成）
          return hasAssets || assetMatchFailed;
        });

        if (storyboardsNeedPrompts.length > 0 && isMountedRef.current) {
          setOneClickPhase('prompts');
          setOneClickProgress({ current: 0, total: storyboardsNeedPrompts.length });

          const promptResults = await runWithConcurrency(
            storyboardsNeedPrompts,
            async (sb: any) => {
              // 收集资产信息
              const charObjs = (sb.character_ids || [])
                .map((id: string) => characters.find(c => c.asset_id === id))
                .filter(Boolean);
              const sceneObj = scenes.find(s => s.asset_id === sb.scene_id);
              const propObjs = (sb.prop_ids || [])
                .map((id: string) => props.find(p => p.asset_id === id))
                .filter(Boolean);

              // 判断是否使用图生图模式
              const hasAssets = charObjs.length > 0 || sceneObj || propObjs.length > 0;

              let enhancedDescription = sb.description || '';

              if (hasAssets) {
                // 图生图模式：构建参考图像描述
                const referenceImages = [];
                let imageIndex = 1;

                charObjs.forEach((c: any) => {
                  const genderEn = c.gender === '男' ? 'man' : 'woman';
                  const agePart = c.age ? `${c.age}-year-old ` : '';
                  referenceImages.push(`image${imageIndex}: the ${agePart}${genderEn}`);
                  imageIndex++;
                });

                if (sceneObj) {
                  referenceImages.push(`image${imageIndex}: the ${sceneObj.name} scene`);
                  imageIndex++;
                }

                propObjs.forEach((p: any) => {
                  referenceImages.push(`image${imageIndex}: the ${p.name}`);
                  imageIndex++;
                });

                enhancedDescription = referenceImages.join('\n') + '\n\n' + sb.description;
                if (sb.shot_type) enhancedDescription += `\n镜头类型: ${sb.shot_type}`;
                if (sb.camera_angle) enhancedDescription += `\n机位角度: ${sb.camera_angle}`;
                if (sb.action) enhancedDescription += `\n动作: ${sb.action}`;
                if (sb.dialogue) enhancedDescription += `\n对白: ${sb.dialogue}`;
              } else {
                // 纯文生图模式
                enhancedDescription = sb.description || '';
                if (sb.shot_type) enhancedDescription += `\n镜头类型: ${sb.shot_type}`;
                if (sb.camera_angle) enhancedDescription += `\n机位角度: ${sb.camera_angle}`;
                if (sb.action) enhancedDescription += `\n动作: ${sb.action}`;
                if (sb.dialogue) enhancedDescription += `\n对白: ${sb.dialogue}`;
              }

              // 生成提示词
              if (sb.storyboard_mode === 'nine_grid') {
                // 九宫格：一次调用同时生成 image_prompt + video_prompt
                await storyboardApi.generateNineGridPrompts(projectId, sb.asset_id);
                return { hasAssets: true };
              }

              await generationApi.generateImagePrompt(projectId, {
                asset_type: 'storyboard',
                description: enhancedDescription,
                shot_type: sb.shot_type || '',
                action: sb.action || '',
                camera_angle: sb.camera_angle || '',
                use_image_edit: hasAssets,  // ✅ 根据是否有资产选择模板（图生图/文生图）
                asset_id: sb.asset_id,  // 传入 storyboard ID，后端会自动保存
              });

              // 后端已自动保存，不需要手动保存
              return { hasAssets };
            },
            10,
            (completed, total) => {
              if (isMountedRef.current) {
                setOneClickProgress({ current: completed, total });
              }
            },
            isMountedRef
          );

          // 统计失败
          const promptFailures = promptResults.filter(r => !r.success && r.error !== 'Aborted');
          promptFailures.forEach(r => {
            failedPromptGenerations.add((r.task as any).asset_id);
            setOneClickFailures(prev => [...prev, {
              sequence: (r.task as any).sequence,
              phase: '提示词生成',
              error: r.error?.message || '未知错误'
            }]);
          });

          if (!isMountedRef.current) return;

          const successCount = promptResults.filter(r => r.success).length;
          if (promptFailures.length > 0) {
            const failedSeqs = promptFailures.map(r => `#${(r.task as any).sequence}`).slice(0, 3).join(', ');
            toast(
              `提示词生成完成: ${successCount}/${storyboardsNeedPrompts.length}\n失败: ${failedSeqs}${promptFailures.length > 3 ? '...' : ''}`,
              'info'
            );
          } else if (successCount > 0) {
            toast(`提示词生成完成: ${successCount}个`, 'success');
          }

          // 刷新分镜列表获取最新的提示词
          await loadStoryboards();
        }
      }

      // 阶段3：生成图片（并发）
      if (isMountedRef.current) {
        // ✅ 重新从API获取最新数据（包含阶段2生成的提示词）
        const finalStoryboards = await loadStoryboards();

        // 筛选需要生成图片的分镜
        const storyboardsNeedImages = finalStoryboards.filter((sb: any) =>
          !sb.primary_image_url &&
          sb.image_prompt &&
          !failedPromptGenerations.has(sb.asset_id)
        );

        if (storyboardsNeedImages.length > 0 && isMountedRef.current) {
          setOneClickPhase('images');
          setOneClickProgress({ current: 0, total: storyboardsNeedImages.length });

          const imageResults = await runWithConcurrency(
            storyboardsNeedImages,
            async (sb: any) => {
              // 收集资产的image_id（用于图生图）
              const referenceImageIds = [];

              if (sb.character_ids && sb.character_ids.length > 0) {
                for (const charId of sb.character_ids) {
                  const char = characters.find(c => c.asset_id === charId);
                  if (char?.image_id) {
                    referenceImageIds.push(char.image_id);
                  }
                }
              }

              if (sb.scene_id) {
                const scene = scenes.find(s => s.asset_id === sb.scene_id);
                if (scene?.image_id) {
                  referenceImageIds.push(scene.image_id);
                }
              }

              if (sb.prop_ids && sb.prop_ids.length > 0) {
                for (const propId of sb.prop_ids) {
                  const prop = props.find(p => p.asset_id === propId);
                  if (prop?.image_id) {
                    referenceImageIds.push(prop.image_id);
                  }
                }
              }

              // 判断使用哪个API
              if (referenceImageIds.length > 0) {
                // 图生图模式（image-edit）
                // ✅ 不传递 size 参数，使用后端配置的全局比例格式（如 16x9）
                await generationApi.editImage(projectId, {
                  assetId: sb.asset_id,
                  assetType: 'storyboard',
                  prompt: sb.image_prompt,
                  referenceImageIds
                });
              } else {
                // 纯文生图模式
                // ✅ 使用分镜标准分辨率 1920x1080
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
              if (isMountedRef.current) {
                setOneClickProgress({ current: completed, total });
              }
            },
            isMountedRef
          );

          // 统计失败
          const imageFailures = imageResults.filter(r => !r.success && r.error !== 'Aborted');
          imageFailures.forEach(r => {
            setOneClickFailures(prev => [...prev, {
              sequence: (r.task as any).sequence,
              phase: '图片生成',
              error: r.error?.message || '未知错误'
            }]);
          });

          if (!isMountedRef.current) return;

          const successCount = imageResults.filter(r => r.success).length;
          if (imageFailures.length > 0) {
            const failedSeqs = imageFailures.map(r => `#${(r.task as any).sequence}`).slice(0, 3).join(', ');
            toast(
              `图片生成完成: ${successCount}/${storyboardsNeedImages.length}\n失败: ${failedSeqs}${imageFailures.length > 3 ? '...' : ''}`,
              'info'
            );
          } else if (successCount > 0) {
            toast(`图片生成完成: ${successCount}个`, 'success');
          }

          // 刷新分镜列表获取最新的图片
          await loadStoryboards();
        }
      }

      // 完成
      if (isMountedRef.current) {
        toast('一键生成分镜图完成！', 'success');
        await loadStoryboards();
        onUpdated();
      }

    } catch (error: any) {
      if (isMountedRef.current) {
        console.error('一键生成分镜图失败:', error);
        // 忽略中止错误
        if (error.name !== 'AbortError') {
          toast('一键生成失败: ' + (error.message || '未知错误'), 'error');
        }
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
    handleOneClickGenerate
  };
}
