import React, { useState, useMemo } from 'react';
import { Database, CheckCircle, AlertCircle, RefreshCw, FileJson, Download, X, PlusCircle, FileText, CloudCheck, CloudOff, ShieldAlert, Search, Unlock, Ban, Star } from 'lucide-react';
import { fetchRemoteData, saveRemoteData, logAuditAction } from '../services/db';
import { AppData, Military, Rank } from '../types';
import { format } from 'date-fns';
import { useAppStore } from '../store/useAppStore';

interface Props {
  currentData: AppData;
  onDataLoaded: (data: AppData) => void;
}

const DatabaseConfig: React.FC<Props> = ({ currentData, onDataLoaded }) => {
  const { user, setAppData } = useAppStore();
  const [loading, setLoading] = useState(false);
  
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [exemptionSearch, setExemptionSearch] = useState('');
  const [selectedExemptionId, setSelectedExemptionId] = useState<string | null>(null);

  const isAdminOrDev = user?.role === 'ADMIN' || user?.role === 'DEV';

  const personnelWithExemptions = useMemo(() => {
      return currentData.personnel.filter(p => {
          const ex = p.exemptions;
          if (!ex) return false;
          return ex.skipBlackScale || ex.skipRedScale || ex.bypassRiskWindow || (ex.forceAllowedServices && ex.forceAllowedServices.length > 0);
      }).sort((a, b) => a.warName.localeCompare(b.warName));
  }, [currentData.personnel]);

  const handleForceSync = async () => {
      setLoading(true);
      setError("");
      setSuccess("");
      try {
        const result = await saveRemoteData(currentData);
        if (result.success) {
            setSuccess("Sincronização concluída: Dados locais enviados para a nuvem.");
        } else {
            setError("Erro no upload: " + (result.error?.message || "Erro desconhecido"));
        }
      } catch (e: any) {
         setError("Erro crítico: " + e.message);
      } finally {
        setLoading(false);
      }
  };

  const handleForceLoad = async () => {
      setLoading(true);
      setError(""); 
      setSuccess("");
      
      try {
          const data = await fetchRemoteData();
          
          if (data) {
              onDataLoaded(data);
              setSuccess("Download concluído: Interface atualizada com dados da nuvem.");
          } else {
              setError("Nenhum dado encontrado na nuvem (Tabela vazia ou erro de conexão).");
          }
      } catch (e: any) {
          setError("Falha ao baixar: " + e.message);
      } finally {
          setLoading(false);
      }
  };

  const handleBulkImport = () => {
    try {
      setError("");
      const raw = JSON.parse(importJson);
      if (!Array.isArray(raw)) throw new Error("O JSON deve ser uma lista [] de objetos militares.");
      
      const imported: Military[] = raw.map((item, index) => {
        let rank = Rank.SD_EP;
        if (item.postoGraduacao === 'Cb' || item.rank?.includes('Cb')) rank = Rank.CB;
        else if (item.postoGraduacao === 'Sd Ev' || item.rank?.includes('EV')) rank = Rank.SD_EV;

        let services = item.eligibleServices || ['apoio'];
        if (services.length === 0) {
            if (rank === Rank.CB) services.push('aux_cabo');
            else if (rank === Rank.SD_EP) services.push('aux_soldado', 'sv_24h', 'insp_rampa');
            else if (rank === Rank.SD_EV) services.push('sv_24h');
        }

        return {
          id: item.id || `mil_${Math.random().toString(36).substr(2, 7)}_${index}_${Date.now()}`,
          number: item.number || item.numero || (currentData.personnel.length + index + 1).toString(),
          rank: item.rank || rank,
          warName: (item.warName || item.nomeGuerra || "SEM NOME").toUpperCase(),
          status: item.status || 'ATIVO',
          sector: item.sector || item.setor || '',
          eligibleServices: services,
          history: item.history || [],
          unavailableDates: item.unavailableDates || [],
          totalServices: item.totalServices || 0,
          formationYear: item.formationYear || item.anoFormacao || new Date().getFullYear()
        };
      });

      onDataLoaded({ ...currentData, personnel: [...currentData.personnel, ...imported] });
      setShowImport(false);
      setImportJson('');
      setSuccess(`${imported.length} militares importados com sucesso.`);
      setTimeout(() => setSuccess(""), 4000);
    } catch (e: any) {
      setError("Erro no JSON: " + e.message);
    }
  };

  const handleExportPersonnel = () => {
      const dataStr = JSON.stringify(currentData.personnel, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `efetivo_militar_hfa_backup_${format(new Date(), 'yyyy-MM-dd')}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
  };

  const handleExportSimplified = () => {
      const simplified = currentData.personnel.map(p => ({
          postoGraduacao: p.rank,
          nomeGuerra: p.warName,
          setor: p.sector || '',
          anoFormacao: p.formationYear || new Date().getFullYear()
      }));
      
      const dataStr = JSON.stringify(simplified, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `modelo_efetivo_simplificado_${format(new Date(), 'yyyy-MM-dd')}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
  };

  const toggleExemption = async (id: string, type: 'skipBlackScale' | 'skipRedScale' | 'bypassRiskWindow') => {
      const updatedPersonnel = currentData.personnel.map(p => {
          if (p.id === id) {
              const currentExemptions = p.exemptions || {};
              return {
                  ...p,
                  exemptions: {
                      ...currentExemptions,
                      [type]: !currentExemptions[type]
                  }
              };
          }
          return p;
      });

      const updatedData = { ...currentData, personnel: updatedPersonnel };
      setAppData(updatedData);

      const mil = updatedPersonnel.find(p => p.id === id);
      if (mil) {
        const status = mil.exemptions?.[type] ? 'ATIVADO' : 'DESATIVADO';
        const label =
          type === 'skipBlackScale'
            ? 'Isenção Escala Preta'
            : type === 'skipRedScale'
              ? 'Isenção Escala Vermelha'
              : 'Exceção de Janela de Risco';
        
        await logAuditAction({
            action: 'UPDATE_EXEMPTION',
            user_id: user?.username || 'unknown',
            details: `Regra especial para ${mil.warName}: ${label} = ${status}`
        });
      }
  };

  const toggleForceService = async (militaryId: string, serviceId: string) => {
      const updatedPersonnel = currentData.personnel.map(p => {
          if (p.id === militaryId) {
              const currentExemptions = p.exemptions || {};
              const currentForced = currentExemptions.forceAllowedServices || [];
              
              let newForced: string[];
              if (currentForced.includes(serviceId)) {
                  newForced = currentForced.filter(id => id !== serviceId);
              } else {
                  newForced = [...currentForced, serviceId];
              }

              return {
                  ...p,
                  exemptions: {
                      ...currentExemptions,
                      forceAllowedServices: newForced
                  }
              };
          }
          return p;
      });

      const updatedData = { ...currentData, personnel: updatedPersonnel };
      setAppData(updatedData);

      const mil = updatedPersonnel.find(p => p.id === militaryId);
      const svc = currentData.services.find(s => s.id === serviceId);
      
      if (mil && svc) {
          const isEnabled = mil.exemptions?.forceAllowedServices?.includes(serviceId);
          await logAuditAction({
            action: 'UPDATE_EXEMPTION_FORCE',
            user_id: user?.username || 'unknown',
            details: `Regra de Exclusividade/Antiguidade para ${mil.warName} no serviço ${svc.name}: ${isEnabled ? 'ATIVADO' : 'DESATIVADO'}`
          });
      }
  };

  const filteredExemptionList = currentData.personnel.filter(p => {
      if (!exemptionSearch) return false;
      const term = exemptionSearch.toLowerCase();
      return p.warName.toLowerCase().includes(term) || p.number.includes(term);
  }).slice(0, 5);

  return (
    <div className="space-y-8 animate-fade-in">
      {(success || error) && (
          <div className={`fixed top-4 right-4 z-[100] px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 border-l-8 animate-fade-in-up ${error ? 'bg-red-50 border-red-600 text-red-800' : 'bg-green-50 border-green-600 text-green-800'}`}>
              {error ? <AlertCircle className="w-6 h-6"/> : <CheckCircle className="w-6 h-6"/>}
              <div className="font-bold">{error || success}</div>
              <button onClick={() => {setError(""); setSuccess("");}} className="ml-4 opacity-50 hover:opacity-100"><X className="w-5 h-5"/></button>
          </div>
      )}

      {user?.role === 'DEV' && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center">
              <div className="bg-blue-100 p-3 rounded-xl mr-4">
                  <Database className="w-6 h-6 text-blue-700" />
              </div>
              <div>
                  <h2 className="text-xl font-bold text-gray-900">Sincronização em Nuvem</h2>
                  <p className="text-sm text-gray-500">Controle manual de envio e recebimento de dados.</p>
              </div>
            </div>
            
            <div className="flex gap-3 w-full md:w-auto">
                <button 
                  onClick={handleForceSync} 
                  disabled={loading} 
                  className="flex-1 md:flex-none px-4 py-3 bg-blue-50 text-blue-700 rounded-lg text-sm font-bold border border-blue-200 hover:bg-blue-100 flex items-center justify-center gap-2 transition-colors active:scale-95"
                >
                    {loading ? <RefreshCw className="w-4 h-4 animate-spin"/> : <CloudCheck className="w-4 h-4"/>} 
                    Forçar Envio (Upload)
                </button>
                <button 
                  onClick={handleForceLoad} 
                  disabled={loading} 
                  className="flex-1 md:flex-none px-4 py-3 bg-white text-gray-700 rounded-lg text-sm font-bold border border-gray-300 hover:bg-gray-50 flex items-center justify-center gap-2 transition-colors active:scale-95 shadow-sm"
                >
                    {loading ? <RefreshCw className="w-4 h-4 animate-spin"/> : <CloudOff className="w-4 h-4"/>} 
                    Forçar Carga (Download)
                </button>
            </div>
        </div>
      )}

      {isAdminOrDev && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 transition-all overflow-hidden">
              <div className="flex items-center p-6 border-b border-gray-100">
                  <div className="bg-orange-100 p-2 rounded-lg mr-3">
                      <ShieldAlert className="w-6 h-6 text-orange-700" />
                  </div>
                  <div>
                      <h2 className="text-xl font-bold text-gray-900">Regras de Exceção (Escala)</h2>
                      <p className="text-sm text-gray-500">Defina militares que não devem concorrer em escalas específicas.</p>
                  </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
                  <div className="p-6 bg-gray-50/50">
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Buscar Militar para Configurar</label>
                      <div className="relative mb-6">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input 
                              type="text" 
                              placeholder="Digite nome ou número..." 
                              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-orange-500 shadow-sm"
                              value={exemptionSearch}
                              onChange={e => {
                                  setExemptionSearch(e.target.value);
                                  setSelectedExemptionId(null);
                              }}
                          />
                          {filteredExemptionList.length > 0 && !selectedExemptionId && (
                              <div className="absolute top-full left-0 w-full bg-white border border-gray-200 shadow-lg rounded-b-lg mt-1 z-10 overflow-hidden">
                                  {filteredExemptionList.map(p => (
                                      <div 
                                          key={p.id} 
                                          className="p-3 hover:bg-orange-50 cursor-pointer flex justify-between items-center transition-colors"
                                          onClick={() => {
                                              setExemptionSearch(`${p.rank} ${p.warName}`);
                                              setSelectedExemptionId(p.id);
                                          }}
                                      >
                                          <span className="font-bold text-sm text-gray-800">{p.rank} {p.warName}</span>
                                          <span className="text-xs text-gray-500">{p.sector}</span>
                                      </div>
                                  ))}
                              </div>
                          )}
                      </div>

                      {selectedExemptionId ? (
                          <div className="bg-white p-4 rounded-xl border border-orange-200 shadow-sm animate-fade-in space-y-5">
                              {(() => {
                                  const mil = currentData.personnel.find(p => p.id === selectedExemptionId);
                                  if (!mil) return null;
                                  
                                  const restrictedServices = currentData.services.filter(s => s.maxFormationYear !== undefined);

                                  return (
                                      <>
                                          <div>
                                              <div className="flex items-center justify-between mb-3">
                                                  <h4 className="font-bold text-orange-800 text-sm uppercase flex items-center gap-2">
                                                      <Ban className="w-4 h-4"/> Bloqueios
                                                  </h4>
                                                  <span className="text-[10px] font-bold text-gray-400">{mil.rank} {mil.warName}</span>
                                              </div>
                                              
                                              <div className="space-y-3">
                                                  <label className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer hover:shadow-sm transition-all ${mil.exemptions?.skipBlackScale ? 'bg-orange-50 border-orange-300' : 'bg-gray-50 border-gray-200'}`}>
                                                      <div className="flex flex-col">
                                                          <span className="font-bold text-gray-800 text-xs">Escala Preta</span>
                                                          <span className="text-[10px] text-gray-500">Dias Úteis</span>
                                                      </div>
                                                      <div className="relative">
                                                          <input 
                                                              type="checkbox" 
                                                              className="sr-only peer" 
                                                              checked={mil.exemptions?.skipBlackScale || false}
                                                              onChange={() => toggleExemption(mil.id, 'skipBlackScale')}
                                                          />
                                                          <div className="w-8 h-4 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-orange-600"></div>
                                                      </div>
                                                  </label>

                                                  <label className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer hover:shadow-sm transition-all ${mil.exemptions?.skipRedScale ? 'bg-red-50 border-red-300' : 'bg-gray-50 border-gray-200'}`}>
                                                      <div className="flex flex-col">
                                                          <span className="font-bold text-gray-800 text-xs">Escala Vermelha</span>
                                                          <span className="text-[10px] text-gray-500">FDS e Feriados</span>
                                                      </div>
                                                      <div className="relative">
                                                          <input 
                                                              type="checkbox" 
                                                              className="sr-only peer" 
                                                              checked={mil.exemptions?.skipRedScale || false}
                                                              onChange={() => toggleExemption(mil.id, 'skipRedScale')}
                                                          />
                                                          <div className="w-8 h-4 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-red-600"></div>
                                                      </div>
                                                  </label>

                                                  <label className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer hover:shadow-sm transition-all ${mil.exemptions?.bypassRiskWindow ? 'bg-purple-50 border-purple-300' : 'bg-gray-50 border-gray-200'}`}>
                                                      <div className="flex flex-col">
                                                          <span className="font-bold text-gray-800 text-xs">Bypass Janela de Risco</span>
                                                          <span className="text-[10px] text-gray-500">Permite escalar sem descanso mínimo</span>
                                                      </div>
                                                      <div className="relative">
                                                          <input
                                                              type="checkbox"
                                                              className="sr-only peer"
                                                              checked={mil.exemptions?.bypassRiskWindow || false}
                                                              onChange={() => toggleExemption(mil.id, 'bypassRiskWindow')}
                                                          />
                                                          <div className="w-8 h-4 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-purple-600"></div>
                                                      </div>
                                                  </label>
                                              </div>
                                          </div>

                                          {restrictedServices.length > 0 && (
                                            <div>
                                                <h4 className="font-bold text-blue-800 mb-3 text-sm uppercase flex items-center gap-2 pt-4 border-t border-dashed border-gray-200">
                                                    <Star className="w-4 h-4"/> Permissões Especiais
                                                </h4>
                                                
                                                <div className="space-y-2">
                                                    {restrictedServices.map(svc => {
                                                        const isForced = mil.exemptions?.forceAllowedServices?.includes(svc.id) || false;
                                                        return (
                                                            <label key={svc.id} className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer hover:shadow-sm transition-all ${isForced ? 'bg-blue-50 border-blue-300' : 'bg-gray-50 border-gray-200'}`}>
                                                                <div className="flex flex-col">
                                                                    <span className="font-bold text-gray-800 text-xs">{svc.name}</span>
                                                                    <span className="text-[10px] text-gray-500 truncate max-w-[150px]">Ignorar regra de ano</span>
                                                                </div>
                                                                <div className="relative">
                                                                    <input 
                                                                        type="checkbox" 
                                                                        className="sr-only peer" 
                                                                        checked={isForced}
                                                                        onChange={() => toggleForceService(mil.id, svc.id)}
                                                                    />
                                                                    <div className="w-8 h-4 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600"></div>
                                                                </div>
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                          )}
                                      </>
                                  );
                              })()}
                          </div>
                      ) : (
                          <div className="text-center py-10 text-gray-400 bg-white border border-dashed border-gray-200 rounded-xl">
                              <Search className="w-10 h-10 mx-auto mb-2 opacity-20"/>
                              <p className="text-xs">Selecione um militar acima para editar.</p>
                          </div>
                      )}
                  </div>

                  <div className="lg:col-span-2 p-6 h-full flex flex-col">
                      <h3 className="font-bold text-lg text-gray-800 mb-4 flex items-center gap-2">
                          Militares com Exceções Ativas 
                          <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">{personnelWithExemptions.length}</span>
                      </h3>
                      
                      <div className="flex-1 overflow-y-auto max-h-[500px] pr-2 space-y-3">
                          {personnelWithExemptions.length === 0 ? (
                              <div className="flex flex-col items-center justify-center h-40 text-gray-400 border-2 border-dashed border-gray-100 rounded-xl">
                                  <ShieldAlert className="w-10 h-10 mb-2 opacity-20" />
                                  <p className="text-sm">Nenhuma regra de exceção cadastrada.</p>
                              </div>
                          ) : (
                              personnelWithExemptions.map(mil => {
                                  const forcedNames = mil.exemptions?.forceAllowedServices?.map(id => {
                                      return currentData.services.find(s => s.id === id)?.name || id;
                                  });

                                  return (
                                      <div 
                                          key={mil.id} 
                                          onClick={() => {
                                              setExemptionSearch(`${mil.rank} ${mil.warName}`);
                                              setSelectedExemptionId(mil.id);
                                          }}
                                          className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-white border border-gray-200 rounded-lg hover:border-orange-300 hover:shadow-md transition-all cursor-pointer"
                                      >
                                          <div className="flex items-center gap-3 mb-2 sm:mb-0">
                                              <div className="bg-gray-100 p-2 rounded-full text-gray-600 font-bold text-xs w-10 h-10 flex items-center justify-center shrink-0">
                                                  {mil.rank === Rank.CB ? 'CB' : 'SD'}
                                              </div>
                                              <div>
                                                  <div className="font-bold text-gray-800 group-hover:text-orange-700 transition-colors">
                                                      {mil.warName} <span className="text-gray-400 font-normal text-xs ml-1">({mil.number})</span>
                                                  </div>
                                                  <div className="text-xs text-gray-500">{mil.sector || 'Sem setor'}</div>
                                              </div>
                                          </div>

                                          <div className="flex flex-wrap gap-2 sm:justify-end">
                                              {mil.exemptions?.skipBlackScale && (
                                                  <span className="px-2 py-1 bg-orange-50 text-orange-700 text-[10px] font-bold uppercase rounded border border-orange-200 flex items-center gap-1">
                                                      <Ban className="w-3 h-3"/> Escala Preta
                                                  </span>
                                              )}
                                              {mil.exemptions?.skipRedScale && (
                                                  <span className="px-2 py-1 bg-red-50 text-red-700 text-[10px] font-bold uppercase rounded border border-red-200 flex items-center gap-1">
                                                      <Ban className="w-3 h-3"/> Escala Vermelha
                                                  </span>
                                              )}
                                              {mil.exemptions?.bypassRiskWindow && (
                                                  <span className="px-2 py-1 bg-purple-50 text-purple-700 text-[10px] font-bold uppercase rounded border border-purple-200 flex items-center gap-1">
                                                      <Unlock className="w-3 h-3"/> Bypass Janela
                                                  </span>
                                              )}
                                              {forcedNames && forcedNames.length > 0 && forcedNames.map(name => (
                                                  <span key={name} className="px-2 py-1 bg-blue-50 text-blue-700 text-[10px] font-bold uppercase rounded border border-blue-200 flex items-center gap-1">
                                                      <Star className="w-3 h-3"/> {name}
                                                  </span>
                                              ))}
                                          </div>
                                      </div>
                                  );
                              })
                          )}
                      </div>
                  </div>
              </div>
          </div>
      )}

      <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center mb-6 pb-4 border-b border-gray-100">
            <div className="bg-purple-100 p-2 rounded-lg mr-3">
                <FileJson className="w-6 h-6 text-purple-700" />
            </div>
            <div>
                <h2 className="text-2xl font-bold text-gray-900">Gestão de Dados do Efetivo</h2>
                <p className="text-sm text-gray-500">Importação e Exportação de militares em lote</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-6 bg-gray-50 rounded-xl border border-gray-200 hover:shadow-md transition-shadow">
                  <h3 className="font-bold text-gray-800 mb-2 flex items-center gap-2"><PlusCircle className="w-5 h-5 text-military-600"/> Inserir Militares</h3>
                  <p className="text-xs text-gray-500 mb-4">Adicione múltiplos militares de uma vez colando um JSON estruturado.</p>
                  <button 
                    onClick={() => setShowImport(true)}
                    className="w-full py-3 bg-military-600 text-white rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-military-700 transition-all shadow-sm active:scale-95"
                  >
                      <FileJson className="w-4 h-4" /> Abrir Terminal de Importação
                  </button>
              </div>

              <div className="p-6 bg-gray-50 rounded-xl border border-gray-200 hover:shadow-md transition-shadow">
                  <h3 className="font-bold text-gray-800 mb-2 flex items-center gap-2"><Download className="w-5 h-5 text-blue-600"/> Exportação de Dados</h3>
                  <p className="text-xs text-gray-500 mb-4">Gere arquivos JSON para backup ou edição externa.</p>
                  <div className="flex flex-col gap-2">
                    <button 
                      onClick={handleExportPersonnel}
                      className="w-full py-2 bg-white border border-blue-200 text-blue-700 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-blue-50 transition-all shadow-sm active:scale-95 text-xs"
                    >
                        <Download className="w-4 h-4" /> Backup Completo (Sistema)
                    </button>
                    <button 
                      onClick={handleExportSimplified}
                      className="w-full py-2 bg-blue-600 text-white border border-blue-600 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-sm active:scale-95 text-xs"
                    >
                        <FileText className="w-4 h-4" /> Modelo Simplificado (Edição)
                    </button>
                  </div>
              </div>
          </div>
      </div>

      {showImport && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-military-900/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] animate-scale-in">
            <div className="bg-military-900 p-5 flex justify-between items-center">
              <div>
                  <h3 className="text-white font-bold text-xl flex items-center gap-2"><FileJson className="w-6 h-6 text-military-300" /> Importação de Efetivo Militar</h3>
                  <p className="text-military-400 text-xs">A estrutura deve ser uma lista de objetos JSON.</p>
              </div>
              <button onClick={() => setShowImport(false)} className="text-military-400 hover:text-white transition-colors p-2"><X className="w-8 h-8" /></button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto">
              {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-xs border border-red-200">{error}</div>}
              <textarea 
                className="w-full h-80 p-4 bg-gray-900 text-green-400 border border-gray-700 rounded-xl font-mono text-xs focus:ring-2 focus:ring-military-500 outline-none placeholder-gray-600 shadow-inner"
                placeholder='[{"postoGraduacao": "Cb", "nomeGuerra": "ANDRÉ", "numero": "1234", "anoFormacao": 2020}, ...]'
                value={importJson}
                onChange={e => setImportJson(e.target.value)}
              />
            </div>
            <div className="bg-gray-50 p-6 border-t flex justify-end gap-3">
              <button onClick={() => setShowImport(false)} className="px-6 py-2 text-gray-600 font-bold hover:bg-gray-200 rounded-lg transition-colors">Cancelar</button>
              <button 
                onClick={handleBulkImport} 
                disabled={!importJson.trim()}
                className={`px-8 py-2 bg-military-600 text-white rounded-lg font-bold shadow-lg transition-all active:scale-95 ${!importJson.trim() ? 'opacity-50 grayscale cursor-not-allowed' : 'hover:bg-military-700'}`}
              >
                Confirmar Importação
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DatabaseConfig;
