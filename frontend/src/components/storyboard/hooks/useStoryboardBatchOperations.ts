import { useCallback } from 'react';
import { storyboardApi, generationApi } from '@/services/api';

interface BatchOperationsContext {
  projectId: string;
  selectedEpisode: any;
  toast: (message: string, type: 'success' | 'error') => void;
  startTask: (taskId: string, type: any) => void;
  completeTask: (taskId: string, type: any) => void;
  failTask: (taskId: string, type: any, error: string) => void;
  loadStoryboards: () => Promise<void>;
}

/**
 * 分镜批量操作 Hook
 * 提供插入分镜、多图融合、插入中间分镜、首尾帧视频等批量操作功能
 *
 * @param context 操作上下文，包含 projectId、selectedEpisode、toast 等
 * @returns 批量操作函数
 */
export const useStoryboardBatchOperations = (context: BatchOperationsContext) => {
  const { projectId, selectedEpisode, toast, startTask, completeTask, failTask, loadStoryboards } = context;

  /**
   * 执行插入分镜
   * 在指定分镜后插入新分镜，支持 VLM 智能分析
   */
  const executeInsertStoryboard = useCallback(async (afterStoryboard: any, prompt: string) => {
    if (!selectedEpisode) return;

    const taskId = `insert_${Date.now()}`;
    startTask(taskId, 'insert_storyboard');

    try {
      // 检查是否需要 VLM 分析
      let finalPrompt = prompt;
      let vlmParams = null;

      try {
        const parsed = JSON.parse(prompt);
        if (parsed.__needVLM) {
          vlmParams = parsed;
          finalPrompt = '正在智能分析中...'; // 占位提示词
        }
      } catch {
        // 不是 JSON，使用原始 prompt
      }

      // 1. 立即创建新分镜（使用占位提示词）
      const newSequence = afterStoryboard.sequence + 1;
      const createResponse = await storyboardApi.create(projectId, {
        episode_id: selectedEpisode.asset_id,
        sequence: newSequence,
        description: finalPrompt,
        dialogue: '',
        action: '',
        shot_type: '中景',
        camera_angle: '平视',
        character_ids: [],
        scene_id: '',
        prop_ids: []
      });

      const newStoryboard = createResponse.data;
      toast('新分镜已创建' + (vlmParams ? '，正在智能分析...' : '，正在生成图片...'), 'success');

      // 2. 重新编号
      await storyboardApi.renumber(projectId, selectedEpisode.asset_id);

      // 3. 刷新列表
      await loadStoryboards();

      // 4. 如果需要 VLM，先分析再生成图片；否则直接生成
      if (vlmParams) {
        // 后台异步执行 VLM 分析
        (async () => {
          try {
            const vlmResponse = await generationApi.analyzeWithVLM(projectId, {
              image_ids: vlmParams.imageIds,
              user_goal: vlmParams.userGoal,
              descriptions: vlmParams.descriptions,
              shot_types: vlmParams.shot_types,
              camera_angles: vlmParams.camera_angles,
              actions: vlmParams.actions,
              dialogues: vlmParams.dialogues,
            });

            const analyzedPrompt = vlmResponse.data.prompt;

            // 更新分镜的描述
            await storyboardApi.update(projectId, newStoryboard.asset_id, {
              description: analyzedPrompt
            });

            // 使用分析后的提示词生成图片
            if (afterStoryboard.image_id) {
              const imageResponse = await generationApi.editImage(projectId, {
                assetId: newStoryboard.asset_id,
                assetType: 'storyboard',
                prompt: analyzedPrompt,
                referenceImageIds: [afterStoryboard.image_id]
              });

              if (imageResponse.data?.image_id) {
                await generationApi.setPrimaryImage(projectId, newStoryboard.asset_id, imageResponse.data.image_id);
                await loadStoryboards();
                toast('智能生成完成', 'success');
              }
            }
          } catch (error: any) {
            console.error('VLM analysis failed:', error);
            toast(`智能分析失败: ${error.response?.data?.detail || error.message}`, 'error');
          }
        })();
      } else if (afterStoryboard.image_id) {
        // 直接生成（不需要 VLM）
        try {
          const imageResponse = await generationApi.editImage(projectId, {
            assetId: newStoryboard.asset_id,
            assetType: 'storyboard',
            prompt: finalPrompt,
            referenceImageIds: [afterStoryboard.image_id]
          });

          if (imageResponse.data?.image_id) {
            await generationApi.setPrimaryImage(projectId, newStoryboard.asset_id, imageResponse.data.image_id);
            await loadStoryboards();
            toast('分镜图片生成完成', 'success');
          }
        } catch (imageError: any) {
          console.error('Image generation failed:', imageError);
          toast(`图片生成失败: ${imageError.response?.data?.detail || imageError.message}`, 'error');
        }
      }

      completeTask(taskId, 'insert_storyboard');
    } catch (error: any) {
      console.error('Insert storyboard failed:', error);
      toast(`插入分镜失败: ${error.response?.data?.detail || error.message}`, 'error');
      failTask(taskId, 'insert_storyboard', error.message);
      throw error;
    }
  }, [projectId, selectedEpisode, toast, startTask, completeTask, failTask, loadStoryboards]);

  /**
   * 执行多图融合
   * 将多个分镜的图片融合成一个新分镜
   */
  const executeMultiImageFusion = useCallback(async (selectedArray: any[], prompt: string) => {
    if (!selectedEpisode) return;

    const taskId = `multi_fusion_${Date.now()}`;
    startTask(taskId, 'multi_fusion');

    try {
      // 检查是否需要 VLM 分析
      let finalPrompt = prompt;
      let vlmParams = null;

      try {
        const parsed = JSON.parse(prompt);
        if (parsed.__needVLM) {
          vlmParams = parsed;
          finalPrompt = '正在智能分析中...'; // 占位提示词
        }
      } catch {
        // 不是 JSON，使用原始 prompt
      }

      // 1. 创建新分镜
      const lastStoryboard = selectedArray[selectedArray.length - 1];
      const newSequence = lastStoryboard.sequence + 1;
      const createResponse = await storyboardApi.create(projectId, {
        episode_id: selectedEpisode.asset_id,
        sequence: newSequence,
        description: `多图融合: ${finalPrompt}`,
        character_ids: [],
        scene_id: '',
        prop_ids: [],
        camera_angle: '',
        shot_type: '',
        dialogue: '',
        action: '',
        image_prompt: finalPrompt
      });

      const newStoryboard = createResponse.data;
      toast('新分镜已创建' + (vlmParams ? '，正在智能分析...' : '，正在生成融合图片...'), 'success');

      // 2. 重新编号
      await storyboardApi.renumber(projectId, selectedEpisode.asset_id);

      // 3. 刷新列表
      await loadStoryboards();

      // 4. 如果需要 VLM，先分析再生成图片；否则直接生成
      if (vlmParams) {
        // 后台异步执行 VLM 分析
        (async () => {
          try {
            const vlmResponse = await generationApi.analyzeWithVLM(projectId, {
              image_ids: vlmParams.imageIds,
              user_goal: vlmParams.userGoal,
              descriptions: vlmParams.descriptions,
              shot_types: vlmParams.shot_types,
              camera_angles: vlmParams.camera_angles,
              actions: vlmParams.actions,
              dialogues: vlmParams.dialogues,
            });

            const analyzedPrompt = vlmResponse.data.prompt;

            // 更新分镜的描述
            await storyboardApi.update(projectId, newStoryboard.asset_id, {
              description: `多图融合: ${analyzedPrompt}`,
              image_prompt: analyzedPrompt
            });

            // 使用分析后的提示词生成图片
            const imageIds = selectedArray.map(sb => sb.image_id).filter(id => id);
            if (imageIds.length > 0) {
              const imageResponse = await generationApi.editImage(projectId, {
                assetId: newStoryboard.asset_id,
                assetType: 'storyboard',
                prompt: analyzedPrompt,
                referenceImageIds: imageIds
              });

              if (imageResponse.data) {
                await loadStoryboards();
                toast('智能融合完成', 'success');
              }
            }
          } catch (error: any) {
            console.error('VLM analysis failed:', error);
            toast(`智能分析失败: ${error.response?.data?.detail || error.message}`, 'error');
          }
        })();
      } else {
        // 直接生成（不需要 VLM）
        try {
          const imageIds = selectedArray.map(sb => sb.image_id).filter(id => id);

          if (imageIds.length > 0) {
            const imageResponse = await generationApi.editImage(projectId, {
              assetId: newStoryboard.asset_id,
              assetType: 'storyboard',
              prompt: finalPrompt,
              referenceImageIds: imageIds
            });

            if (imageResponse.data) {
              await loadStoryboards();
              toast('多图融合完成', 'success');
            }
          }
        } catch (imageError: any) {
          console.error('Multi-image fusion failed:', imageError);
          toast(`融合图片生成失败: ${imageError.response?.data?.detail || imageError.message}`, 'error');
        }
      }

      completeTask(taskId, 'multi_fusion');
    } catch (error: any) {
      console.error('Multi-image fusion failed:', error);
      toast(`多图融合失败: ${error.response?.data?.detail || error.message}`, 'error');
      failTask(taskId, 'multi_fusion', error.message);
      throw error;
    }
  }, [projectId, selectedEpisode, toast, startTask, completeTask, failTask, loadStoryboards]);

  /**
   * 执行插入中间分镜
   * 在两个分镜之间插入过渡分镜
   */
  const executeInsertInbetween = useCallback(async (firstStoryboard: any, secondStoryboard: any, prompt: string) => {
    if (!selectedEpisode) return;

    const taskId = `inbetween_${Date.now()}`;
    startTask(taskId, 'inbetween');

    try {
      // 检查是否需要 VLM 分析
      let finalPrompt = prompt;
      let vlmParams = null;

      try {
        const parsed = JSON.parse(prompt);
        if (parsed.__needVLM) {
          vlmParams = parsed;
          finalPrompt = '正在智能分析中...'; // 占位提示词
        }
      } catch {
        // 不是 JSON，使用原始 prompt
      }

      // 1. 创建新分镜
      const newSequence = firstStoryboard.sequence + 1;
      const createResponse = await storyboardApi.create(projectId, {
        episode_id: selectedEpisode.asset_id,
        sequence: newSequence,
        description: finalPrompt,
        character_ids: [],
        scene_id: '',
        prop_ids: [],
        camera_angle: '',
        shot_type: '',
        dialogue: '',
        action: '',
        image_prompt: finalPrompt
      });

      const newStoryboard = createResponse.data;
      toast('中间分镜已创建' + (vlmParams ? '，正在智能分析...' : '，正在生成图片...'), 'success');

      // 2. 重新编号
      await storyboardApi.renumber(projectId, selectedEpisode.asset_id);

      // 3. 刷新列表
      await loadStoryboards();

      // 4. 如果需要 VLM，先分析再生成图片；否则直接生成
      if (vlmParams) {
        // 后台异步执行 VLM 分析
        (async () => {
          try {
            const vlmResponse = await generationApi.analyzeWithVLM(projectId, {
              image_ids: vlmParams.imageIds,
              user_goal: vlmParams.userGoal,
              descriptions: vlmParams.descriptions,
              shot_types: vlmParams.shot_types,
              camera_angles: vlmParams.camera_angles,
              actions: vlmParams.actions,
              dialogues: vlmParams.dialogues,
            });

            const analyzedPrompt = vlmResponse.data.prompt;

            // 更新分镜的描述
            await storyboardApi.update(projectId, newStoryboard.asset_id, {
              description: analyzedPrompt,
              image_prompt: analyzedPrompt
            });

            // 使用分析后的提示词生成图片
            const imageIds = [firstStoryboard.image_id, secondStoryboard.image_id].filter(id => id);
            if (imageIds.length === 2) {
              const imageResponse = await generationApi.editImage(projectId, {
                assetId: newStoryboard.asset_id,
                assetType: 'storyboard',
                prompt: analyzedPrompt,
                referenceImageIds: imageIds
              });

              if (imageResponse.data) {
                await loadStoryboards();
                toast('智能生成完成', 'success');
              }
            }
          } catch (error: any) {
            console.error('VLM analysis failed:', error);
            toast(`智能分析失败: ${error.response?.data?.detail || error.message}`, 'error');
          }
        })();
      } else {
        // 直接生成（不需要 VLM）
        try {
          const imageIds = [firstStoryboard.image_id, secondStoryboard.image_id].filter(id => id);

          if (imageIds.length === 2) {
            const imageResponse = await generationApi.editImage(projectId, {
              assetId: newStoryboard.asset_id,
              assetType: 'storyboard',
              prompt: finalPrompt,
              referenceImageIds: imageIds
            });

            if (imageResponse.data) {
              await loadStoryboards();
              toast('中间分镜图片生成完成', 'success');
            }
          }
        } catch (imageError: any) {
          console.error('Inbetween image generation failed:', imageError);
          toast(`中间分镜图片生成失败: ${imageError.response?.data?.detail || imageError.message}`, 'error');
        }
      }

      completeTask(taskId, 'inbetween');
    } catch (error: any) {
      console.error('Insert inbetween failed:', error);
      toast(`插入中间分镜失败: ${error.response?.data?.detail || error.message}`, 'error');
      failTask(taskId, 'inbetween', error.message);
      throw error;
    }
  }, [projectId, selectedEpisode, toast, startTask, completeTask, failTask, loadStoryboards]);

  /**
   * 执行首尾帧视频
   * 使用首尾两个分镜生成视频
   */
  const executeFirstLastVideo = useCallback(async (firstStoryboard: any, secondStoryboard: any, prompt: string) => {
    if (!selectedEpisode) return;

    const taskId = `first_last_video_${Date.now()}`;
    startTask(taskId, 'first_last_video');

    try {
      // 检查是否需要 VLM 分析
      let finalPrompt = prompt;
      let vlmParams = null;

      try {
        const parsed = JSON.parse(prompt);
        if (parsed.__needVLM) {
          vlmParams = parsed;
        }
      } catch {
        // 不是 JSON，使用原始 prompt
      }

      // 如果需要 VLM，先分析再生成视频；否则直接生成
      if (vlmParams) {
        toast('正在智能分析...', 'success');

        // 后台异步执行 VLM 分析 + 视频生成
        (async () => {
          try {
            const vlmResponse = await generationApi.analyzeWithVLM(projectId, {
              image_ids: vlmParams.imageIds,
              user_goal: vlmParams.userGoal,
              descriptions: vlmParams.descriptions,
              shot_types: vlmParams.shot_types,
              camera_angles: vlmParams.camera_angles,
              actions: vlmParams.actions,
              dialogues: vlmParams.dialogues,
            });

            const analyzedPrompt = vlmResponse.data.prompt;
            toast('智能分析完成，正在生成视频...', 'success');

            // 使用分析后的提示词生成视频
            const videoResponse = await generationApi.generateVideoMultiImage(projectId, {
              storyboard_id: firstStoryboard.asset_id,
              episode_id: selectedEpisode.asset_id,
              image_ids: [firstStoryboard.image_id, secondStoryboard.image_id],
              prompt: analyzedPrompt,
              duration: 6,
              resolution: '1920x1080',
              first_last_frames: true
            });

            if (videoResponse.data) {
              toast('首尾帧视频任务已创建，请在视频库中查看生成进度', 'success');
            }
          } catch (error: any) {
            console.error('VLM + video generation failed:', error);
            toast(`智能生成失败: ${error.response?.data?.detail || error.message}`, 'error');
          }
        })();
      } else {
        // 直接生成视频（不需要 VLM）
        toast('正在生成首尾帧视频...', 'success');

        const videoResponse = await generationApi.generateVideoMultiImage(projectId, {
          storyboard_id: firstStoryboard.asset_id,
          episode_id: selectedEpisode.asset_id,
          image_ids: [firstStoryboard.image_id, secondStoryboard.image_id],
          prompt: finalPrompt,
          duration: 6,
          resolution: '1920x1080',
          first_last_frames: true
        });

        if (videoResponse.data) {
          toast('首尾帧视频任务已创建，请在视频库中查看生成进度', 'success');
        }
      }

      completeTask(taskId, 'first_last_video');
    } catch (error: any) {
      console.error('First-last video failed:', error);
      toast(`生成首尾帧视频失败: ${error.response?.data?.detail || error.message}`, 'error');
      failTask(taskId, 'first_last_video', error.message);
      throw error;
    }
  }, [projectId, selectedEpisode, toast, startTask, completeTask, failTask, loadStoryboards]);

  /**
   * 执行创建尾帧
   * 从分镜视频的最后一帧创建新分镜
   */
  const executeCreateEndFrame = useCallback(async (storyboard: any) => {
    const taskId = `create_end_frame_${storyboard.asset_id}`;
    startTask(taskId, 'create_end_frame');

    try {
      const result = await storyboardApi.createEndFrame(projectId, storyboard.asset_id);
      await loadStoryboards();
      toast('尾帧分镜创建成功', 'success');
      completeTask(taskId, 'create_end_frame');
      return result.data;
    } catch (error: any) {
      toast(`创建尾帧失败: ${error.response?.data?.detail || error.message}`, 'error');
      failTask(taskId, 'create_end_frame', error.message);
      throw error;
    }
  }, [projectId, toast, startTask, completeTask, failTask, loadStoryboards]);

  /**
   * 执行多分镜视频生成
   * 将多个分镜合成为一个连续视频
   */
  const executeMultiSceneVideo = useCallback(async (selectedStoryboards: any[], prompt: string) => {
    if (!selectedEpisode || selectedStoryboards.length < 2) {
      toast('请至少选择2个分镜', 'error');
      return;
    }

    const firstStoryboard = selectedStoryboards[0];
    const taskId = `multi_scene_video_${Date.now()}`;
    startTask(taskId, 'multi_scene_video');

    try {
      // 检查是否需要 VLM 分析
      let finalPrompt = prompt;
      let vlmParams = null;

      try {
        const parsed = JSON.parse(prompt);
        if (parsed.__needVLM) {
          vlmParams = parsed;
        }
      } catch {
        // 不是 JSON，使用原始 prompt
      }

      // 如果需要 VLM，先分析再生成视频；否则直接生成
      if (vlmParams) {
        toast('正在智能分析...', 'success');

        // 后台异步执行 VLM 分析 + 视频生成
        (async () => {
          try {
            const vlmResponse = await generationApi.analyzeWithVLM(projectId, {
              image_ids: vlmParams.imageIds,
              user_goal: vlmParams.userGoal,
              descriptions: vlmParams.descriptions,
              shot_types: vlmParams.shot_types,
              camera_angles: vlmParams.camera_angles,
              actions: vlmParams.actions,
              dialogues: vlmParams.dialogues,
            });

            const analyzedPrompt = vlmResponse.data.prompt;
            toast('智能分析完成，正在生成视频...', 'success');

            // 收集所有分镜的图片ID
            const imageIds = selectedStoryboards.map(sb => sb.image_id).filter(Boolean);

            if (imageIds.length !== selectedStoryboards.length) {
              toast('部分分镜缺少主图，无法生成视频', 'error');
              failTask(taskId, 'multi_scene_video', '部分分镜缺少主图');
              return;
            }

            // 计算总时长
            const totalDuration = selectedStoryboards.reduce((sum, sb) => sum + (sb.duration || 3), 0);

            // 使用分析后的提示词生成视频
            const videoResponse = await generationApi.generateVideoMultiImage(projectId, {
              storyboard_id: firstStoryboard.asset_id,  // 保存到第一个分镜
              episode_id: selectedEpisode.asset_id,
              image_ids: imageIds,
              prompt: analyzedPrompt,
              duration: totalDuration,
              resolution: '1920x1080'
            });

            if (videoResponse.data) {
              toast('多分镜视频任务已创建，请在视频库中查看生成进度', 'success');
            }
          } catch (error: any) {
            console.error('VLM + multi-scene video generation failed:', error);
            toast(`智能生成失败: ${error.response?.data?.detail || error.message}`, 'error');
            failTask(taskId, 'multi_scene_video', error.message);
          }
        })();
      } else {
        // 直接生成视频（不需要 VLM）
        toast('正在生成多分镜视频...', 'success');

        // 收集所有分镜的图片ID
        const imageIds = selectedStoryboards.map(sb => sb.image_id).filter(Boolean);

        if (imageIds.length !== selectedStoryboards.length) {
          toast('部分分镜缺少主图，无法生成视频', 'error');
          failTask(taskId, 'multi_scene_video', '部分分镜缺少主图');
          return;
        }

        // 计算总时长
        const totalDuration = selectedStoryboards.reduce((sum, sb) => sum + (sb.duration || 3), 0);

        const videoResponse = await generationApi.generateVideoMultiImage(projectId, {
          storyboard_id: firstStoryboard.asset_id,  // 保存到第一个分镜
          episode_id: selectedEpisode.asset_id,
          image_ids: imageIds,
          prompt: finalPrompt,
          duration: totalDuration,
          resolution: '1920x1080'
        });

        if (videoResponse.data) {
          toast('多分镜视频任务已创建，请在视频库中查看生成进度', 'success');
        }
      }

      completeTask(taskId, 'multi_scene_video');
    } catch (error: any) {
      console.error('Multi-scene video failed:', error);
      toast(`生成多分镜视频失败: ${error.response?.data?.detail || error.message}`, 'error');
      failTask(taskId, 'multi_scene_video', error.message);
      throw error;
    }
  }, [projectId, selectedEpisode, toast, startTask, completeTask, failTask]);

  return {
    executeInsertStoryboard,
    executeMultiImageFusion,
    executeInsertInbetween,
    executeFirstLastVideo,
    executeCreateEndFrame,
    executeMultiSceneVideo,
  };
};
