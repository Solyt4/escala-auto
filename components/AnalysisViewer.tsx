import React, { useState, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Rank, Military } from '../types';
import { isRedScale, syncPersonnelStats, parseISO, calculateEquityStats } from '../utils/helpers';
import { saveRemoteData, logAuditAction } from '../services/db';
import { 
  BarChart3, FileJson, Copy, RotateCcw, Loader2, Clock, Briefcase, 
  CalendarCheck, AlertTriangle, X, CheckCircle, Plane, Stethoscope, UserMinus, Filter, Search, Percent, TrendingUp, Calendar 
} from 'lucide-react';
import { differenceInDays, format } from 'date-fns';
import ptBR from 'date-fns/locale/pt-BR';

const AnalysisViewer: React.FC = () => {
  const { data, user, setAppData, filterMonth } = useAppStore();
  const [analysisFilter, setAnalysisFilter] = useState('TODOS');
  const [serviceFilter, setServiceFilter] = useState('TODOS');
  const [nameFilter, setNameFilter] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  
  // Estado local para a janela de análise (padrão: mês atual do filtro global ou hoje)
  const [analysisMonth, setAnalysisMonth] = useState(filterMonth || new Date().toISOString().slice(0, 7));

  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    isDestructive?: boolean;
    singleButton?: boolean;
    onConfirm: () => void;
  } | null>(null);

  const currentUser = user!;
  const isAdminOrDev = ['ADMIN', 'DEV'].includes(currentUser.role);

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    data.scale.forEach(s => {
      if (s.date) {
        months.add(s.date.substring(0, 7));
      }
    });
    return Array.from(months).sort().reverse();
  }, [data.scale]);

  const handleResetClick = () => {
    setModalConfig({
        isOpen: true,
        title: "Resetar Estatísticas",
        message: (
            <div className="space-y-3">
                <p><strong>ATENÇÃO:</strong> Esta ação zerará o <strong>HISTÓRICO acumulado</strong> de todos os militares.</p>
                <p>A contagem de serviços será reiniciada, mantendo apenas os serviços que constam na escala atual visualizada.</p>
                <p className="font-bold text-red-600">Deseja realmente continuar?</p>
            </div>
        ),
        isDestructive: true,
        onConfirm: executeResetStatistics
    });
  };

  const executeResetStatistics = async () => {
    setModalConfig(null);
    setIsResetting(true);
    try {
        const resetPersonnel = data.personnel.map(p => ({
            ...p,
            history: []
        }));

        const syncedPersonnel = syncPersonnelStats(resetPersonnel, data.scale);

        const newData = { ...data, personnel: syncedPersonnel };

        await saveRemoteData(newData);
        setAppData(newData);

        await logAuditAction({
            action: 'RESET_STATISTICS',
            user_id: currentUser.username,
            deleted_item_id: 'ALL_HISTORY',
            deleted_item_type: 'MILITARY',
            details: 'Reset global de estatísticas (histórico zerado)'
        });

        setModalConfig({
            isOpen: true,
            title: "Sucesso",
            message: "Estatísticas resetadas com sucesso!",
            singleButton: true,
            onConfirm: () => setModalConfig(null)
        });

    } catch (error) {
        console.error("Erro ao resetar estatísticas:", error);
        setModalConfig({
            isOpen: true,
            title: "Erro",
            message: "Ocorreu um erro ao processar o reset das estatísticas.",
            isDestructive: true,
            singleButton: true,
            onConfirm: () => setModalConfig(null)
        });
    } finally {
        setIsResetting(false);
    }
  };

  const referenceDate = useMemo(() => {
    if (data.scale.length > 0) {
        const dates = data.scale.map(s => s.date);
        dates.sort();
        const lastDateInScale = dates[dates.length - 1];
        return parseISO(lastDateInScale);
    }
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }, [data.scale]);

  const formattedRefDate = format(referenceDate, 'dd/MM/yyyy');
  const refDateStr = format(referenceDate, 'yyyy-MM-dd');

  // Process data for the list with separated stats (Period vs Lifetime)
  const processedList = useMemo(() => {
     return data.personnel
       .filter(p => {
           // 1. Filtros Básicos
           const matchesRank = analysisFilter === 'TODOS' || p.rank === analysisFilter;
           const matchesName = nameFilter === '' || 
                               p.warName.toLowerCase().includes(nameFilter.toLowerCase()) || 
                               p.number.includes(nameFilter);

           if (!matchesRank || !matchesName) return false;

           // 2. Filtro de Exclusão (Militares fora da escala)
           
           // A. Regras de Exceção Global (Isento de Preta E Vermelha)
           const isFullyExemptByRule = p.exemptions?.skipBlackScale && p.exemptions?.skipRedScale;

           // B. Regras de Setor (Setor com 0 serviços permitidos)
           let isSectorExempt = false;
           if (p.sector) {
               const rule = data.sectorRules?.find(r => r.sectorName.toLowerCase() === p.sector!.toLowerCase());
               // Se existe regra e a lista de serviços permitidos é vazia
               if (rule && rule.allowedServiceIds.length === 0) {
                   isSectorExempt = true;
               }
           }

           // Se estiver totalmente isento por qualquer motivo, remove da lista
           if (isFullyExemptByRule || isSectorExempt) return false;

           return true;
       })
       .map(p => {
         // Combine history and current scale
         const allEntries = [
            ...(p.history?.map(h => ({ date: h.date, serviceTypeId: h.serviceTypeId })) || []),
            ...data.scale.filter(s => s.militaryId === p.id).map(s => ({ date: s.date, serviceTypeId: s.serviceTypeId }))
         ];

         // Filter by Service Type first
         let entriesToCount = allEntries;
         if (serviceFilter !== 'TODOS') {
             entriesToCount = allEntries.filter(h => h.serviceTypeId === serviceFilter);
         } else {
             // By default, only count 24h services for the main stat unless specified
             entriesToCount = allEntries.filter(h => {
                 const svc = data.services.find(s => s.id === h.serviceTypeId);
                 return svc?.is24h === true;
             });
         }

         // Split into Lifetime and Current Period
         const lifetimeCount = entriesToCount.length;
         
         // Se analysisMonth estiver vazio, considera TODO o período (igual ao lifetimeCount para o filtro selecionado)
         const periodEntries = analysisMonth 
            ? entriesToCount.filter(e => e.date.startsWith(analysisMonth))
            : entriesToCount;
            
         const periodCount = periodEntries.length;

         // Aux stats for display
         const periodRed = periodEntries.filter(e => isRedScale(e.date)).length;
         const periodBlack = periodCount - periodRed;

         const missionCount = allEntries.filter(h => {
             const svc = data.services.find(s => s.id === h.serviceTypeId);
             return !svc || svc.is24h === false;
         }).length;

         let daysOffDisplay: string | number = '-';
         if (p.lastServiceDate) {
             if (p.lastServiceDate === refDateStr) {
                 daysOffDisplay = 'CICLO';
             } else {
                 daysOffDisplay = differenceInDays(referenceDate, parseISO(p.lastServiceDate));
             }
         }
         
         return { 
             p, 
             lifetimeCount,
             periodCount,
             periodRed, 
             periodBlack, 
             missionCount, 
             daysOffDisplay 
         };
       })
       .sort((a, b) => b.periodCount - a.periodCount || b.lifetimeCount - a.lifetimeCount);
  }, [data, analysisFilter, nameFilter, serviceFilter, referenceDate, refDateStr, analysisMonth]);

  // Advanced Equity Stats Calculation (Group Aware + Period Normalized)
  const equityStats = useMemo(() => {
      // Helper to calculate weighted average
      const calcWeighted = (statsA: any, statsB: any, countA: number, countB: number) => {
          if (countA === 0) return statsB;
          if (countB === 0) return statsA;
          return {
              mean: (statsA.mean * countA + statsB.mean * countB) / (countA + countB),
              stdDev: (statsA.stdDev + statsB.stdDev) / 2, // Approximate
              equityIndex: (statsA.equityIndex * countA + statsB.equityIndex * countB) / (countA + countB),
              range: Math.max(statsA.range, statsB.range)
          };
      };

      // Separate populations
      const cbList = processedList.filter(i => i.p.rank === Rank.CB).map(i => i.periodCount);
      const epList = processedList.filter(i => i.p.rank === Rank.SD_EP).map(i => i.periodCount);
      const evList = processedList.filter(i => i.p.rank === Rank.SD_EV).map(i => i.periodCount);

      // Calculate individual stats
      const cbStats = calculateEquityStats(cbList);
      const epStats = calculateEquityStats(epList);
      const evStats = calculateEquityStats(evList);

      // Determine Global Index based on Filter
      let globalStats;
      
      if (analysisFilter === Rank.CB) globalStats = cbStats;
      else if (analysisFilter === Rank.SD_EP) globalStats = epStats;
      else if (analysisFilter === Rank.SD_EV) globalStats = evStats;
      else {
          // If viewing ALL, we calculate a weighted index of EP + EV (Soldiers) + CB
          // Usually we care most about Soldiers equity
          const soldiersStats = calcWeighted(epStats, evStats, epList.length, evList.length);
          // If CBs are in the mix, weigh them too
          globalStats = calcWeighted(soldiersStats, cbStats, (epList.length + evList.length), cbList.length);
      }

      return {
          global: globalStats,
          details: { cb: cbStats, ep: epStats, ev: evStats }
      };
  }, [processedList, analysisFilter]);

  const jsonOutput = useMemo(() => {
    const exportData = processedList.map(i => ({
        militar: `${i.p.rank} ${i.p.warName}`,
        total_periodo: i.periodCount,
        total_acumulado: i.lifetimeCount,
        preta_periodo: i.periodBlack,
        vermelha_periodo: i.periodRed,
        ultimo: i.p.lastServiceDate || null
    }));

    return JSON.stringify({
        meta: {
            periodo: analysisMonth || 'GERAL (Todo o Período)',
            indice_equidade: equityStats.global.equityIndex.toFixed(1) + '%',
            media_periodo: equityStats.global.mean.toFixed(2),
        },
        data: exportData
    }, null, 2);
  }, [processedList, analysisMonth, equityStats]);

  return (
    <div className="space-y-6 animate-fade-in relative">
      
      {modalConfig && modalConfig.isOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col transform transition-all animate-scale-in">
                <div className={`${modalConfig.isDestructive ? 'bg-red-600' : 'bg-military-600'} p-4 flex justify-between items-center text-white`}>
                    <h3 className="font-bold text-lg flex items-center">
                        {modalConfig.isDestructive ? <AlertTriangle className="w-6 h-6 mr-2 fill-current" /> : <CheckCircle className="w-6 h-6 mr-2" />}
                        {modalConfig.title}
                    </h3>
                    <button onClick={() => setModalConfig(null)} className="text-white/80 hover:text-white"><X className="w-6 h-6"/></button>
                </div>
                <div className="p-6">
                    <div className="text-gray-700 text-sm">{modalConfig.message}</div>
                </div>
                <div className="bg-gray-50 p-4 border-t border-gray-100 flex justify-end gap-3">
                    {!modalConfig.singleButton && (
                        <button onClick={() => setModalConfig(null)} className="px-4 py-2 text-gray-600 font-bold hover:bg-gray-200 rounded-lg transition-colors">Cancelar</button>
                    )}
                    <button 
                        onClick={modalConfig.onConfirm} 
                        className={`px-6 py-2 text-white font-bold rounded-lg shadow-md transition-colors ${modalConfig.isDestructive ? 'bg-red-600 hover:bg-red-700' : 'bg-military-600 hover:bg-military-700'}`}
                    >
                        {modalConfig.singleButton ? 'OK' : 'Confirmar'}
                    </button>
                </div>
            </div>
        </div>
      )}

      <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 border-b border-gray-100 pb-4">
           <div className="flex items-center gap-3">
               <div className="p-2 bg-indigo-100 rounded-lg">
                  <BarChart3 className="w-6 h-6 text-indigo-700" />
               </div>
               <div>
                  <h2 className="text-2xl font-bold text-gray-900">Análise de Equidade</h2>
                  <p className="text-sm text-gray-500">Métricas de justiça baseadas no período selecionado.</p>
               </div>
           </div>

           <div className="flex items-center gap-3">
               {isAdminOrDev && (
                   <button 
                    onClick={handleResetClick}
                    disabled={isResetting}
                    className="px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs font-bold hover:bg-red-100 flex items-center gap-2 transition-colors"
                    title="Zera o histórico antigo, mantendo apenas a contagem da escala atual."
                   >
                     {isResetting ? <Loader2 className="w-4 h-4 animate-spin"/> : <RotateCcw className="w-4 h-4" />}
                     RESET
                   </button>
               )}
           </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
           <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <div className="text-xs text-gray-500 uppercase font-bold">Total Efetivo (Filtro)</div>
              <div className="text-2xl font-bold text-gray-800">{processedList.length}</div>
           </div>
           
           <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 relative overflow-hidden">
               <div className={`absolute top-0 right-0 p-1 rounded-bl-lg text-[10px] font-bold text-white ${equityStats.global.equityIndex >= 90 ? 'bg-green-500' : equityStats.global.equityIndex >= 75 ? 'bg-yellow-500' : 'bg-red-500'}`}>
                   HFA-IQ
               </div>
               <div className="text-xs text-gray-500 uppercase font-bold flex items-center gap-1"><Percent className="w-3 h-3"/> Índice de Equidade ({analysisMonth ? 'Mês' : 'Geral'})</div>
               <div className={`text-2xl font-bold flex items-center gap-2 ${equityStats.global.equityIndex >= 90 ? 'text-green-600' : equityStats.global.equityIndex >= 75 ? 'text-yellow-600' : 'text-red-600'}`}>
                   {equityStats.global.equityIndex.toFixed(1)}%
                   {equityStats.global.equityIndex >= 90 && <CheckCircle className="w-5 h-5" />}
                   {equityStats.global.equityIndex < 75 && <AlertTriangle className="w-5 h-5" />}
               </div>
               <div className="text-[10px] text-gray-400 mt-1">Justiça relativa ao {analysisMonth ? 'período' : 'todo o histórico'}.</div>
           </div>

           <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
               <div className="text-xs text-gray-500 uppercase font-bold flex items-center gap-1"><TrendingUp className="w-3 h-3"/> Amplitude (Gap)</div>
               <div className="text-2xl font-bold text-gray-800">{equityStats.global.range} <span className="text-sm font-normal text-gray-500">svs</span></div>
               <div className="text-[10px] text-gray-400 mt-1">Diferença Max - Min {analysisMonth ? 'no mês' : 'geral'}.</div>
           </div>
           
           <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <div className="text-xs text-gray-500 uppercase font-bold">Média do Período</div>
              <div className="text-2xl font-bold text-gray-800">{equityStats.global.mean.toFixed(1)}</div>
              <div className="text-[10px] text-gray-400 mt-1">Desvio Padrão: {equityStats.global.stdDev.toFixed(2)}</div>
           </div>
        </div>

        <div className="flex flex-col md:flex-row justify-between items-end mb-4 gap-4 bg-gray-50 p-3 rounded-lg border border-gray-200">
           <div className="flex flex-col gap-1 w-full md:w-auto">
                <span className="text-[10px] uppercase font-bold text-gray-400 flex items-center gap-1">
                    <CalendarCheck className="w-3 h-3" /> Data de Referência
                </span>
               <div className="text-sm font-bold text-gray-700">
                   {formattedRefDate} <span className="text-gray-400 font-normal">(Fim da Escala)</span>
               </div>
           </div>

           <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
               
               <div className="flex flex-col gap-1 w-full md:w-auto">
                   <label className="text-[10px] uppercase font-bold text-gray-500">Buscar</label>
                   <div className="relative">
                       <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                       <input 
                          type="text"
                          placeholder="Nome ou Nº"
                          value={nameFilter}
                          onChange={(e) => setNameFilter(e.target.value)}
                          className="pl-9 pr-4 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-gray-700 shadow-sm w-full md:w-40"
                       />
                       {nameFilter && (
                           <button onClick={() => setNameFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500">
                               <X className="w-3 h-3" />
                           </button>
                       )}
                   </div>
               </div>

               <div className="flex flex-col gap-1 w-full md:w-auto">
                   <label className="text-[10px] uppercase font-bold text-gray-500">Filtrar por Mês</label>
                   <div className="relative">
                       <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                       <select
                          value={analysisMonth}
                          onChange={(e) => setAnalysisMonth(e.target.value)}
                          className="pl-9 pr-8 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-gray-700 shadow-sm cursor-pointer w-full md:w-56"
                       >
                          <option value="">TODO O PERÍODO (GERAL)</option>
                          <hr />
                          {analysisMonth && !availableMonths.includes(analysisMonth) && (
                             <option value={analysisMonth}>{format(parseISO(analysisMonth + '-01'), 'MMM/yyyy', { locale: ptBR }).toUpperCase()}</option>
                          )}
                          {availableMonths.map(m => (
                              <option key={m} value={m}>
                                  {format(parseISO(m + '-01'), 'MMM/yyyy', { locale: ptBR }).toUpperCase()}
                              </option>
                          ))}
                       </select>
                   </div>
               </div>

               <div className="flex flex-col gap-1 w-full md:w-auto">
                   <label className="text-[10px] uppercase font-bold text-gray-500">Filtrar por Posto</label>
                   <div className="relative">
                       <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                       <select
                          value={analysisFilter}
                          onChange={(e) => setAnalysisFilter(e.target.value)}
                          className="pl-9 pr-8 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-gray-700 shadow-sm cursor-pointer w-full md:w-48"
                       >
                          <option value="TODOS">Todos os Postos</option>
                          <option value={Rank.CB}>Cabos</option>
                          <option value={Rank.SD_EP}>Soldados EP</option>
                          <option value={Rank.SD_EV}>Soldados EV</option>
                       </select>
                   </div>
               </div>

               <div className="flex flex-col gap-1 w-full md:w-auto">
                   <label className="text-[10px] uppercase font-bold text-gray-500">Filtrar por Serviço</label>
                   <div className="relative">
                       <Briefcase className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                       <select
                          value={serviceFilter}
                          onChange={(e) => setServiceFilter(e.target.value)}
                          className="pl-9 pr-8 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-gray-700 shadow-sm cursor-pointer w-full md:w-56"
                       >
                          <option value="TODOS">Todos os Serviços</option>
                          <hr />
                          {data.services.map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                       </select>
                   </div>
               </div>
           </div>
        </div>

        <div className="border rounded-lg overflow-hidden mb-8">
           <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-100">
                 <tr>
                    <th className="px-4 py-3 text-left font-bold text-gray-600">Militar</th>
                    <th className="px-4 py-3 text-center font-bold text-gray-600 bg-indigo-50 border-b-2 border-indigo-200">
                        {serviceFilter === 'TODOS' 
                            ? (analysisMonth ? 'No Mês' : 'Total Geral') 
                            : (analysisMonth ? 'No Mês (Filtro)' : 'Total (Filtro)')
                        }
                    </th>
                    <th className="px-4 py-3 text-center font-bold text-gray-600 text-xs uppercase tracking-wider">
                        Acumulado
                    </th>
                    <th className="px-4 py-3 text-center font-bold text-gray-600">Missões</th>
                    <th className="px-4 py-3 text-center font-bold text-gray-600">Dias de Folga</th>
                    <th className="px-4 py-3 text-right font-bold text-gray-600">Último Serviço</th>
                 </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white max-h-96 overflow-y-auto">
                 {processedList.map(({ p, periodCount, lifetimeCount, periodRed, periodBlack, missionCount, daysOffDisplay }) => {
                     
                     const getStatusBadge = () => {
                        if (p.status === 'ATIVO') return null;
                        
                        let icon = null;
                        let colorClass = '';
                        let label = p.status;

                        if (p.status === 'FERIAS') {
                            icon = <Plane className="w-3 h-3 mr-1" />;
                            colorClass = 'bg-cyan-50 text-cyan-700 border-cyan-200';
                            label = 'FÉRIAS';
                        } else if (p.status === 'BAIXADO') {
                            icon = <Stethoscope className="w-3 h-3 mr-1" />;
                            colorClass = 'bg-red-50 text-red-700 border-red-200';
                            label = 'BAIXADO';
                        } else if (p.status === 'DISPENSADO') {
                            icon = <UserMinus className="w-3 h-3 mr-1" />;
                            colorClass = 'bg-orange-50 text-orange-700 border-orange-200';
                            label = 'DISPENSADO';
                        }

                        return (
                            <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border shadow-sm ${colorClass}`}>
                                {icon} {label}
                            </span>
                        );
                     };

                     const isEndOfCycle = daysOffDisplay === 'CICLO';

                     return (
                     <tr key={p.id} className={`hover:bg-gray-50 transition-colors ${p.status !== 'ATIVO' ? 'bg-gray-50/50' : ''}`}>
                        <td className="px-4 py-2 whitespace-nowrap">
                           <span className="font-bold text-gray-700">{p.rank}</span> {p.warName}
                           {getStatusBadge()}
                        </td>
                        
                        <td className="px-4 py-2 text-center font-mono relative group cursor-help bg-indigo-50/30">
                           <span className={`border-b-2 border-dotted ${serviceFilter !== 'TODOS' ? 'border-indigo-300 text-indigo-700 font-bold' : 'border-gray-400 text-gray-900 font-bold'}`}>
                               {periodCount}
                           </span>
                           
                           {analysisMonth && (
                               <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-40 bg-gray-800 text-white text-xs rounded-lg shadow-xl p-3 z-50 animate-fade-in">
                                   <div className="font-bold text-gray-400 mb-1 border-b border-gray-700 pb-1 text-[10px] uppercase">
                                       Detalhamento ({format(parseISO(analysisMonth + '-01'), 'MMM/yy')})
                                   </div>
                                   <div className="flex justify-between items-center mb-1">
                                       <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-gray-400"></div> Preta:</span>
                                       <span className="font-mono font-bold">{periodBlack}</span>
                                   </div>
                                   <div className="flex justify-between items-center">
                                       <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500"></div> Vermelha:</span>
                                       <span className="font-mono font-bold text-red-300">{periodRed}</span>
                                   </div>
                                   <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800"></div>
                               </div>
                           )}
                        </td>

                        <td className="px-4 py-2 text-center text-gray-400 font-mono text-xs">
                            {lifetimeCount}
                        </td>

                        <td className="px-4 py-2 text-center text-gray-600 font-medium">
                            {missionCount > 0 ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs font-bold" title="Total de escalas que NÃO são 24h">
                                    <Briefcase className="w-3 h-3 text-gray-500" /> {missionCount}
                                </span>
                            ) : '-'}
                        </td>
                        <td className="px-4 py-2 text-center">
                            {isEndOfCycle ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100 uppercase tracking-tight">
                                    Fim de Ciclo
                                </span>
                            ) : (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                                    typeof daysOffDisplay === 'number' && daysOffDisplay < 2 ? 'bg-red-100 text-red-800' : 
                                    typeof daysOffDisplay === 'number' && daysOffDisplay > 10 ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                                }`}>
                                    <Clock className="w-3 h-3 mr-1 opacity-50"/> {daysOffDisplay}
                                </span>
                            )}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-500 text-xs font-medium">
                           {p.lastServiceDate ? p.lastServiceDate.split('-').reverse().join('/') : '-'}
                        </td>
                     </tr>
                   )})}
              </tbody>
           </table>
        </div>

        <div>
           <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
              <FileJson className="w-4 h-4"/> JSON Estatístico (Dados Brutos)
           </h3>
           <div className="relative group">
               <textarea
                  readOnly
                  className="w-full h-48 p-4 bg-gray-900 text-green-400 font-mono text-xs rounded-lg shadow-inner focus:outline-none focus:ring-2 focus:ring-green-500"
                  value={jsonOutput}
               />
               <button 
                  onClick={() => navigator.clipboard.writeText(jsonOutput)}
                  className="absolute top-2 right-2 bg-white/10 hover:bg-white/20 text-white p-2 rounded text-xs font-bold backdrop-blur-md transition-colors border border-white/20"
                  title="Copiar JSON"
               >
                  <Copy className="w-4 h-4" />
               </button>
           </div>
        </div>
      </div>
    </div>
  );
};

export default AnalysisViewer;