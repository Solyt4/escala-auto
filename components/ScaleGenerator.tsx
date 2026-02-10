import React, { useState } from 'react';
import { AppData, ScaleEntry, Military, ServiceType, Rank } from '../types';
import { addDays, format, isBefore, differenceInDays } from 'date-fns';
import { Users, Calendar, AlertCircle, CheckCircle, Play, FileText, Settings, ShieldCheck, RefreshCw, Layers, AlertTriangle, X, BrainCircuit } from 'lucide-react';
import { isRedScale } from '../utils/helpers';
import { useAppStore } from '../store/useAppStore';

const parseISO = (dateStr: string) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
};

interface Props {
  data: AppData;
  onUpdateData: (newData: AppData) => void;
}

// Configuração dos Pesos do Algoritmo
const WEIGHTS = {
    DAYS_OFF: 0.2,         // Critério de desempate fino
    TOTAL_BURDEN: 100.0,   // Peso base da carga
    SATURATION_EXP: 1.6,   // EXPOENTE DE SATURAÇÃO: Penaliza quem está acima da média de forma não-linear
    RED_BALANCE: 500.0,    // Prioridade máxima absoluta para FDS
    HIERARCHY_BIAS: 20.0   // Ajuste fino EP vs EV
};

const ScaleGenerator: React.FC<Props> = ({ data, onUpdateData }) => {
  const { setFilterMonth } = useAppStore();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [targetServiceId, setTargetServiceId] = useState<string>('TODOS');
  const [generating, setGenerating] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [equalizeScale, setEqualizeScale] = useState(false);

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    onConfirm: () => void;
  } | null>(null);

  const [warningModal, setWarningModal] = useState<{
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    onConfirm?: () => void;
  } | null>(null);

  const handleGenerateClick = () => {
    if (!startDate || !endDate) return;
    
    const start = parseISO(startDate);
    const end = parseISO(endDate);
    
    if (isBefore(end, start)) {
        setLogs(["❌ Erro: Data de fim deve ser após a data de início."]);
        return;
    }

    const conflictingEntries = data.scale.filter(entry => {
        const entryDate = entry.date.substring(0, 10); 
        const inRange = entryDate >= startDate && entryDate <= endDate;
        if (!inRange) return false;
        if (targetServiceId === 'TODOS') return true;
        return entry.serviceTypeId === targetServiceId;
    });

    if (conflictingEntries.length > 0) {
        const count = conflictingEntries.length;
        const serviceName = targetServiceId === 'TODOS' 
            ? "TODOS OS SERVIÇOS" 
            : data.services.find(s => s.id === targetServiceId)?.name || "SERVIÇO SELECIONADO";

        setConfirmModal({
            isOpen: true,
            title: "⚠️ Conflito de Escala Detectado",
            message: (
                <div className="space-y-4 text-sm text-gray-600">
                    <p>
                        O sistema detectou <strong className="text-red-600">{count} registros</strong> de escala já gerados para o período de 
                        <br/>
                        <span className="font-mono bg-gray-100 px-1 rounded">{format(start, 'dd/MM')} a {format(end, 'dd/MM')}</span> referente a: <strong>{serviceName}</strong>.
                    </p>
                    <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-200 text-yellow-800 flex items-start gap-2">
                        <AlertTriangle className="w-5 h-5 shrink-0" />
                        <p>Se você continuar, essas escalas antigas serão <strong>SOBRESCRITAS</strong> e <strong>REGERADAS</strong>. Alterações manuais feitas nessas datas serão perdidas.</p>
                    </div>
                    <p className="font-bold text-gray-800">Deseja prosseguir mesmo assim?</p>
                </div>
            ),
            onConfirm: () => executeGeneration(start, end)
        });
        return;
    }

    executeGeneration(start, end);
  };

  const calculateDynamicScore = (
      candidate: Military, 
      currentDate: Date, 
      isRedDate: boolean, 
      targetAvgTotal: number, 
      targetAvgRed: number, 
      currentTotalServices: number,
      currentRedServices: number,
      isEqualizeMode: boolean
  ) => {
      // 1. Fator Folga (Critério de Desempate)
      let daysOff = 0;
      if (candidate.lastServiceDate) {
          daysOff = differenceInDays(currentDate, parseISO(candidate.lastServiceDate));
      } else {
          daysOff = 500; // Prioridade máxima para quem nunca serviu
      }
      
      const scoreDaysOff = daysOff * WEIGHTS.DAYS_OFF;

      // 2. Fator Carga Total COM SATURAÇÃO
      // Calculamos a distância do militar para a média.
      const rawDiff = targetAvgTotal - currentTotalServices;
      
      let scoreBurden = 0;

      if (rawDiff >= 0) {
          // Militar está ABAIXO da média (underworked).
          // Ganha prioridade linear para alcançar os outros.
          scoreBurden = rawDiff * WEIGHTS.TOTAL_BURDEN;
      } else {
          // Militar está ACIMA da média (overworked).
          // APLICAÇÃO DO FATOR DE SATURAÇÃO (ANTI-PLATÔ)
          // A penalidade cresce exponencialmente para evitar que ele seja escalado novamente.
          // Ex: Excesso de 1 sv => Penalidade Base * 1^1.6
          // Ex: Excesso de 2 sv => Penalidade Base * 2^1.6 (~3x mais forte)
          // Ex: Excesso de 3 sv => Penalidade Base * 3^1.6 (~5.8x mais forte)
          const excess = Math.abs(rawDiff);
          const saturationFactor = Math.pow(excess, WEIGHTS.SATURATION_EXP);
          scoreBurden = -1 * saturationFactor * WEIGHTS.TOTAL_BURDEN;
      }

      // Se NÃO estivermos equalizando (Modo Hierárquico Padrão), aplicamos um viés
      // para que o EP tenha "menos vontade" de servir que o EV.
      if (!isEqualizeMode && candidate.rank === Rank.SD_EP) {
          scoreBurden -= WEIGHTS.HIERARCHY_BIAS;
      }

      // 3. Fator Escala Vermelha (Justiça FDS)
      let scoreRed = 0;
      if (isRedDate) {
          const diffRed = targetAvgRed - currentRedServices;
          scoreRed = diffRed * WEIGHTS.RED_BALANCE;
      }

      const finalScore = scoreDaysOff + scoreBurden + scoreRed;
      
      return { finalScore, daysOff, diffTotal: rawDiff, scoreDaysOff, scoreBurden, scoreRed };
  };

  const executeGeneration = (start: Date, end: Date) => {
    setConfirmModal(null);
    setGenerating(true);
    setLogs([]);
    
    const tempPersonnel = JSON.parse(JSON.stringify(data.personnel)) as Military[];
    const tempLog: string[] = [];
    const sectorRules = data.sectorRules || [];
    let deficitCount = 0;

    let servicesToProcess: ServiceType[] = [];
    
    if (targetServiceId === 'TODOS') {
        servicesToProcess = [...data.services]
            .sort((a, b) => {
                if (a.id.includes('aux')) return -1;
                if (b.id.includes('aux')) return 1;
                if (a.id === 'apoio') return -1;
                if (b.id === 'apoio') return 1;
                return 0;
            });
    } else {
        const svc = data.services.find(s => s.id === targetServiceId);
        if (svc) servicesToProcess = [svc];
    }

    const serviceNames = servicesToProcess.map(s => s.name).join(', ');
    tempLog.push(`INICIANDO GERAÇÃO (${serviceNames}): ${format(start, 'dd/MM/yyyy')} a ${format(end, 'dd/MM/yyyy')}`);
    
    if (equalizeScale) {
        tempLog.push(`⚙️ MODO EQUALIZAÇÃO GLOBAL: EP e EV concorrem igualmente.`);
    } else {
        tempLog.push(`⚙️ MODO HIERÁRQUICO PADRÃO: EP e EV separados.`);
    }
    tempLog.push(`   - Saturação Exponencial: Ativada (Fator ${WEIGHTS.SATURATION_EXP}x). Evita platôs de serviço.`);

    const realtimeStats = new Map<string, { total: number, red: number }>();
    
    const preservedScale = data.scale.filter(entry => {
        const entryDate = entry.date.substring(0, 10);
        const isInsideRange = entryDate >= startDate && entryDate <= endDate;
        if (!isInsideRange) return true;
        const isBeingRegenerated = servicesToProcess.some(s => s.id === entry.serviceTypeId);
        return !isBeingRegenerated;
    });

    tempPersonnel.forEach(p => {
        const historyEntries = p.history || [];
        const preservedEntries = preservedScale.filter(s => s.militaryId === p.id);

        // Base de cálculo sempre derivada de histórico + escala preservada.
        // Evita dupla contagem quando totalServices já inclui entradas da escala ativa.
        const total = historyEntries.length + preservedEntries.length;
        const red =
            historyEntries.filter(h => isRedScale(h.date)).length +
            preservedEntries.filter(s => isRedScale(s.date)).length;

        realtimeStats.set(p.id, { total, red });
    });

    const newScaleEntries: ScaleEntry[] = [];
    let current = start;

    while (isBefore(current, addDays(end, 1))) {
      const dateStr = format(current, 'yyyy-MM-dd');
      const isRed = isRedScale(dateStr);
      
      const activeEPs = tempPersonnel.filter(p => p.rank === Rank.SD_EP && p.status === 'ATIVO');
      const activeEVs = tempPersonnel.filter(p => p.rank === Rank.SD_EV && p.status === 'ATIVO');
      const activeCBs = tempPersonnel.filter(p => p.rank === Rank.CB && p.status === 'ATIVO');
      const allSoldiers = [...activeEPs, ...activeEVs]; 

      const getAvg = (group: Military[]) => {
          if (group.length === 0) return { total: 0, red: 0 };
          const sumTotal = group.reduce((acc, m) => acc + (realtimeStats.get(m.id)?.total || 0), 0);
          const sumRed = group.reduce((acc, m) => acc + (realtimeStats.get(m.id)?.red || 0), 0);
          return { total: sumTotal / group.length, red: sumRed / group.length };
      };

      for (const service of servicesToProcess) {
        if (service.isBlackScaleOnly && isRed) continue;

        let effectiveQuantity = service.quantity;
        
        // --- REGRA DE QUANTIDADE DINÂMICA (FDS/FERIADO) ---
        // Em vez de hardcoded, verificamos se o serviço possui configuração de redScaleQuantity
        if (isRed && service.redScaleQuantity !== undefined) {
            effectiveQuantity = service.redScaleQuantity;
        }

        for (let i = 0; i < effectiveQuantity; i++) {
            
            const avgEP = getAvg(activeEPs);
            const avgEV = getAvg(activeEVs);
            const avgCB = getAvg(activeCBs);
            const avgGlobalSoldiers = getAvg(allSoldiers);

            const busyIdsInPreserved = preservedScale.filter(s => s.date.substring(0, 10) === dateStr).map(s => s.militaryId);
            const busyIdsInNew = newScaleEntries.filter(s => s.date === dateStr).map(s => s.militaryId);
            const allBusyIdsToday = new Set([...busyIdsInPreserved, ...busyIdsInNew]);

            let candidates = tempPersonnel.filter(m => {
                if (m.status !== 'ATIVO') return false;
                if (m.unavailableDates.includes(dateStr)) return false;
                if (allBusyIdsToday.has(m.id)) return false;

                if (isRed && m.exemptions?.skipRedScale) return false;
                if (!isRed && m.exemptions?.skipBlackScale) return false;

                const forcedServices = m.exemptions?.forceAllowedServices || [];
                const hasForcedServices = forcedServices.length > 0;

                // Regra explícita: lista de serviços forçados ignora APENAS antiguidade/ano.
                // As demais regras (posto, setor, interstício e indisponibilidade) continuam valendo.
                if (hasForcedServices && !forcedServices.includes(service.id)) {
                    return false;
                }
                
                // --- LÓGICA DE EXCLUSIVIDADE POR ANTIGUIDADE (ANO DE FORMAÇÃO) ---
                const soldierYear = m.formationYear || new Date().getFullYear();
                
                // 1. Identifica se o militar é "Exclusivo" de ALGUM serviço existente no sistema.
                // Ele é exclusivo se existe um serviço com limite de ano onde ele se enquadra E QUE SEJA DA PATENTE DELE.
                const exclusiveService = data.services.find(s => 
                    s.maxFormationYear !== undefined && 
                    soldierYear <= s.maxFormationYear &&
                    s.allowedRanks.includes(m.rank)
                );

                const isExclusiveSoldier = !!exclusiveService;

                if (!hasForcedServices && isExclusiveSoldier) {
                    // O militar é "Antigo/Especial". Ele TEM um serviço preferencial/exclusivo.

                    // Regra A: Se o serviço atual NÃO TEM limite de ano (é um serviço geral),
                    // este militar NÃO deve concorrer, pois ele deve ficar guardado para seu serviço exclusivo.
                    if (service.maxFormationYear === undefined) {
                        return false;
                    }

                    // Regra B: Se o serviço atual TEM limite, verificamos se o militar cabe nele.
                    if (soldierYear > service.maxFormationYear) {
                        return false; 
                    }
                } else if (!hasForcedServices) {
                    // O militar é "Moderno" (Não se enquadra em nenhum serviço com limite de ano).

                    // Regra C: Ele não pode entrar em serviços que exigem antiguidade (que têm limite).
                    if (service.maxFormationYear !== undefined) {
                        return false;
                    }
                }
                // -------------------------------------------------------------------

                if (!service.allowedRanks.includes(m.rank)) return false;
                
                if (m.sector) {
                    const rule = sectorRules.find(r => r.sectorName.toLowerCase() === m.sector!.toLowerCase());
                    if (rule && !rule.allowedServiceIds.includes(service.id)) return false;
                }

                // --- LÓGICA DE INTERSTÍCIO (DESCANSO) ---
                // Regra: Quem tirou 24h ontem, descansa hoje (independente se hoje é 24h ou Apoio).
                // Regra: Quem tirou Apoio (Expediente) ontem, PODE tirar 24h hoje.

                const yesterdayStr = format(addDays(current, -1), 'yyyy-MM-dd');
                
                // Busca registros de ontem (Escala preservada, Escala nova gerando agora, ou Histórico antigo)
                const entriesYesterday = [
                    ...preservedScale.filter(s => s.date.substring(0, 10) === yesterdayStr && s.militaryId === m.id),
                    ...newScaleEntries.filter(s => s.date === yesterdayStr && s.militaryId === m.id),
                    ...(m.history?.filter(h => h.date === yesterdayStr).map(h => ({ ...h, serviceTypeId: h.serviceTypeId })) || [])
                ];

                if (entriesYesterday.length > 0) {
                    // Verifica se algum serviço de ontem foi 24h
                    const worked24hYesterday = entriesYesterday.some(entry => {
                        const svcDef = data.services.find(s => s.id === entry.serviceTypeId);
                        return svcDef?.is24h === true;
                    });

                    // Se trabalhou 24h ontem, está bloqueado hoje (seja pra 24h ou Apoio)
                    if (worked24hYesterday) return false;
                    
                    // Se trabalhou apenas Apoio ontem, o loop continua e permite escalar hoje (cairá nos critérios de pontuação)
                }

                return true;
            });

            // --- CIRCUIT BREAKER ---
            const CAP_THRESHOLD = 3; 
            const candidatesWithinCap = candidates.filter(m => {
                const stats = realtimeStats.get(m.id) || { total: 0, red: 0 };
                let refAvg = avgCB.total;
                
                if (m.rank === Rank.SD_EP || m.rank === Rank.SD_EV) {
                     refAvg = equalizeScale ? avgGlobalSoldiers.total : (m.rank === Rank.SD_EP ? avgEP.total : avgEV.total);
                }
                
                return stats.total <= (refAvg + CAP_THRESHOLD);
            });

            if (candidatesWithinCap.length > 0) {
                candidates = candidatesWithinCap;
            }

            if (candidates.length === 0) {
              deficitCount++;
              tempLog.push(`⚠️ DÉFICIT (${format(current, 'dd/MM')}): ${service.name} - Vaga ${i+1}/${effectiveQuantity} NÃO PREENCHIDA.`);
              continue;
            }

            // --- CÁLCULO DE SCORE COM SATURAÇÃO ---
            const scoredCandidates = candidates.map(candidate => {
                const stats = realtimeStats.get(candidate.id) || { total: 0, red: 0 };
                
                let targetAvgTotal = avgCB.total;
                let targetAvgRed = avgCB.red;

                if (candidate.rank === Rank.SD_EP || candidate.rank === Rank.SD_EV) {
                    if (equalizeScale) {
                        targetAvgTotal = avgGlobalSoldiers.total;
                        targetAvgRed = avgGlobalSoldiers.red;
                    } else {
                        targetAvgTotal = candidate.rank === Rank.SD_EP ? avgEP.total : avgEV.total;
                        targetAvgRed = candidate.rank === Rank.SD_EP ? avgEP.red : avgEV.red;
                    }
                }

                const scoreBreakdown = calculateDynamicScore(
                    candidate, 
                    current, 
                    isRed, 
                    targetAvgTotal, 
                    targetAvgRed, 
                    stats.total, 
                    stats.red,
                    equalizeScale
                );

                return {
                    candidate,
                    score: scoreBreakdown.finalScore,
                    breakdown: scoreBreakdown
                };
            });

            scoredCandidates.sort((a, b) => b.score - a.score);

            const selected = scoredCandidates[0].candidate;

            const top3 = scoredCandidates.slice(0, 3);
            tempLog.push(`ℹ️ AUDITORIA (${format(current, 'dd/MM')} | ${service.name} ${i + 1}/${effectiveQuantity}):`);
            top3.forEach((entry, rankIndex) => {
                tempLog.push(
                    `   #${rankIndex + 1} ${entry.candidate.rank} ${entry.candidate.warName} | ` +
                    `Score=${entry.score.toFixed(1)} [Folga=${entry.breakdown.scoreDaysOff.toFixed(1)} ` +
                    `(${entry.breakdown.daysOff}d), Carga=${entry.breakdown.scoreBurden.toFixed(1)} ` +
                    `(Δ${entry.breakdown.diffTotal.toFixed(2)}), Vermelha=${entry.breakdown.scoreRed.toFixed(1)}]`
                );
            });
            tempLog.push(`   ✅ Selecionado: ${selected.rank} ${selected.warName}`);

            newScaleEntries.push({
                id: `ent_${Math.random().toString(36).substr(2, 9)}_${Date.now()}`,
                date: dateStr,
                serviceTypeId: service.id,
                militaryId: selected.id,
                militaryName: selected.warName,
                militaryRank: selected.rank
            });
            
            const currentStats = realtimeStats.get(selected.id)!;
            realtimeStats.set(selected.id, {
                total: currentStats.total + 1,
                red: isRed ? currentStats.red + 1 : currentStats.red
            });

            selected.lastServiceDate = dateStr;
            selected.totalServices += 1;
        }
      }
      current = addDays(current, 1);
    }

    const cleanLogs = tempLog.map(l => l.replace(/<!-- .* -->/, ''));
    
    if (deficitCount > 0) {
        cleanLogs.push(`❌ FINALIZADO COM AVISOS: ${deficitCount} vagas não puderam ser preenchidas.`);
    } else {
        cleanLogs.push(`✅ SUCESSO: Distribuição balanceada.`);
    }

    setLogs(cleanLogs);
    
    const updatedScale = [...preservedScale, ...newScaleEntries].sort((a, b) => a.date.localeCompare(b.date));
    
    onUpdateData({
        ...data,
        personnel: tempPersonnel,
        scale: updatedScale
    });

    if (startDate) {
        setFilterMonth(startDate.slice(0, 7));
    }

    setGenerating(false);

    if (deficitCount > 0) {
        setWarningModal({
            isOpen: true,
            title: "Escala Gerada com Pendências",
            message: (
                <div className="space-y-4">
                    <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r flex items-start gap-3">
                        <AlertTriangle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-bold text-red-800">Déficit de Pessoal Detectado</h4>
                            <p className="text-sm text-red-700 mt-1">
                                O algoritmo não encontrou militares aptos para preencher <strong>{deficitCount} vagas</strong>.
                            </p>
                        </div>
                    </div>
                </div>
            ),
            onConfirm: () => setWarningModal(null)
        });
    }
  };

  return (
    <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 animate-fade-in relative">
      
      {confirmModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col transform transition-all animate-scale-in">
                <div className="bg-yellow-500 p-4 flex justify-between items-center text-white">
                    <h3 className="font-bold text-lg flex items-center"><AlertTriangle className="w-6 h-6 mr-2 fill-current text-white" /> Atenção</h3>
                    <button onClick={() => setConfirmModal(null)} className="text-white/80 hover:text-white"><X className="w-6 h-6"/></button>
                </div>
                <div className="p-6">
                    <h4 className="text-xl font-bold text-gray-800 mb-4">{confirmModal.title}</h4>
                    <div>{confirmModal.message}</div>
                </div>
                <div className="bg-gray-50 p-4 border-t border-gray-100 flex justify-end gap-3">
                    <button onClick={() => setConfirmModal(null)} className="px-4 py-2 text-gray-600 font-bold hover:bg-gray-200 rounded-lg transition-colors">Cancelar</button>
                    <button onClick={confirmModal.onConfirm} className="px-6 py-2 bg-yellow-500 text-white font-bold rounded-lg hover:bg-yellow-600 shadow-md transition-colors">Confirmar e Gerar</button>
                </div>
            </div>
        </div>
      )}

      {warningModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col transform transition-all animate-scale-in">
                <div className="bg-red-600 p-4 flex justify-between items-center text-white">
                    <h3 className="font-bold text-lg flex items-center"><AlertCircle className="w-6 h-6 mr-2 fill-current text-white" /> Aviso de Geração</h3>
                    <button onClick={() => setWarningModal(null)} className="text-white/80 hover:text-white"><X className="w-6 h-6"/></button>
                </div>
                <div className="p-6">
                    <h4 className="text-xl font-bold text-gray-800 mb-4">{warningModal.title}</h4>
                    <div>{warningModal.message}</div>
                </div>
                <div className="bg-gray-50 p-4 border-t border-gray-100 flex justify-end gap-3">
                    <button onClick={() => setWarningModal(null)} className="px-6 py-2 bg-gray-800 text-white font-bold rounded-lg hover:bg-gray-900 shadow-md transition-colors">Entendido</button>
                </div>
            </div>
        </div>
      )}

      <div className="flex items-center mb-8 pb-4 border-b border-gray-100">
        <div className="bg-military-100 p-2 rounded-lg mr-3">
            <BrainCircuit className="w-6 h-6 text-military-700" />
        </div>
        <div>
            <h2 className="text-2xl font-bold text-gray-900">Gerador Inteligente (Anti-Platô)</h2>
            <p className="text-sm text-gray-500">Distribuição dinâmica com penalização exponencial para topos de média.</p>
        </div>
      </div>

      <div className="bg-gray-50 p-5 rounded-xl border border-gray-200 mb-8">
        <h3 className="font-bold text-gray-700 mb-3 flex items-center text-sm uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4 mr-2 text-military-600" /> Política de Distribuição (EP vs EV)
        </h3>
        <label className="flex items-center space-x-3 cursor-pointer select-none group">
            <div className="relative">
                <input 
                    type="checkbox" 
                    checked={equalizeScale}
                    onChange={(e) => setEqualizeScale(e.target.checked)}
                    className="peer sr-only"
                />
                <div className="w-10 h-6 bg-gray-300 rounded-full peer peer-checked:bg-military-600 transition-colors"></div>
                <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4"></div>
            </div>
            <div className="text-sm">
                <span className="font-bold text-gray-800 block group-hover:text-military-700 transition-colors">Equalizar Carga de Trabalho (Média Global)</span>
                <span className="text-gray-500 text-xs italic">
                    {equalizeScale 
                        ? "MODO ATIVO: EP e EV concorrem na mesma média. Elimina hierarquia para focar em números absolutos." 
                        : "MODO PADRÃO: EP persegue média de EP. EV persegue média de EV. Respeita a proporcionalidade dos efetivos."}
                </span>
            </div>
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8 items-end">
        <div className="space-y-2 md:col-span-4 lg:col-span-1">
             <label className="block text-xs font-bold text-gray-500 uppercase flex items-center gap-1">
                 <Layers className="w-3 h-3" /> Serviço Alvo
             </label>
             <select 
                value={targetServiceId}
                onChange={(e) => setTargetServiceId(e.target.value)}
                className="w-full p-3 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-military-500 outline-none text-sm font-bold text-gray-800"
             >
                 <option value="TODOS">⚡ GERAR TODOS OS SERVIÇOS</option>
                 <hr />
                 {data.services
                    .map(s => (
                     <option key={s.id} value={s.id}>{s.name} ({s.is24h ? '24h' : 'Exp'})</option>
                 ))}
             </select>
        </div>

        <div className="space-y-2 lg:col-span-1">
          <label className="block text-xs font-bold text-gray-500 uppercase">Data Início</label>
          <input type="date" className="w-full p-3 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-military-500 outline-none text-sm" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div className="space-y-2 lg:col-span-1">
          <label className="block text-xs font-bold text-gray-500 uppercase">Data Fim</label>
          <input type="date" className="w-full p-3 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-military-500 outline-none text-sm" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
        <div className="lg:col-span-1">
          <button
            onClick={handleGenerateClick}
            disabled={generating}
            className={`w-full p-3 rounded-lg text-white font-bold text-sm shadow-lg transition-all active:scale-95 flex justify-center items-center gap-2 ${
              generating ? 'bg-gray-400 cursor-not-allowed' : 'bg-military-600 hover:bg-military-700'
            }`}
          >
             {generating ? <RefreshCw className="w-5 h-5 animate-spin" /> : <><Play className="w-4 h-4 fill-current" /> {targetServiceId === 'TODOS' ? 'Gerar Completa' : 'Gerar Individual'}</>}
          </button>
        </div>
      </div>

      <div className="bg-military-900 rounded-xl p-6 h-64 overflow-y-auto border border-military-800 font-mono text-sm shadow-inner">
        <div className="flex items-center mb-4 border-b border-military-800 pb-2">
            <FileText className="w-4 h-4 text-military-400 mr-2" />
            <h3 className="font-bold text-military-300 uppercase text-xs tracking-widest">Logs de Auditoria de Escala</h3>
        </div>
        {logs.length === 0 && <p className="text-military-600 italic mt-8 text-center text-xs">Defina o período e o serviço para iniciar a geração.</p>}
        <div className="space-y-2">
            {logs.map((log, idx) => (
              <div key={idx} className={`py-1 border-l-2 pl-4 ${log.includes('⚠️') ? 'text-yellow-400 border-yellow-500 bg-yellow-950/20' : log.includes('✅') ? 'text-green-400 border-green-500 font-bold' : log.includes('ℹ️') ? 'text-blue-400 border-blue-500' : log.includes('❌') ? 'text-red-400 border-red-500' : 'text-military-400 border-military-700'}`}>
                  <span className="opacity-50 mr-2">[{new Date().toLocaleTimeString()}]</span> {log}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export default ScaleGenerator;
