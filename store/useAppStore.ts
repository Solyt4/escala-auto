import { create } from 'zustand';
import { AppData, User, Military, ScaleEntry, ServiceType, Rank } from '../types';
import { INITIAL_PERSONNEL, INITIAL_SERVICES, INITIAL_SECTOR_RULES } from '../constants';
import { syncPersonnelStats, checkAndAutoUpdateStatus } from '../utils/helpers';

interface AppState {
  user: User | null;
  data: AppData;
  filterMonth: string;
  
  setUser: (user: User | null) => void;
  setAppData: (data: AppData) => void;
  setFilterMonth: (month: string) => void;
  
  updatePersonnel: (personnel: Military[]) => void;
  updateScale: (scale: ScaleEntry[]) => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  data: {
    personnel: INITIAL_PERSONNEL,
    services: INITIAL_SERVICES,
    scale: [],
    sectorRules: INITIAL_SECTOR_RULES,
    logs: [] 
  },
  filterMonth: new Date().toISOString().slice(0, 7),

  setUser: (user) => set({ user }),
  
  setAppData: (newData) => set((state) => {
    let safeServices = newData.services || INITIAL_SERVICES;

    const hasUnifiedService = safeServices.find(s => s.id === 'sv_24h');
    const hasSplitService = safeServices.some(s => s.id === 'sv_24h_ep' || s.id === 'sv_24h_ev');

    if (!hasUnifiedService || hasUnifiedService.quantity !== 9 || hasSplitService) {
        safeServices = safeServices.filter(s => !['sv_24h_ep', 'sv_24h_ev', 'sv_24h'].includes(s.id));
        
        safeServices.push({ 
            id: 'sv_24h', 
            name: 'Serviço 24h', 
            allowedRanks: [Rank.SD_EP, Rank.SD_EV], 
            quantity: 9, 
            is24h: true 
        });
    }

    const safeData: AppData = {
        ...newData,
        services: safeServices,
        sectorRules: newData.sectorRules || [],
        logs: newData.logs || []
    };

    const autoUpdatedPersonnel = checkAndAutoUpdateStatus(safeData.personnel);
    safeData.personnel = autoUpdatedPersonnel;

    return { data: safeData };
  }),

  setFilterMonth: (month) => set({ filterMonth: month }),

  updatePersonnel: (personnel) => set((state) => ({
    data: { ...state.data, personnel: checkAndAutoUpdateStatus(personnel) }
  })),

  updateScale: (scale) => set((state) => {
    const syncedPersonnel = syncPersonnelStats(state.data.personnel, scale);
    return {
        data: { ...state.data, scale, personnel: syncedPersonnel }
    };
  })
}));