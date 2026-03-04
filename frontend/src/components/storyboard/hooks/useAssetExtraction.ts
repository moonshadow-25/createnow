import { useState } from 'react';
import { storyboardApi } from '../../../services/api';

interface ExtractResult {
  total_created: number;
  skipped_count: number;
  created: {
    characters: any[];
    scenes: any[];
    props: any[];
  };
}

interface MatchResult {
  updated_count: number;
  updated_storyboard_ids: string[];
}

export function useAssetExtraction(projectId: string) {
  const [isExtracting, setIsExtracting] = useState(false);
  const [isMatching, setIsMatching] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);

  const extractAssets = async (episodeId: string): Promise<ExtractResult | null> => {
    setIsExtracting(true);
    setExtractError(null);
    try {
      const res = await storyboardApi.extractAssets(projectId, episodeId);
      return res.data as ExtractResult;
    } catch (err: any) {
      const msg = err?.response?.data?.detail || '资产提取失败';
      setExtractError(msg);
      return null;
    } finally {
      setIsExtracting(false);
    }
  };

  const matchAssets = async (
    episodeId: string,
    overwriteExisting: boolean = false
  ): Promise<MatchResult | null> => {
    setIsMatching(true);
    setMatchError(null);
    try {
      const res = await storyboardApi.matchAssets(projectId, episodeId, overwriteExisting);
      return res.data as MatchResult;
    } catch (err: any) {
      const msg = err?.response?.data?.detail || '资产匹配失败';
      setMatchError(msg);
      return null;
    } finally {
      setIsMatching(false);
    }
  };

  return {
    isExtracting,
    isMatching,
    extractError,
    matchError,
    extractAssets,
    matchAssets,
  };
}
