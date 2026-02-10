
import { Rank, ServiceType, Military, SectorRule } from './types';

export const INITIAL_SERVICES: ServiceType[] = [
  // Serviço 24 horas - UNIFICADO
  // A lógica de cota (4 EP / 5 EV) é tratada internamente pelo Gerador
  { 
    id: 'sv_24h', 
    name: 'Serviço 24h', 
    allowedRanks: [Rank.SD_EP, Rank.SD_EV], 
    quantity: 9, // Soma de 4 EPs + 5 EVs (Dias Úteis)
    redScaleQuantity: 6, // Reduzido em FDS/Feriados
    is24h: true,
    isBlackScaleOnly: false 
  },
  // Auxiliares
  { 
    id: 'aux_cabo', 
    name: 'Auxiliar de Cabo', 
    allowedRanks: [Rank.CB], 
    quantity: 1, 
    is24h: true,
    isBlackScaleOnly: false 
  },
  { 
    id: 'aux_soldado', 
    name: 'Auxiliar de Soldado', 
    allowedRanks: [Rank.SD_EP], // Normalmente EPs antigos tiram esse serviço
    quantity: 1, 
    is24h: true,
    maxFormationYear: 2022, // Exemplo de regra de antiguidade
    isBlackScaleOnly: false
  },
  // Outros Serviços
  { 
    id: 'insp_rampa', 
    name: 'Inspetor de Rampa', 
    allowedRanks: [Rank.SD_EP], 
    quantity: 1, 
    is24h: false,
    startTime: '07:00',
    endTime: '19:00',
    maxFormationYear: 2022,
    isBlackScaleOnly: true // Rampa não tira FDS
  },
  { 
    id: 'apoio', 
    name: 'Apoio / Missões', 
    allowedRanks: [Rank.CB, Rank.SD_EP, Rank.SD_EV], 
    quantity: 2, // Configurável no gerador
    is24h: false,
    startTime: '08:00',
    endTime: '17:00',
    isBlackScaleOnly: true // Normalmente apoio é dia útil
  }
];

export const RANKS_LIST = [Rank.CB, Rank.SD_EP, Rank.SD_EV];

export const STORAGE_KEY = 'hfa_escala_data';

export const INITIAL_PERSONNEL: Military[] = [];

export const INITIAL_SECTOR_RULES: SectorRule[] = [];