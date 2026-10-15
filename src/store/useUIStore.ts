// ============================================================================
// UI Modal & Dialog State Store (useUIStore)
//
// Manages global interface state across different pages:
// - Create Map modal dialog open/closed state
// - Create Dashboard modal dialog open/closed state
// - Global topbar search input text
// ============================================================================

import { create } from 'zustand';

interface UIState {
  createMapModalOpen: boolean;
  setCreateMapModalOpen: (open: boolean) => void;
  createDashboardModalOpen: boolean;
  setCreateDashboardModalOpen: (open: boolean) => void;
  globalSearch: string;
  setGlobalSearch: (search: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  createMapModalOpen: false,
  setCreateMapModalOpen: (open) => set({ createMapModalOpen: open }),
  createDashboardModalOpen: false,
  setCreateDashboardModalOpen: (open) => set({ createDashboardModalOpen: open }),
  globalSearch: '',
  setGlobalSearch: (search) => set({ globalSearch: search }),
}));

