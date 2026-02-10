import { Military, ScaleEntry } from '../types';
import { addDays, isAfter, format } from 'date-fns';

export const parseISO = (dateStr: string) => {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export const isRedScale = (dateStr: string) => {
    const date = parseISO(dateStr);
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const dayMonth = `${day}/${month}`;
    
    const fixedHolidays = [
      '01/01',
      '21/04',
      '01/05',
      '07/09',
      '12/10',
      '02/11',
      '15/11',
      '25/12',
    ];

    return isWeekend || fixedHolidays.includes(dayMonth);
};

export const syncPersonnelStats = (personnel: Military[], scale: ScaleEntry[]): Military[] => {
  const scaleMap = new Map<string, ScaleEntry[]>();
  
  for (const entry of scale) {
    const list = scaleMap.get(entry.militaryId) || [];
    list.push(entry);
    scaleMap.set(entry.militaryId, list);
  }

  return personnel.map(mil => {
      const activeEntries = scaleMap.get(mil.id) || [];
      const total = (mil.history?.length || 0) + activeEntries.length;
      
      const allDates = [
          ...(mil.history?.map(h => h.date) || []),
          ...activeEntries.map(s => s.date)
      ].sort((a, b) => a.localeCompare(b)); 
      
      const lastDate = allDates.length > 0 ? allDates[allDates.length - 1] : undefined;

      return {
          ...mil,
          totalServices: total,
          lastServiceDate: lastDate
      };
  });
};

export const commitScaleToHistory = (personnel: Military[], scaleToCommit: ScaleEntry[]): Military[] => {
  return personnel.map(mil => {
      const myEntries = scaleToCommit.filter(s => s.militaryId === mil.id);
      
      if (myEntries.length === 0) return mil;

      const newHistoryRecords = myEntries.map(entry => ({
          date: entry.date,
          serviceTypeId: entry.serviceTypeId
      }));

      const updatedHistory = [...(mil.history || []), ...newHistoryRecords];
      updatedHistory.sort((a, b) => a.date.localeCompare(b.date));

      return {
          ...mil,
          history: updatedHistory
      };
  });
};

export const checkAndAutoUpdateStatus = (personnel: Military[]): Military[] => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return personnel.map(mil => {
    let shouldUpdate = false;
    let newStatus = mil.status;
    let newUnavailableDates = [...(mil.unavailableDates || [])];

    if (mil.status === 'FERIAS' && mil.vacationData) {
      const start = parseISO(mil.vacationData.startDate);
      const end = addDays(start, mil.vacationData.days);
      
      if (isAfter(today, end) || today.getTime() === end.getTime()) {
         newStatus = 'ATIVO';
         shouldUpdate = true;
      }
    }

    if (mil.status === 'BAIXADO' && mil.medicalLeaveData) {
      const start = parseISO(mil.medicalLeaveData.startDate);
      const end = addDays(start, mil.medicalLeaveData.days);
      
      if (isAfter(today, end) || today.getTime() === end.getTime()) {
        newStatus = 'ATIVO';
        shouldUpdate = true;
      }
    }

    if (mil.status === 'DISPENSADO' && mil.dispensationData) {
        const start = parseISO(mil.dispensationData.startDate);
        const end = addDays(start, mil.dispensationData.days);
        
        if (isAfter(today, end) || today.getTime() === end.getTime()) {
          newStatus = 'ATIVO';
          shouldUpdate = true;
        }
    }

    if (shouldUpdate) {
      return {
        ...mil,
        status: newStatus,
        unavailableDates: newUnavailableDates.filter(d => !isAfter(today, parseISO(d)))
      };
    }

    return mil;
  });
};

/**
 * HFA Equity Index 2.0 (Normalizado)
 * Calcula a justiça da distribuição baseada no Coeficiente de Variação (CV).
 * CV = Desvio Padrão / Média.
 * 
 * Isso torna o índice independente da magnitude dos números (funciona igual para média 5 ou média 50).
 */
export const calculateEquityStats = (values: number[]) => {
  if (values.length === 0) return { mean: 0, stdDev: 0, min: 0, max: 0, range: 0, equityIndex: 100 };

  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  // Proteção contra divisão por zero e hipersensibilidade em médias muito baixas (< 1)
  const adjustedMean = Math.max(mean, 1);

  // Coeficiente de Variação (CV)
  // CV de 0.1 (10%) é excelente. CV de 0.3 (30%) é ruim.
  const cv = stdDev / adjustedMean;

  // Mapeamento do CV para Índice 0-100%
  // Se CV = 0, Index = 100.
  // Se CV = 0.2 (20% desvio), Index = 80.
  // Se CV >= 1.0 (100% desvio), Index = 0.
  let equityIndex = 100 * (1 - cv);
  
  // Penalidade suave por Amplitude Extrema (Range) apenas se for desproporcional
  // Isso ajuda a desempatar escalas com mesmo CV mas outliers piores
  if (range > (mean * 1.5)) { // Se a diferença max-min for maior que 1.5x a média
      equityIndex -= 5;
  }

  equityIndex = Math.max(0, Math.min(100, equityIndex));

  return {
    mean,
    stdDev,
    min,
    max,
    range,
    equityIndex
  };
};