import { create } from 'zustand';
import { Asset, Character, Scene, Prop, Episode, Storyboard } from '@/types';
import { assetApi } from '@/services/api';

interface AssetState {
  characters: Character[];
  scenes: Scene[];
  props: Prop[];
  episodes: Episode[];
  storyboards: Storyboard[];
  loading: boolean;
  error: string | null;
  fetchAssets: (projectId: string, assetType: string) => Promise<void>;
  createAsset: (projectId: string, assetType: string, data: any) => Promise<Asset>;
  updateAsset: (projectId: string, assetType: string, assetId: string, data: any) => Promise<void>;
  deleteAsset: (projectId: string, assetType: string, assetId: string) => Promise<void>;
}

export const useAssetStore = create<AssetState>()((set) => ({
  characters: [],
  scenes: [],
  props: [],
  episodes: [],
  storyboards: [],
  loading: false,
  error: null,

  fetchAssets: async (projectId, assetType) => {
    set({ loading: true, error: null });
    try {
      const response = await assetApi.list(projectId, assetType);
      const assets = response.data;

      switch (assetType) {
        case 'character':
          set({ characters: assets, loading: false });
          break;
        case 'scene':
          set({ scenes: assets, loading: false });
          break;
        case 'prop':
          set({ props: assets, loading: false });
          break;
        case 'episode':
          set({ episodes: assets, loading: false });
          break;
        case 'storyboard':
          set({ storyboards: assets, loading: false });
          break;
      }
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  createAsset: async (projectId, assetType, data) => {
    set({ loading: true, error: null });
    try {
      const response = await assetApi.create(projectId, {
        asset_type: assetType,
        ...data,
      });
      const newAsset = response.data;

      set((state) => {
        switch (assetType) {
          case 'character':
            return { characters: [...state.characters, newAsset], loading: false };
          case 'scene':
            return { scenes: [...state.scenes, newAsset], loading: false };
          case 'prop':
            return { props: [...state.props, newAsset], loading: false };
          case 'episode':
            return { episodes: [...state.episodes, newAsset], loading: false };
          default:
            return { loading: false };
        }
      });

      return newAsset;
    } catch (error: any) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  updateAsset: async (projectId, assetType, assetId, data) => {
    set({ loading: true, error: null });
    try {
      const response = await assetApi.update(projectId, assetType, assetId, data);
      const updatedAsset = response.data;

      set((state) => {
        switch (assetType) {
          case 'character':
            return {
              characters: state.characters.map((item) =>
                item.asset_id === assetId ? updatedAsset : item
              ),
              loading: false
            };
          case 'scene':
            return {
              scenes: state.scenes.map((item) =>
                item.asset_id === assetId ? updatedAsset : item
              ),
              loading: false
            };
          case 'prop':
            return {
              props: state.props.map((item) =>
                item.asset_id === assetId ? updatedAsset : item
              ),
              loading: false
            };
          case 'episode':
            return {
              episodes: state.episodes.map((item) =>
                item.episode_id === assetId ? updatedAsset : item
              ),
              loading: false
            };
          default:
            return { loading: false };
        }
      });
    } catch (error: any) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  deleteAsset: async (projectId, assetType, assetId) => {
    set({ loading: true, error: null });
    try {
      await assetApi.delete(projectId, assetType, assetId);

      set((state) => {
        switch (assetType) {
          case 'character':
            return {
              characters: state.characters.filter((item) => item.asset_id !== assetId),
              loading: false
            };
          case 'scene':
            return {
              scenes: state.scenes.filter((item) => item.asset_id !== assetId),
              loading: false
            };
          case 'prop':
            return {
              props: state.props.filter((item) => item.asset_id !== assetId),
              loading: false
            };
          case 'episode':
            return {
              episodes: state.episodes.filter((item) => item.episode_id !== assetId),
              loading: false
            };
          default:
            return { loading: false };
        }
      });
    } catch (error: any) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },
}));
