import { create } from 'zustand';
import { AppData, User, Military, ScaleEntry, ServiceType, Rank, PendingSwap } from '../types';
import { INITIAL_PERSONNEL, INITIAL_SERVICES, INITIAL_SECTOR_RULES } from '../constants';
import { syncPersonnelStats, checkAndAutoUpdateStatus } from '../utils/helpers';


const resolvePendingSwaps = (data: AppData): AppData => {
  const pending = data.pendingSwaps || [];
  if (pending.length === 0) return data;

  const updatedScale = [...data.scale];
  const stillPending: PendingSwap[] = [];

  for (const request of pending) {
    const sourceIndex = updatedScale.findIndex(e => e.id === request.sourceEntryId);

    if (sourceIndex === -1) {
      continue;
    }

    const sourceEntry = updatedScale[sourceIndex];

    if (sourceEntry.militaryId !== request.sourceMilitaryId) {
      // A entrada de origem foi alterada manualmente; a pendência deixa de ser válida.
      continue;
    }

    const targetIndex = updatedScale
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.militaryId === request.targetMilitaryId && entry.date >= request.sourceDate)
      .sort((a, b) => a.entry.date.localeCompare(b.entry.date))[0]?.index;

    if (targetIndex === undefined) {
      stillPending.push(request);
      continue;
    }

    const targetEntry = updatedScale[targetIndex];
    const sourceOriginal = sourceEntry.originalMilitaryId || sourceEntry.militaryId;
    const targetOriginal = targetEntry.originalMilitaryId || targetEntry.militaryId;

    updatedScale[sourceIndex] = {
      ...sourceEntry,
      militaryId: targetEntry.militaryId,
      militaryName: targetEntry.militaryName,
      militaryRank: targetEntry.militaryRank,
      originalMilitaryId: sourceOriginal,
      changeType: 'PERMUTA'
    };

    updatedScale[targetIndex] = {
      ...targetEntry,
      militaryId: request.sourceMilitaryId,
      militaryName: request.sourceMilitaryName,
      militaryRank: request.sourceMilitaryRank,
      originalMilitaryId: targetOriginal,
      changeType: 'PERMUTA'
    };
  }

  return {
    ...data,
    scale: updatedScale,
    pendingSwaps: stillPending
  };
};


const normalizeAndResolveData = (newData: AppData): AppData => {
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
      logs: newData.logs || [],
      pendingSwaps: newData.pendingSwaps || []
  };

  safeData.personnel = checkAndAutoUpdateStatus(safeData.personnel);

  const resolvedData = resolvePendingSwaps(safeData);
  const syncedPersonnel = syncPersonnelStats(resolvedData.personnel, resolvedData.scale);

  return { ...resolvedData, personnel: syncedPersonnel };
};

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
    logs: [],
    pendingSwaps: [] 
  },
  filterMonth: new Date().toISOString().slice(0, 7),

  setUser: (user) => set({ user }),
  
  setAppData: (newData) => set(() => ({
    data: normalizeAndResolveData(newData)
  })),

  setFilterMonth: (month) => set({ filterMonth: month }),

  updatePersonnel: (personnel) => set((state) => ({
    data: { ...state.data, personnel: checkAndAutoUpdateStatus(personnel) }
  })),

  updateScale: (scale) => set((state) => ({
    data: normalizeAndResolveData({ ...state.data, scale })
  }))
}));