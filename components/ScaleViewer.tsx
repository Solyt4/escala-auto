import React, { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { ScaleEntry, Rank, ServiceType, Military } from '../types';
import { isRedScale, syncPersonnelStats, commitScaleToHistory, parseISO } from '../utils/helpers';
import { logAuditAction } from '../services/db';
import { format, addDays, differenceInDays } from 'date-fns';
import ptBR from 'date-fns/locale/pt-BR';
import { 
  Calendar, Printer, CalendarDays, X, Bomb, 
  Trash2, RefreshCw, Info, ArrowLeftRight, Search, UserPlus, Shield, Plus, Pencil, Check, AlertTriangle, Archive, Minus
} from 'lucide-react';

const ScaleViewer: React.FC = () => {
  const { data, user, filterMonth, setFilterMonth, setAppData } = useAppStore();
  const [isProcessing, setIsProcessing] = useState(false);
  const [filterExactDate, setFilterExactDate] = useState('');
  
  const [swapSource, setSwapSource] = useState<ScaleEntry | null>(null);
  const [swapSearchTerm, setSwapSearchTerm] = useState('');
  const [swapMode, setSwapMode] = useState<'TROCA' | 'SUBSTITUICAO'>('TROCA');
  const [swapReason, setSwapReason] = useState('');

  const [editingServiceKey, setEditingServiceKey] = useState<string | null>(null);
  const [editingServiceValue, setEditingServiceValue] = useState('');

  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    isDestructive?: boolean;
    onConfirm: () => void;
  } | null>(null);

  const currentUser = user!;

  useEffect(() => {
      setFilterExactDate('');
  }, [filterMonth]);

  const serviceMap = useMemo(() => {
    const map = new Map<string, ServiceType>(data.services.map(s => [s.id, s]));
    if (!map.has('apoio')) {
        map.set('apoio', {
            id: 'apoio',
            name: 'Apoio / Missões',
            allowedRanks: [Rank.CB, Rank.SD_EP, Rank.SD_EV],
            quantity: 0,
            is24h: false,
            isBlackScaleOnly: true
        });
    }
    return map;
  }, [data.services]);

  const filteredScale = useMemo(() => {
    return data.scale
      .filter(s => {
          const entryDate = s.date.substring(0, 10);
          if (filterExactDate) return entryDate === filterExactDate;
          return entryDate.startsWith(filterMonth);
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data.scale, filterExactDate, filterMonth]);

  const totalEntriesInBase = data.scale.length;

  const getShortRank = (rank: Rank) => {
      if (rank === Rank.CB) return 'Cb';
      if (rank === Rank.SD_EP || rank === Rank.SD_EV) return 'Sd';
      return rank;
  };

  const groupedAndSortedData = useMemo(() => {
    const grouped = filteredScale.reduce((acc, curr) => {
      const dateKey = curr.date.substring(0, 10);
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(curr);
      return acc;
    }, {} as Record<string, ScaleEntry[]>);

    const sortedGroups: { date: string; entries: ScaleEntry[][]; serviceOrder: string[] }[] = [];

    Object.keys(grouped).sort().forEach(date => {
        const dateEntries = grouped[date];
        const sortedEntries = [...dateEntries].sort((a, b) => {
            const getPriority = (entryId: string) => {
                const svcName = serviceMap.get(entryId)?.name?.toLowerCase() || '';

                if (entryId === 'aux_cabo' || svcName.includes('cabo auxiliar') || svcName.includes('auxiliar de cabo')) return 1;
                if (entryId === 'aux_soldado' || svcName.includes('soldado auxiliar') || svcName.includes('auxiliar de soldado')) return 2;
                if (entryId === 'sv_24h' || svcName.includes('24h') || svcName.includes('24 horas')) return 3;
                if (entryId === 'insp_rampa' || svcName.includes('rampa')) return 4;
                return 10;
            };
            return getPriority(a.serviceTypeId) - getPriority(b.serviceTypeId);
        });

        const entriesByService: Record<string, ScaleEntry[]> = {};
        const serviceOrder: string[] = [];
        
        sortedEntries.forEach(e => {
            if (!entriesByService[e.serviceTypeId]) {
                entriesByService[e.serviceTypeId] = [];
                serviceOrder.push(e.serviceTypeId);
            }
            entriesByService[e.serviceTypeId].push(e);
        });

        const entriesArray = serviceOrder.map(id => entriesByService[id]);

        sortedGroups.push({
            date,
            entries: entriesArray,
            serviceOrder
        });
    });

    return sortedGroups;
  }, [filteredScale, serviceMap]);

  const handleDeleteDayClick = (dateStr: string) => {
    const formattedDate = format(parseISO(dateStr), "dd/MM/yyyy");
    setModalConfig({
        isOpen: true,
        title: "Excluir Dia Inteiro",
        message: (
          <span>
            Tem certeza que deseja excluir <strong>TODAS</strong> as escalas do dia <strong className="text-red-600">{formattedDate}</strong>?
            <br/><br/>
            Esta ação removerá todos os serviços (24h, Rampa, Apoio, etc) referentes a esta data e <strong>removerá a contagem</strong> estatística destes serviços.
          </span>
        ),
        isDestructive: true,
        onConfirm: () => deleteDayLogic(dateStr)
    });
  };

  const deleteDayLogic = async (dateStr: string) => {
    setModalConfig(null);
    setIsProcessing(true);

    try {
        const targetDate = dateStr.substring(0, 10);
        const currentData = useAppStore.getState().data;

        const remainingScale = currentData.scale.filter(s => s.date.substring(0, 10) !== targetDate);
        const deletedCount = currentData.scale.length - remainingScale.length;

        if (deletedCount === 0) {
            setIsProcessing(false);
            return;
        }

        const updatedPersonnel = syncPersonnelStats(currentData.personnel, remainingScale);
        const newData = { ...currentData, scale: remainingScale, personnel: updatedPersonnel };
        
        setAppData(newData);

        await logAuditAction({
            action: 'DELETE_DAY_SCALE',
            user_id: currentUser.username,
            deleted_item_id: targetDate,
            deleted_item_type: 'SCALE_ENTRY',
            details: `Excluída escala completa do dia ${targetDate} (${deletedCount} registros).`
        });

    } catch (err: any) {
        console.error("Erro ao excluir dia:", err);
    } finally {
        setTimeout(() => setIsProcessing(false), 500);
    }
  };

  const handleDeleteAllScalesClick = () => {
      setModalConfig({
          isOpen: true,
          title: "Encerrar Ciclo / Arquivar Escala",
          message: (
            <div className="space-y-3 text-sm text-gray-600">
                <p>Esta ação irá <strong>LIMPAR A VISUALIZAÇÃO</strong> de todas as escalas atuais para iniciar um novo ciclo.</p>
                
                <div className="bg-blue-50 p-3 rounded border border-blue-200 text-blue-800 flex gap-2">
                    <Archive className="w-5 h-5 shrink-0" />
                    <div>
                        <strong>Preservação de Dados:</strong><br/>
                        Os serviços realizados serão <strong>CONSOLIDADOS NO HISTÓRICO</strong>. A contagem total de serviços dos militares <strong>NÃO</strong> será perdida.
                    </div>
                </div>

                <p className="font-bold text-gray-800 mt-2">Deseja confirmar o arquivamento e limpeza?</p>
            </div>
          ),
          isDestructive: false,
          onConfirm: deleteAllScalesLogic
      });
  };

  const deleteAllScalesLogic = async () => {
    setModalConfig(null);
    setIsProcessing(true);

    try {
      const currentData = useAppStore.getState().data;

      const personnelWithHistory = commitScaleToHistory(currentData.personnel, currentData.scale);

      const emptyScale: ScaleEntry[] = [];

      const finalPersonnel = syncPersonnelStats(personnelWithHistory, emptyScale);

      const newData = { 
          ...currentData, 
          scale: emptyScale, 
          personnel: finalPersonnel 
      };
      
      setAppData(newData);

      await logAuditAction({
        action: 'ARCHIVE_SCALES',
        user_id: currentUser.username,
        deleted_item_id: 'ALL_RECORDS',
        deleted_item_type: 'SCALE_ENTRY',
        details: `Ciclo encerrado. Escalas arquivadas no histórico e visualização limpa.`
      });
      
    } catch (err: any) {
      console.error("[DB ERROR]", err);
    } finally {
      setTimeout(() => setIsProcessing(false), 500);
    }
  };

  const startEditingService = (date: string, serviceId: string, currentValue: string) => {
      setEditingServiceKey(`${date}_${serviceId}`);
      setEditingServiceValue(currentValue);
  };

  const cancelEditingService = () => {
      setEditingServiceKey(null);
      setEditingServiceValue('');
  };

  const saveEditingService = async (date: string, serviceId: string) => {
      if (!editingServiceKey) return;
      setIsProcessing(true);
      
      try {
          const finalValue = editingServiceValue.trim();
          const normalizedDate = date.substring(0, 10);
          const currentData = useAppStore.getState().data;

          const updatedScale = currentData.scale.map(entry => {
              if (entry.date.substring(0, 10) === normalizedDate && entry.serviceTypeId === serviceId) {
                  return { ...entry, customNote: finalValue || undefined };
              }
              return entry;
          });

          const newData = { ...currentData, scale: updatedScale };
          setAppData(newData);
          
      } catch (e) {
          console.error("Erro ao salvar nome personalizado", e);
      } finally {
          setIsProcessing(false);
          setEditingServiceKey(null);
      }
  };

  const handleDeleteServiceGroupClick = (date: string, serviceId: string) => {
      setModalConfig({
          isOpen: true,
          title: "Remover Serviço da Escala",
          message: `Tem certeza que deseja remover este serviço (Apoio/Missões) e todos os militares escalados nele para o dia ${date}?`,
          isDestructive: true,
          onConfirm: () => handleDeleteServiceGroupLogic(date, serviceId)
      });
  };

  const handleDeleteServiceGroupLogic = async (date: string, serviceId: string) => {
      setModalConfig(null);
      setIsProcessing(true);
      
      try {
          const targetDate = date.substring(0, 10); 
          const currentData = useAppStore.getState().data;

          const entriesToDelete = currentData.scale.filter(s => s.date.substring(0, 10) === targetDate && s.serviceTypeId === serviceId);
          const count = entriesToDelete.length;

          if (count === 0) {
             setIsProcessing(false);
             return;
          }

          const remainingScale = currentData.scale.filter(s => {
              const entryDate = s.date.substring(0, 10);
              const match = entryDate === targetDate && s.serviceTypeId === serviceId;
              return !match;
          });

          const updatedPersonnel = syncPersonnelStats(currentData.personnel, remainingScale);
          const newData = { ...currentData, scale: remainingScale, personnel: updatedPersonnel };
          
          setAppData(newData);

          await logAuditAction({
            action: 'DELETE_SUPPORT_MISSION',
            user_id: currentUser.username,
            deleted_item_id: 'batch',
            deleted_item_type: 'SCALE_ENTRY',
            details: `Removido Apoio/Missão do dia ${targetDate} (${count} militares liberados)`
          });

      } catch (err: any) {
          console.error(err);
      } finally {
          setTimeout(() => setIsProcessing(false), 500);
      }
  };

  const handleAddSingleSupport = async (dateStr: string) => {
      setIsProcessing(true);
      try {
          const SUPPORT_ID = 'apoio';
          const targetDate = dateStr.substring(0, 10);
          
          const serviceDef: ServiceType = {
              id: SUPPORT_ID,
              name: 'Apoio / Missões',
              allowedRanks: [Rank.CB, Rank.SD_EP, Rank.SD_EV],
              quantity: 1, 
              is24h: false,
              isBlackScaleOnly: true 
          };

          const scaledTodayIds = new Set(data.scale.filter(s => s.date.substring(0, 10) === targetDate).map(s => s.militaryId));

          let candidates = data.personnel.filter(p => {
              if (p.status !== 'ATIVO') return false;
              if (!serviceDef.allowedRanks.includes(p.rank)) return false;
              if (p.unavailableDates.some(d => d.substring(0, 10) === targetDate)) return false;
              if (scaledTodayIds.has(p.id)) return false; 
              
              if (p.sector) {
                  const rule = data.sectorRules?.find(r => r.sectorName.toLowerCase() === p.sector!.toLowerCase());
                  if (rule && !rule.allowedServiceIds.includes(SUPPORT_ID)) {
                      return false;
                  }
              }
              return true;
          });

          candidates.sort(() => Math.random() - 0.5);

          candidates.sort((a, b) => {
             if (!a.lastServiceDate && b.lastServiceDate) return -1;
             if (a.lastServiceDate && !b.lastServiceDate) return 1;
             if (!a.lastServiceDate && !b.lastServiceDate) return 0;

             const target = parseISO(targetDate);
             const dateA = parseISO(a.lastServiceDate!);
             const dateB = parseISO(b.lastServiceDate!);

             const diffA = differenceInDays(target, dateA);
             const diffB = differenceInDays(target, dateB);

             const isRestedA = diffA >= 2;
             const isRestedB = diffB >= 2;

             if (isRestedA && !isRestedB) return -1;
             if (!isRestedA && isRestedB) return 1;

             if (isRestedA && isRestedB) return 0;

             return diffB - diffA;
          });

          if (candidates.length === 0) {
              setModalConfig({
                  isOpen: true,
                  title: "Nenhum Militar Apto",
                  message: "Não há militares disponíveis para adicionar a este apoio hoje (todos escalados ou impedidos).",
                  onConfirm: () => setModalConfig(null)
              });
              setIsProcessing(false);
              return;
          }

          const selected = candidates[0];
          executeAddMission(targetDate, [selected], SUPPORT_ID);

      } catch (err) {
          console.error(err);
          setIsProcessing(false);
      }
  };

  const handleRemoveSingleSupport = async (dateStr: string) => {
      setIsProcessing(true);
      try {
          const SUPPORT_ID = 'apoio';
          const targetDate = dateStr.substring(0, 10);
          const currentData = useAppStore.getState().data;

          const entries = currentData.scale.filter(s => s.date.substring(0, 10) === targetDate && s.serviceTypeId === SUPPORT_ID);

          if (entries.length <= 1) {
              setModalConfig({
                  isOpen: true,
                  title: "Limite Mínimo Atingido",
                  message: "O serviço de Apoio/Missões deve ter no mínimo 1 militar escalado. Para remover tudo, use o botão de excluir o serviço inteiro.",
                  onConfirm: () => setModalConfig(null)
              });
              setIsProcessing(false);
              return;
          }

          const entryToRemove = entries[entries.length - 1];
          
          const remainingScale = currentData.scale.filter(s => s.id !== entryToRemove.id);
          const updatedPersonnel = syncPersonnelStats(currentData.personnel, remainingScale);
          const newData = { ...currentData, scale: remainingScale, personnel: updatedPersonnel };
          
          setAppData(newData);

          await logAuditAction({
              action: 'DELETE_SUPPORT_MISSION',
              user_id: currentUser.username,
              deleted_item_id: entryToRemove.id,
              deleted_item_type: 'SCALE_ENTRY',
              details: `Reduzido efetivo de Apoio no dia ${targetDate}. Removido: ${entryToRemove.militaryName}`
          });
          
      } catch(err) {
          console.error(err);
      } finally {
          setTimeout(() => setIsProcessing(false), 500);
      }
  };

  const handleAddSupportMission = async (dateStr: string) => {
      setIsProcessing(true);
      try {
          const SUPPORT_ID = 'apoio';
          const QUANTITY = 2;
          const targetDate = dateStr.substring(0, 10);
          
          const serviceDef: ServiceType = {
              id: SUPPORT_ID,
              name: 'Apoio / Missões',
              allowedRanks: [Rank.CB, Rank.SD_EP, Rank.SD_EV],
              quantity: QUANTITY,
              is24h: false,
              isBlackScaleOnly: true 
          };

          const scaledTodayIds = new Set(data.scale.filter(s => s.date.substring(0, 10) === targetDate).map(s => s.militaryId));

          let candidates = data.personnel.filter(p => {
              if (p.status !== 'ATIVO') return false;
              if (!serviceDef.allowedRanks.includes(p.rank)) return false;
              if (p.unavailableDates.some(d => d.substring(0, 10) === targetDate)) return false;
              if (scaledTodayIds.has(p.id)) return false;
              
              if (p.sector) {
                  const rule = data.sectorRules?.find(r => r.sectorName.toLowerCase() === p.sector!.toLowerCase());
                  if (rule && !rule.allowedServiceIds.includes(SUPPORT_ID)) {
                      return false;
                  }
              }
              return true;
          });

          candidates.sort(() => Math.random() - 0.5);

          candidates.sort((a, b) => {
             if (!a.lastServiceDate && b.lastServiceDate) return -1;
             if (a.lastServiceDate && !b.lastServiceDate) return 1;
             if (!a.lastServiceDate && !b.lastServiceDate) return 0;

             const target = parseISO(targetDate);
             const dateA = parseISO(a.lastServiceDate!);
             const dateB = parseISO(b.lastServiceDate!);

             const diffA = differenceInDays(target, dateA);
             const diffB = differenceInDays(target, dateB);

             const isRestedA = diffA >= 2;
             const isRestedB = diffB >= 2;

             if (isRestedA && !isRestedB) return -1;
             if (!isRestedA && isRestedB) return 1;

             if (isRestedA && isRestedB) return 0;

             return diffB - diffA;
          });

          const selected = candidates.slice(0, QUANTITY);

          if (selected.length === 0) {
              setModalConfig({
                  isOpen: true,
                  title: "Nenhum Militar Apto",
                  message: "Não foram encontrados militares aptos (ativos, sem serviço hoje e dentro das regras) para esta missão nesta data.",
                  onConfirm: () => setModalConfig(null)
              });
              setIsProcessing(false);
              return;
          }

          if (selected.length < QUANTITY) {
             setModalConfig({
                isOpen: true,
                title: "Efetivo Parcial Encontrado",
                message: `Atenção: Apenas ${selected.length} militares aptos encontrados para a missão (necessários: ${QUANTITY}). Deseja escalar assim mesmo?`,
                onConfirm: () => executeAddMission(targetDate, selected, SUPPORT_ID)
             });
             return;
          }

          executeAddMission(targetDate, selected, SUPPORT_ID);

      } catch (err: any) {
          console.error(err);
          setIsProcessing(false);
      }
  };

  const executeAddMission = async (dateStr: string, selected: Military[], serviceId: string) => {
      setModalConfig(null);
      try {
          const currentData = useAppStore.getState().data;
          const newEntries: ScaleEntry[] = selected.map(mil => ({
              id: `ent_support_${dateStr}_${mil.id}_${Date.now()}_${Math.random()}`,
              date: dateStr,
              serviceTypeId: serviceId,
              militaryId: mil.id,
              militaryName: mil.warName,
              militaryRank: mil.rank,
              changeType: 'INCLUSAO_MANUAL'
          }));

          const updatedScale = [...currentData.scale, ...newEntries].sort((a, b) => a.date.localeCompare(b.date));
          const updatedPersonnel = syncPersonnelStats(currentData.personnel, updatedScale);

          const newData = { ...currentData, scale: updatedScale, personnel: updatedPersonnel };
          
          setAppData(newData); 
          
          await logAuditAction({
              action: 'ADD_SUPPORT_MISSION',
              user_id: currentUser.username,
              deleted_item_id: 'batch',
              deleted_item_type: 'SCALE_ENTRY',
              details: `Adicionado Apoio/Missão para ${selected.length} militares no dia ${dateStr}`
          });
      } finally {
          setTimeout(() => setIsProcessing(false), 500);
      }
  };

  const initiateSwap = (entry: ScaleEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    setSwapSource(entry);
    setSwapSearchTerm('');
    setSwapMode('TROCA');
    setSwapReason('');
  };

  const executeSwap = async (targetMilitary: Military, targetEntryId?: string) => {
    if (!swapSource) return;
    setIsProcessing(true);

    if (swapMode === 'SUBSTITUICAO' && !swapReason.trim()) {
        setModalConfig({
            isOpen: true,
            title: "Motivo Obrigatório",
            message: "Para realizar uma substituição, é obrigatório informar o motivo (ex: Baixa Médica, Dispensa, etc).",
            onConfirm: () => setModalConfig(null)
        });
        setIsProcessing(false);
        return;
    }

    try {
        const currentData = useAppStore.getState().data;
        const newScale = [...currentData.scale];
        const sourceIndex = newScale.findIndex(s => s.id === swapSource.id);
        
        if (sourceIndex === -1) throw new Error("Entrada de origem não encontrada.");

        const sourceEntry = newScale[sourceIndex];
        const sourceDate = sourceEntry.date.substring(0, 10);

        let logDetails = '';

        if (swapMode === 'TROCA') {
            let targetIndex = -1;
            if (targetEntryId) {
                targetIndex = newScale.findIndex(s => s.id === targetEntryId);
            } else {
                targetIndex = newScale.findIndex(s => s.date.substring(0, 10) === sourceDate && s.militaryId === targetMilitary.id);
            }

            if (targetIndex !== -1) {
                const targetEntry = newScale[targetIndex];
                const sourceMilId = sourceEntry.militaryId;
                const sourceMilName = sourceEntry.militaryName;
                const sourceMilRank = sourceEntry.militaryRank;
                const sourceOriginal = sourceEntry.originalMilitaryId || sourceEntry.militaryId;
                const targetOriginal = targetEntry.originalMilitaryId || targetEntry.militaryId;

                newScale[sourceIndex] = {
                    ...sourceEntry,
                    militaryId: targetEntry.militaryId,
                    militaryName: targetEntry.militaryName,
                    militaryRank: targetEntry.militaryRank,
                    originalMilitaryId: sourceOriginal,
                    changeType: 'PERMUTA'
                };

                newScale[targetIndex] = {
                    ...targetEntry,
                    militaryId: sourceMilId,
                    militaryName: sourceMilName,
                    militaryRank: sourceMilRank,
                    originalMilitaryId: targetOriginal,
                    changeType: 'PERMUTA'
                };

                logDetails = `Permuta realizada: ${sourceMilName} (Dia ${sourceEntry.date}) <-> ${targetEntry.militaryName} (Dia ${targetEntry.date})`;
            } else {
                console.error("Não foi possível localizar o serviço de destino.");
                setIsProcessing(false);
                return;
            }

        } else {
            const oldName = sourceEntry.militaryName;
            const originalOwner = sourceEntry.originalMilitaryId || sourceEntry.militaryId;
            
            newScale[sourceIndex] = {
                ...sourceEntry,
                originalMilitaryId: originalOwner,
                militaryId: targetMilitary.id,
                militaryName: targetMilitary.warName,
                militaryRank: targetMilitary.rank,
                changeType: 'SUBSTITUICAO'
            };

            logDetails = `Substituição: ${targetMilitary.warName} assumiu serviço de ${oldName} no dia ${swapSource.date}. Motivo: ${swapReason}`;
        }

        const updatedPersonnel = syncPersonnelStats(currentData.personnel, newScale);
        const newData = { ...currentData, scale: newScale, personnel: updatedPersonnel };

        setAppData(newData); 

        await logAuditAction({
            action: 'SWAP_SERVICE',
            user_id: currentUser.username,
            deleted_item_id: swapSource.id,
            deleted_item_type: 'SCALE_ENTRY',
            details: logDetails
        });

    } catch (err) {
        console.error("Erro na troca:", err);
    } finally {
        setTimeout(() => setIsProcessing(false), 500);
        setSwapSource(null);
    }
  };

  const availableCandidates = useMemo(() => {
    if (!swapSource) return [];
    
    return data.personnel.filter(p => {
      const sourceDate = swapSource.date.substring(0, 10);
      const sourceService = serviceMap.get(swapSource.serviceTypeId);
      
      if (p.rank !== swapSource.militaryRank) return false;
      if (p.id === swapSource.militaryId) return false;
      if (p.status !== 'ATIVO') return false;
      if (swapMode === 'SUBSTITUICAO' && p.unavailableDates.some(d => d.substring(0, 10) === sourceDate)) return false;

      const forcedServices = p.exemptions?.forceAllowedServices || [];
      const hasExclusivity = forcedServices.length > 0;

      if (hasExclusivity) {
          if (!forcedServices.includes(swapSource.serviceTypeId)) {
              return false;
          }
      } else {
          if (sourceService) {
              const candidateFormation = p.formationYear || 0;
              if (sourceService.maxFormationYear && candidateFormation > sourceService.maxFormationYear) {
                  return false;
              }
              if (p.sector) {
                  const rule = data.sectorRules?.find(r => r.sectorName.toLowerCase() === p.sector!.toLowerCase());
                  if (rule && !rule.allowedServiceIds.includes(sourceService.id)) {
                      return false;
                  }
              }
          }
      }

      if (swapMode === 'TROCA') {
         let targetEntry = data.scale.find(s => s.date.substring(0, 10) === sourceDate && s.militaryId === p.id);
         if (!targetEntry) {
             targetEntry = data.scale
                 .filter(s => s.militaryId === p.id && s.date > sourceDate)
                 .sort((a,b) => a.date.localeCompare(b.date))[0];
         }
         
         if (targetEntry) {
             const targetService = serviceMap.get(targetEntry.serviceTypeId);
             const sourceMil = data.personnel.find(m => m.id === swapSource.militaryId);
             
             if (targetService && sourceMil) {
                 const sourceForced = sourceMil.exemptions?.forceAllowedServices || [];
                 if (sourceForced.length > 0 && !sourceForced.includes(targetService.id)) return false;

                 if (sourceForced.length === 0) {
                     const sourceFormation = sourceMil.formationYear || 0;
                     if (targetService.maxFormationYear && sourceFormation > targetService.maxFormationYear) {
                         return false;
                     }
                     if (sourceMil.sector) {
                         const sourceRule = data.sectorRules?.find(r => r.sectorName.toLowerCase() === sourceMil.sector!.toLowerCase());
                         if (sourceRule && !sourceRule.allowedServiceIds.includes(targetService.id)) {
                             return false;
                         }
                     }
                 }
             }
         }
      }

      if (swapMode === 'TROCA') {
          const hasFutureScales = data.scale.some(s => s.militaryId === p.id && s.date >= sourceDate);
          if (!hasFutureScales) return false;
      }
      
      if (swapSearchTerm) {
          const term = swapSearchTerm.toLowerCase();
          return p.warName.toLowerCase().includes(term) || p.number.includes(term);
      }
      return true;
  }).sort((a, b) => a.warName.localeCompare(b.warName));
  }, [data.personnel, data.scale, data.sectorRules, serviceMap, swapMode, swapReason, swapSearchTerm, swapSource]);

  return (
    <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 relative print:shadow-none print:border-none print:p-0">
      
      {modalConfig && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in print:hidden">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col transform transition-all animate-scale-in">
                <div className={`${modalConfig.isDestructive ? 'bg-red-600' : 'bg-military-600'} p-4 flex justify-between items-center text-white`}>
                    <h3 className="font-bold text-lg flex items-center"><AlertTriangle className="w-6 h-6 mr-2 fill-current text-white" /> Confirmação</h3>
                    <button onClick={() => setModalConfig(null)} className="text-white/80 hover:text-white"><X className="w-6 h-6"/></button>
                </div>
                <div className="p-6">
                    <h4 className="text-xl font-bold text-gray-800 mb-4">{modalConfig.title}</h4>
                    <div className="text-gray-600">{modalConfig.message}</div>
                </div>
                <div className="bg-gray-50 p-4 border-t border-gray-100 flex justify-end gap-3">
                    <button onClick={() => setModalConfig(null)} className="px-4 py-2 text-gray-600 font-bold hover:bg-gray-200 rounded-lg transition-colors">Cancelar</button>
                    <button onClick={modalConfig.onConfirm} className={`px-6 py-2 text-white font-bold rounded-lg shadow-md transition-colors ${modalConfig.isDestructive ? 'bg-red-600 hover:bg-red-700' : 'bg-military-600 hover:bg-military-700'}`}>Confirmar</button>
                </div>
            </div>
        </div>
      )}

      {isProcessing && (
          <div className="absolute top-2 right-2 flex items-center gap-2 text-[10px] font-bold text-gray-500 animate-pulse print:hidden">
              <RefreshCw className="w-3 h-3 animate-spin" /> PROCESSANDO...
          </div>
      )}

      {swapSource && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 print:hidden animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh] animate-scale-in">
                <div className="bg-military-900 p-4 flex justify-between items-center text-white shrink-0">
                    <div>
                        <h3 className="font-bold text-lg flex items-center"><ArrowLeftRight className="w-5 h-5 mr-2"/> Gerenciar Escala</h3>
                        <p className="text-xs text-military-300">Selecione o tipo de movimentação.</p>
                    </div>
                    <button onClick={() => setSwapSource(null)}><X className="w-6 h-6 text-gray-400 hover:text-white"/></button>
                </div>
                
                <div className="flex border-b border-gray-200 bg-gray-50">
                    <button 
                        onClick={() => setSwapMode('TROCA')}
                        className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${swapMode === 'TROCA' ? 'bg-white text-military-700 border-t-2 border-military-600 shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}
                    >
                        <ArrowLeftRight className="w-4 h-4" /> TROCA (Permuta)
                    </button>
                    <button 
                        onClick={() => setSwapMode('SUBSTITUICAO')}
                        className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${swapMode === 'SUBSTITUICAO' ? 'bg-white text-green-700 border-t-2 border-green-600 shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}
                    >
                        <UserPlus className="w-4 h-4" /> SUBSTITUIÇÃO
                    </button>
                </div>
                
                {swapMode === 'SUBSTITUICAO' && (
                    <div className="p-4 bg-orange-50 border-b border-orange-100 animate-fade-in">
                        <label className="block text-xs font-bold text-orange-800 uppercase mb-2 flex items-center gap-1">
                            Motivo da Substituição <span className="text-red-600">*</span>
                        </label>
                        <input 
                            type="text" 
                            className="w-full p-3 border border-gray-300 rounded-lg text-sm bg-white text-gray-900 placeholder-gray-500 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none shadow-sm transition-shadow"
                            placeholder="Ex: Baixa Médica, Dispensa, Troca de Turno..."
                            value={swapReason}
                            onChange={e => setSwapReason(e.target.value)}
                        />
                    </div>
                )}

                <div className="p-4 bg-white border-b border-gray-200 shrink-0">
                    <div className="flex items-center gap-4 bg-gray-50 p-3 rounded-lg border border-gray-200 shadow-sm mb-4">
                        <div className="bg-blue-100 p-2 rounded text-blue-700 font-bold text-xs uppercase text-center min-w-[60px]">
                            Origem
                        </div>
                        <div>
                            <div className="text-sm font-bold text-gray-800">{swapSource.militaryRank} {swapSource.militaryName}</div>
                            <div className="text-xs text-gray-500">
                                {format(new Date(swapSource.date.substring(0, 10) + 'T12:00:00'), "dd 'de' MMMM", { locale: ptBR })} - {serviceMap.get(swapSource.serviceTypeId)?.name}
                            </div>
                        </div>
                    </div>
                    
                    <div className="mb-2">
                        <div className="text-xs font-bold uppercase mb-1 text-gray-500">
                            {swapMode === 'TROCA' 
                                ? "Candidatos Disponíveis (Apenas quem possui escala futura)" 
                                : "Candidatos Disponíveis (Escalados ou de Folga)"}
                        </div>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input 
                                type="text" 
                                autoFocus
                                placeholder="Buscar militar por nome ou número..." 
                                className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-military-500 outline-none"
                                value={swapSearchTerm}
                                onChange={e => setSwapSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                <div className="overflow-y-auto p-2 space-y-2 bg-gray-100 flex-1">
                    {availableCandidates.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-gray-400">
                            <Shield className="w-10 h-10 mb-2 opacity-20" />
                            <span className="text-sm italic">Nenhum militar encontrado compatível com as regras.</span>
                            {swapMode === 'TROCA' && <span className="text-[10px] mt-1 text-center max-w-xs text-red-400">Verifique se há impedimentos de Antiguidade (Ano de Formação) ou Regras de Setor para o serviço cruzado.</span>}
                        </div>
                    ) : (
                        availableCandidates.map(candidate => {
                            const existingEntry = data.scale.find(s => s.date.substring(0, 10) === swapSource.date.substring(0, 10) && s.militaryId === candidate.id);
                            const isWorkingToday = !!existingEntry;
                            const serviceName = isWorkingToday ? (serviceMap.get(existingEntry!.serviceTypeId)?.name || 'Outro Serviço') : 'Folga Hoje';

                            const nextService = swapMode === 'TROCA' 
                                ? data.scale
                                    .filter(s => s.militaryId === candidate.id && s.date > swapSource.date.substring(0, 10) && s.date.substring(0, 10) !== swapSource.date.substring(0, 10))
                                    .sort((a,b) => a.date.localeCompare(b.date))[0]
                                : null;

                            if (swapMode === 'TROCA' && !isWorkingToday && !nextService) return null;

                            const isExclusive = candidate.exemptions?.forceAllowedServices?.length || 0 > 0;

                            return (
                                <div 
                                    key={candidate.id} 
                                    className="bg-white p-3 rounded-lg border border-gray-200 hover:border-military-500 cursor-pointer transition-all hover:shadow-md flex justify-between items-center group" 
                                    onClick={() => executeSwap(candidate, nextService?.id)}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`text-center min-w-[40px] px-2 py-1 rounded text-xs font-bold border ${isWorkingToday ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                                            {isWorkingToday ? 'Escalado' : 'Folga'}
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold text-gray-800 flex items-center gap-2">
                                                {candidate.rank} {candidate.warName}
                                                {isExclusive && (
                                                    <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 rounded border border-blue-200" title="Possui regra de Exclusividade/Antiguidade">
                                                        ★
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-xs text-gray-500 flex items-center gap-1">
                                                {serviceName}
                                                {nextService && (
                                                    <span className="text-blue-600 font-medium ml-1">
                                                        (Trocar com: {format(new Date(nextService.date.substring(0, 10) + 'T12:00:00'), "dd/MM")})
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className={`opacity-0 group-hover:opacity-100 transition-opacity px-3 py-1 rounded-full text-xs font-bold flex items-center ${swapMode === 'TROCA' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                                        {swapMode === 'TROCA' ? <><ArrowLeftRight className="w-3 h-3 mr-1" /> TROCAR</> : <><UserPlus className="w-3 h-3 mr-1" /> SUBSTITUIR</>}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4 print:hidden">
        <div className="flex items-center">
          <div className="bg-military-100 p-2 rounded-lg mr-3">
            <Calendar className="w-6 h-6 text-military-700" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-gray-900">Visualização da Escala</h3>
            <p className="text-xs text-gray-500">
                Mostrando {filteredScale.length} registros.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => window.print()} className="px-3 py-2 text-xs font-bold bg-white border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2">
              <Printer className="w-4 h-4"/> Imprimir
          </button>
          
          <div className="flex items-center space-x-2 bg-gray-50 p-1.5 rounded-lg border border-gray-200">
            <div className="flex items-center px-2 border-r border-gray-200">
                <Calendar className="w-4 h-4 text-gray-400 mr-2" />
                <span className="text-xs font-bold text-gray-500 mr-2 uppercase">Mês</span>
                <input 
                  type="month" 
                  value={filterMonth} 
                  onChange={(e) => { 
                      setFilterMonth(e.target.value); 
                  }} 
                  className="border-none bg-transparent font-bold text-gray-800 focus:ring-0 text-sm p-0 cursor-pointer w-32" 
                />
            </div>
            
            <div className="flex items-center px-2">
                <CalendarDays className="w-4 h-4 text-gray-400 mr-2" />
                <span className="text-xs font-bold text-gray-500 mr-2 uppercase">Dia</span>
                <input 
                  type="date" 
                  value={filterExactDate} 
                  onChange={(e) => { 
                      setFilterExactDate(e.target.value);
                      if (e.target.value) {
                          setFilterMonth(e.target.value.slice(0, 7));
                      }
                  }} 
                  className="border-none bg-transparent font-bold text-gray-800 focus:ring-0 text-sm p-0 cursor-pointer w-32" 
                />
            </div>
            {filterExactDate && (
                <button onClick={() => setFilterExactDate('')} title="Limpar filtro de dia" className="p-1 hover:bg-gray-200 rounded-full text-gray-400">
                    <X className="w-3 h-3" />
                </button>
            )}
          </div>

          <div className="flex gap-2">
              <button onClick={handleDeleteAllScalesClick} disabled={totalEntriesInBase === 0 || isProcessing} className={`px-4 py-2 text-xs font-bold bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 flex items-center gap-2 transition-colors ${totalEntriesInBase === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <Bomb className="w-4 h-4" /> Zerar Base
              </button>
          </div>
        </div>
      </div>

      <div className="space-y-12 print:space-y-8">
        {groupedAndSortedData.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-gray-100 rounded-2xl flex flex-col items-center">
            <Info className="w-10 h-10 text-gray-200 mb-3" />
            <p className="text-gray-400 font-medium">
                {filterExactDate 
                    ? `Nenhuma escala encontrada para o dia ${filterExactDate.split('-').reverse().join('/')}.` 
                    : "Nenhuma escala gerada para este mês."}
            </p>
          </div>
        ) : (
          groupedAndSortedData.map(({ date, entries, serviceOrder }) => {
            const dateObj = new Date(date + 'T12:00:00');
            const formattedDate = format(dateObj, "d 'DE' MMMM 'DE' yyyy", { locale: ptBR }).toUpperCase();
            const weekDay = format(dateObj, "eeee", { locale: ptBR });
            const weekDayFormatted = weekDay.charAt(0).toUpperCase() + weekDay.slice(1);
            
            const isRed = isRedScale(date);
            
            return (
              <div key={date} className="animate-fade-in print:break-inside-avoid">
                <div className="flex items-center justify-center mb-1 relative">
                    <div className="text-center font-serif">
                        <h2 className={`font-bold text-lg uppercase tracking-wide ${isRed ? 'text-red-700' : 'text-black'}`}>ESCALA PARA O DIA {formattedDate} – ({weekDayFormatted})</h2>
                        <h3 className="font-bold text-md uppercase text-black">SERVIÇO DE ESCALA 24 HORAS</h3>
                    </div>
                    <button 
                        onClick={() => handleDeleteDayClick(date)}
                        className="absolute right-0 top-1 text-gray-300 hover:text-red-600 transition-colors p-2 print:hidden"
                        title="EXCLUIR DIA INTEIRO"
                    >
                        <Trash2 className="w-5 h-5" />
                    </button>
                </div>

                <div className="border border-black">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className={`${isRed ? 'bg-red-700' : 'bg-[#009c3b]'} text-white print:print-color-adjust-exact`}>
                                <th className="border border-black px-2 py-1 text-center font-bold text-sm w-1/4">SERVIÇO</th>
                                <th className="border border-black px-2 py-1 text-center font-bold text-sm w-16">Grad</th>
                                <th className="border border-black px-2 py-1 text-center font-bold text-sm">Nome</th>
                                <th className="border border-black px-2 py-1 text-center font-bold text-sm w-1/4">Seção</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white font-serif text-black">
                            {serviceOrder.map((serviceId, serviceIndex) => {
                                const groupEntries = entries[serviceIndex];
                                const defaultName = serviceMap.get(serviceId)?.name || serviceId;
                                const customNote = groupEntries[0].customNote;
                                const displayName = customNote || defaultName;
                                const isApoio = serviceId === 'apoio';
                                
                                const isEditingThis = editingServiceKey === `${date}_${serviceId}`;

                                return groupEntries.map((entry, index) => {
                                    const military = data.personnel.find(p => p.id === entry.militaryId);
                                    const sector = military?.sector || 'ND';

                                    return (
                                        <tr 
                                            key={entry.id} 
                                            className="group hover:bg-gray-100 transition-colors"
                                        >
                                            {index === 0 && (
                                                <td 
                                                    className="border border-black px-2 py-2 text-center font-bold align-middle bg-white relative group/td" 
                                                    rowSpan={groupEntries.length}
                                                >
                                                    {isEditingThis ? (
                                                        <div className="flex flex-col items-center gap-1 animate-fade-in" onClick={e => e.stopPropagation()}>
                                                            <input 
                                                                type="text" 
                                                                autoFocus
                                                                value={editingServiceValue}
                                                                onChange={e => setEditingServiceValue(e.target.value)}
                                                                className="w-full text-center text-sm border border-blue-300 rounded p-1 focus:ring-2 focus:ring-blue-500 outline-none"
                                                            />
                                                            <div className="flex gap-1">
                                                                <button onClick={() => saveEditingService(date, serviceId)} className="bg-green-100 text-green-700 p-1 rounded hover:bg-green-200"><Check className="w-3 h-3"/></button>
                                                                <button onClick={cancelEditingService} className="bg-red-100 text-red-700 p-1 rounded hover:bg-red-200"><X className="w-3 h-3"/></button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            {displayName}
                                                            {isApoio && (
                                                                <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover/td:opacity-100 transition-opacity print:hidden bg-white/80 rounded px-1">
                                                                    <button 
                                                                        onClick={(e) => { e.stopPropagation(); startEditingService(date, serviceId, displayName); }}
                                                                        className="text-gray-400 hover:text-blue-500"
                                                                        title="Editar nome"
                                                                    >
                                                                        <Pencil className="w-3 h-3" />
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleAddSingleSupport(date); }}
                                                                        className="text-gray-400 hover:text-green-500"
                                                                        title="Adicionar +1 militar"
                                                                    >
                                                                        <Plus className="w-3 h-3" />
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleRemoveSingleSupport(date); }}
                                                                        className="text-gray-400 hover:text-orange-500"
                                                                        title="Remover 1 militar (Mín: 1)"
                                                                    >
                                                                        <Minus className="w-3 h-3" />
                                                                    </button>
                                                                    <button 
                                                                        onClick={(e) => { e.stopPropagation(); handleDeleteServiceGroupClick(date, serviceId); }}
                                                                        className="text-gray-400 hover:text-red-500"
                                                                        title="Excluir serviço inteiro"
                                                                    >
                                                                        <Trash2 className="w-3 h-3" />
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </>
                                                    )}
                                                </td>
                                            )}
                                            <td className="border border-black px-2 py-1 text-center">{getShortRank(entry.militaryRank)}</td>
                                            <td className="border border-black px-2 py-1 text-center font-bold uppercase relative group">
                                                <span>{military ? `${military.number} ${military.warName}` : entry.militaryName}</span>
                                                
                                                <button 
                                                    onClick={(e) => initiateSwap(entry, e)}
                                                    className="absolute right-1 top-1/2 -translate-y-1/2 bg-white/80 p-1 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity text-military-700 hover:text-military-900 hover:bg-white print:hidden"
                                                    title="Trocar Serviço"
                                                >
                                                    <ArrowLeftRight className="w-4 h-4" />
                                                </button>
                                            </td>
                                            <td className="border border-black px-2 py-1 text-center uppercase text-sm">{sector}</td>
                                        </tr>
                                    );
                                });
                            })}
                        </tbody>
                    </table>
                    <div className="flex justify-center p-2 bg-gray-50 border-t border-black print:hidden">
                        <button 
                            onClick={() => handleAddSupportMission(date)}
                            className="flex items-center gap-1 text-xs font-bold text-gray-500 hover:text-military-700 transition-colors px-3 py-1 rounded hover:bg-gray-200"
                        >
                            <Plus className="w-3 h-3" /> Adicionar Missões de Apoio (+2)
                        </button>
                    </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ScaleViewer;