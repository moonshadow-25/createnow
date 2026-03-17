import { create } from 'zustand';
import { Project } from '@/types';
import { projectApi } from '@/services/api';

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  loading: boolean;
  error: string | null;
  fetchProjects: () => Promise<void>;
  fetchProject: (id: string) => Promise<Project | null>;
  setCurrentProject: (project: Project | null) => void;
  createProject: (name: string, description?: string) => Promise<Project>;
  updateProject: (id: string, data: any) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>()((set) => ({
  projects: [],
  currentProject: null,
  loading: false,
  error: null,

  fetchProjects: async () => {
    set({ loading: true, error: null });
    try {
      const response = await projectApi.list();
      set({ projects: response.data, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  setCurrentProject: (project) => {
    set({ currentProject: project });
  },

  fetchProject: async (id) => {
    try {
      const response = await projectApi.get(id);
      const project = response.data;
      set({ currentProject: project });
      return project;
    } catch {
      return null;
    }
  },

  createProject: async (name, description) => {
    set({ loading: true, error: null });
    try {
      const response = await projectApi.create({ name, description });
      const newProject = response.data;
      set((state) => ({
        projects: [...state.projects, newProject],
        loading: false,
      }));
      return newProject;
    } catch (error: any) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  updateProject: async (id, data) => {
    set({ loading: true, error: null });
    try {
      const response = await projectApi.update(id, data);
      const updatedProject = response.data;
      set((state) => ({
        projects: state.projects.map((p) =>
          p.project_id === id ? updatedProject : p
        ),
        currentProject:
          state.currentProject?.project_id === id
            ? updatedProject
            : state.currentProject,
        loading: false,
      }));
    } catch (error: any) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },

  deleteProject: async (id) => {
    set({ loading: true, error: null });
    try {
      await projectApi.delete(id);
      set((state) => ({
        projects: state.projects.filter((p) => p.project_id !== id),
        currentProject:
          state.currentProject?.project_id === id
            ? null
            : state.currentProject,
        loading: false,
      }));
    } catch (error: any) {
      set({ error: error.message, loading: false });
      throw error;
    }
  },
}));
