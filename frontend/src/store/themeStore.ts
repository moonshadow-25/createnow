import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark';
type AppearanceMode = 'classic' | 'vip';

interface ThemeState {
  theme: Theme;
  appearanceMode: AppearanceMode;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
  setAppearanceMode: (mode: AppearanceMode) => void;
  toggleAppearanceMode: () => void;
}

function getEffectiveTheme(theme: Theme, appearanceMode: AppearanceMode): Theme {
  return appearanceMode === 'vip' ? 'dark' : theme;
}

function applyDomTheme(theme: Theme, appearanceMode: AppearanceMode) {
  document.documentElement.setAttribute('data-theme', getEffectiveTheme(theme, appearanceMode));
  document.documentElement.setAttribute('data-app-mode', appearanceMode);
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      appearanceMode: 'classic',
      setTheme: (theme) => {
        set({ theme });
        applyDomTheme(theme, get().appearanceMode);
      },
      toggle: () => {
        const next = get().theme === 'light' ? 'dark' : 'light';
        set({ theme: next });
        applyDomTheme(next, get().appearanceMode);
      },
      setAppearanceMode: (appearanceMode) => {
        const currentTheme = get().theme;
        const nextTheme = appearanceMode === 'vip' ? 'dark' : currentTheme;
        set({ appearanceMode, theme: nextTheme });
        applyDomTheme(nextTheme, appearanceMode);
      },
      toggleAppearanceMode: () => {
        const next = get().appearanceMode === 'classic' ? 'vip' : 'classic';
        const currentTheme = get().theme;
        const nextTheme = next === 'vip' ? 'dark' : currentTheme;
        set({ appearanceMode: next, theme: nextTheme });
        applyDomTheme(nextTheme, next);
      },
    }),
    { name: 'app-theme' }
  )
);

/** 在应用启动时同步主题到 DOM（防止闪烁） */
export function applyStoredTheme() {
  try {
    const stored = JSON.parse(localStorage.getItem('app-theme') || '{}');
    const theme: Theme = stored?.state?.theme ?? 'light';
    const appearanceMode: AppearanceMode = stored?.state?.appearanceMode ?? 'classic';
    applyDomTheme(theme, appearanceMode);
  } catch {
    applyDomTheme('light', 'classic');
  }
}
