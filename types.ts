
export type Role = 'ADMIN' | 'ESCALANTE' | 'DEV';

export enum Rank {
  CB = 'Cabo',
  SD_EP = 'Soldado EP',
  SD_EV = 'Soldado EV',
}

export type MilitaryStatus = 'ATIVO' | 'FERIAS' | 'DISPENSADO' | 'BAIXADO';

export interface User {
  username: string;
  role: Role;
  name: string;
}

export interface ServiceType {
  id: string;
  name: string;
  allowedRanks: Rank[]; // Strict list of ranks allowed
  quantity: number; // How many personnel per day (Standard/Black Scale)
  redScaleQuantity?: number; // Optional: How many personnel on Red Scale (Weekends/Holidays)
  is24h: boolean; // true = 24h service, false = specific time
  startTime?: string; // Optional for non-24h
  endTime?: string; // Optional for non-24h
  maxFormationYear?: number; // Optional limit: only personnel formed in this year or earlier
  isBlackScaleOnly?: boolean; // Novo campo: Se true, serviço só ocorre em dias de Escala Preta (Dias Úteis)
}

export interface VacationData {
  startDate: string; // YYYY-MM-DD
  days: number;
}

export interface MedicalLeaveData {
  startDate: string; // YYYY-MM-DD
  days: number;
}

export interface DispensationData {
  startDate: string; // YYYY-MM-DD
  days: number;
  reason?: string;
}

export interface MilitaryExemptions {
  skipBlackScale?: boolean; // Pula escala preta (dias úteis)
  skipRedScale?: boolean;   // Pula escala vermelha (fds/feriados)
  forceAllowedServices?: string[]; // Lista de IDs de serviços que o militar pode tirar IGNORANDO regras de antiguidade/ano
}

export interface Military {
  id: string;
  number: string;
  rank: Rank;
  warName: string;
  status: MilitaryStatus; // Status for availability
  sector?: string; 
  formationYear?: number; // New field
  vacationData?: VacationData; 
  medicalLeaveData?: MedicalLeaveData; // New field for sick leave
  dispensationData?: DispensationData; // New field for dispensation
  exemptions?: MilitaryExemptions; // New field for special rules
  eligibleServices: string[]; // IDs of ServiceType
  history: ServiceRecord[];
  unavailableDates: string[]; // ISO Date strings
  totalServices: number;
  lastServiceDate?: string; // ISO Date string
}

export interface ServiceRecord {
  date: string; // ISO Date string
  serviceTypeId: string;
}

export interface ScaleEntry {
  id: string;
  date: string;
  serviceTypeId: string;
  militaryId: string;
  militaryName: string;
  militaryRank: Rank;
  originalMilitaryId?: string; // Keeps track of the original owner for rotation stats
  changeType?: string; // 'PERMUTA', 'SUBSTITUICAO', 'INCLUSAO_MANUAL'
  customNote?: string; // Nome personalizado do serviço para aquele dia (ex: Apoio - Pintura)
}

export interface SectorRule {
  id: string;
  sectorName: string; // The sector name to match (case insensitive)
  allowedServiceIds: string[]; // Only these services are allowed for this sector
}

export interface AuditEntry {
  timestamp: string;
  action: string;
  user_id: string;
  details?: string;
  // Campos opcionais para compatibilidade
  deleted_item_id?: string;
  deleted_item_type?: 'MILITARY' | 'SERVICE' | 'SCALE_ENTRY' | 'SECTOR_RULE';
}

export interface AppData {
  personnel: Military[];
  services: ServiceType[];
  scale: ScaleEntry[];
  sectorRules: SectorRule[]; 
  logs: AuditEntry[]; // Novo campo para persistência de logs
}