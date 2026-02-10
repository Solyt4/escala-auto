import React, { useState } from 'react';
import { ServiceType, SectorRule, Rank } from '../types';
import { RANKS_LIST } from '../constants';
import { useAppStore } from '../store/useAppStore';
import { logAuditAction } from '../services/db';
import { 
  Briefcase, X, AlertTriangle, Shield, CheckCircle2, HelpCircle, 
  Clock, PlusCircle, Edit, Trash2, Book, Ban, CalendarDays 
} from 'lucide-react';

const ServiceManager: React.FC = () => {
  const { data, user, setAppData } = useAppStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState<Partial<ServiceType>>({ allowedRanks: [], is24h: true, quantity: 1, isBlackScaleOnly: false });
  const [sectorRuleForm, setSectorRuleForm] = useState<Partial<SectorRule>>({ sectorName: '', allowedServiceIds: [] });
  
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    isDestructive?: boolean;
    onConfirm: () => void;
  } | null>(null);
  
  const currentUser = user!;

  const servicesForRules = [
      ...data.services,
      ...(data.services.some(s => s.id === 'apoio') ? [] : [{
          id: 'apoio',
          name: 'Apoio / Missões',
          allowedRanks: [],
          quantity: 0,
          is24h: false,
          isBlackScaleOnly: true
      } as ServiceType])
  ];

  const handleCreate = () => { 
    setEditingId('NEW'); 
    setError(''); 
    setForm({ id: '', name: '', allowedRanks: [], is24h: true, quantity: 1, redScaleQuantity: undefined, startTime: '', endTime: '', maxFormationYear: undefined, isBlackScaleOnly: false }); 
  };
  
  const startEdit = (service: ServiceType) => { 
    setEditingId(service.id); 
    setError(''); 
    setForm({ ...service }); 
  };
  
  const handleDeleteClick = (service: ServiceType) => {
      setModalConfig({
          isOpen: true,
          title: "Excluir Serviço",
          message: (
              <span>
                  Tem certeza que deseja excluir o serviço <strong>{service.name}</strong>?
                  <br/><br/>
                  Esta ação removerá o serviço da lista de opções para geração futura. Escalas passadas não serão alteradas, mas regras de setor vinculadas a este serviço podem ser afetadas.
              </span>
          ),
          isDestructive: true,
          onConfirm: () => executeDelete(service.id, service.name)
      });
  };

  const executeDelete = async (id: string, name: string) => { 
    setModalConfig(null);
    
    setAppData({ ...data, services: data.services.filter(s => s.id !== id) }); 

    await logAuditAction({
      action: 'DELETE_SERVICE',
      user_id: currentUser.username,
      deleted_item_id: id,
      deleted_item_type: 'SERVICE',
      details: `Excluído tipo de serviço: ${name}`
    });
  };
  
  const handleSave = async () => { 
    if (!form.name?.trim()) { setError("O nome é obrigatório."); return; } 
    if (!form.allowedRanks?.length) { setError("Selecione os postos."); return; } 

    if (form.maxFormationYear !== undefined && form.maxFormationYear !== null) {
      const currentYear = new Date().getFullYear();
      if (form.maxFormationYear < 1900 || form.maxFormationYear > currentYear + 1) {
        setError(`O ano de formação limite deve estar entre 1900 e ${currentYear + 1}.`);
        return;
      }
    }

    let updatedList = [...data.services]; 
    if (editingId === 'NEW') { 
        updatedList.push({ 
            ...form, 
            id: `svc_${Math.random().toString(36).substr(2, 5)}`, 
            allowedRanks: form.allowedRanks!, 
            name: form.name!, 
            quantity: form.quantity || 1, 
            redScaleQuantity: form.redScaleQuantity,
            is24h: form.is24h || false,
            isBlackScaleOnly: form.isBlackScaleOnly || false
        } as ServiceType); 
    } else { 
        updatedList = updatedList.map(s => s.id === editingId ? { ...form, id: editingId } as ServiceType : s); 
    } 
    setAppData({ ...data, services: updatedList }); 
    setEditingId(null); 

    await logAuditAction({
        action: editingId === 'NEW' ? 'CREATE_SERVICE' : 'UPDATE_SERVICE',
        user_id: currentUser.username,
        details: `${editingId === 'NEW' ? 'Criado' : 'Editado'} serviço: ${form.name}`
    });
  };
  
  const toggleRank = (rank: Rank) => { 
    const current = form.allowedRanks || []; 
    if (current.includes(rank)) setForm({ ...form, allowedRanks: current.filter(r => r !== rank) }); 
    else setForm({ ...form, allowedRanks: [...current, rank] }); 
  };

  const handleAddSectorRule = async () => {
      if (!sectorRuleForm.sectorName?.trim()) {
          alert("Digite o nome do setor.");
          return;
      }
      
      const newRule: SectorRule = {
          id: `rule_${Math.random().toString(36).substr(2, 6)}`,
          sectorName: sectorRuleForm.sectorName.trim(),
          allowedServiceIds: sectorRuleForm.allowedServiceIds || []
      };

      const currentRules = data.sectorRules || [];
      const filteredRules = currentRules.filter(r => r.sectorName.toLowerCase() !== newRule.sectorName.toLowerCase());
      
      setAppData({ ...data, sectorRules: [...filteredRules, newRule] });
      setSectorRuleForm({ sectorName: '', allowedServiceIds: [] });

      await logAuditAction({
          action: 'ADD_SECTOR_RULE',
          user_id: currentUser.username,
          details: `Nova regra de setor adicionada: ${newRule.sectorName}`
      });
  };

  const handleDeleteRule = async (id: string) => {
      const ruleName = data.sectorRules?.find(r => r.id === id)?.sectorName || 'Desconhecida';
      const currentRules = data.sectorRules || [];
      
      setAppData({ ...data, sectorRules: currentRules.filter(r => r.id !== id) });

      await logAuditAction({
          action: 'DELETE_SECTOR_RULE',
          user_id: currentUser.username,
          deleted_item_id: id,
          deleted_item_type: 'SECTOR_RULE',
          details: `Regra de setor excluída: ${ruleName}`
      });
  };

  const toggleAllowedService = (serviceId: string) => {
      const current = sectorRuleForm.allowedServiceIds || [];
      if (current.includes(serviceId)) {
          setSectorRuleForm({ ...sectorRuleForm, allowedServiceIds: current.filter(id => id !== serviceId) });
      } else {
          setSectorRuleForm({ ...sectorRuleForm, allowedServiceIds: [...current, serviceId] });
      }
  };
  
  const setAllServicesDisabled = () => {
      setSectorRuleForm({ ...sectorRuleForm, allowedServiceIds: [] });
  };

  return (
    <div className="space-y-10 animate-fade-in relative">
      
      {modalConfig && modalConfig.isOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col transform transition-all animate-scale-in">
                <div className={`${modalConfig.isDestructive ? 'bg-red-600' : 'bg-military-600'} p-4 flex justify-between items-center text-white`}>
                    <h3 className="font-bold text-lg flex items-center">
                        <AlertTriangle className="w-6 h-6 mr-2 fill-current" /> 
                        {modalConfig.title}
                    </h3>
                    <button onClick={() => setModalConfig(null)} className="text-white/80 hover:text-white"><X className="w-6 h-6"/></button>
                </div>
                <div className="p-6">
                    <div className="text-gray-700 text-sm">{modalConfig.message}</div>
                </div>
                <div className="bg-gray-50 p-4 border-t border-gray-100 flex justify-end gap-3">
                    <button onClick={() => setModalConfig(null)} className="px-4 py-2 text-gray-600 font-bold hover:bg-gray-200 rounded-lg transition-colors">Cancelar</button>
                    <button 
                        onClick={modalConfig.onConfirm} 
                        className={`px-6 py-2 text-white font-bold rounded-lg shadow-md transition-colors ${modalConfig.isDestructive ? 'bg-red-600 hover:bg-red-700' : 'bg-military-600 hover:bg-military-700'}`}
                    >
                        Confirmar
                    </button>
                </div>
            </div>
        </div>
      )}

      {editingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-scale-in">
            <div className="bg-military-900 p-4 flex justify-between items-center"><h3 className="text-white font-bold text-lg flex items-center"><Briefcase className="w-5 h-5 mr-2" /> {editingId === 'NEW' ? 'Novo Serviço' : 'Editar Serviço'}</h3><button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-white"><X className="w-6 h-6" /></button></div>
            <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
              {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm border border-red-200 animate-pulse flex items-center"><AlertTriangle className="w-4 h-4 mr-2"/> {error}</div>}
              
              <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome do Serviço</label>
                  <input type="text" className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-military-500 outline-none transition-all" placeholder="Ex: Auxiliar de Dia" value={form.name || ''} onChange={e => setForm({...form, name: e.target.value})} />
              </div>

              <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2 flex items-center">
                    <Shield className="w-3 h-3 mr-1" /> Postos Permitidos
                  </label>
                  <div className="flex gap-3">
                      {RANKS_LIST.map(r => {
                          const isSelected = form.allowedRanks?.includes(r);
                          return (
                              <button 
                                  key={r} 
                                  onClick={() => toggleRank(r)} 
                                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold border transition-all flex items-center justify-center gap-2
                                    ${isSelected ? 'bg-military-600 text-white border-military-700 shadow-md transform scale-105' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
                              >
                                  {isSelected && <CheckCircle2 className="w-3 h-3" />}
                                  {r}
                              </button>
                          )
                      })}
                  </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Qtd. Vagas (Dias Úteis)</label>
                    <input type="number" className="w-full p-2 border border-gray-300 rounded bg-white focus:ring-2 focus:ring-military-500" value={form.quantity} onChange={e => setForm({...form, quantity: parseInt(e.target.value) || 1})} />
                </div>
                <div>
                    <label className="block text-xs font-bold text-red-500 uppercase mb-1">Qtd. Vagas (FDS/Feriado)</label>
                    <input 
                      type="number" 
                      className="w-full p-2 border border-gray-300 rounded bg-white focus:ring-2 focus:ring-military-500 placeholder-gray-300" 
                      placeholder="Padrão" 
                      value={form.redScaleQuantity === undefined ? '' : form.redScaleQuantity} 
                      onChange={e => setForm({...form, redScaleQuantity: e.target.value === '' ? undefined : parseInt(e.target.value)})} 
                    />
                    <span className="text-[10px] text-gray-400">Deixe em branco para usar o mesmo valor.</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                 <div>
                    <div className="flex items-center gap-1 mb-1 group relative w-fit">
                        <label className="text-xs font-bold text-gray-500 uppercase cursor-help">Ano Formação Limite</label>
                        <HelpCircle className="w-3 h-3 text-gray-400" />
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-gray-800 text-white text-[10px] p-2 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 text-center leading-tight">
                            Define a antiguidade máxima. Apenas militares formados neste ano ou antes poderão concorrer.
                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800"></div>
                        </div>
                    </div>
                    <input 
                      type="number" 
                      className="w-full p-2 border border-gray-300 rounded bg-white focus:ring-2 focus:ring-military-500 placeholder-gray-300" 
                      placeholder="Opcional (Ex: 2022)" 
                      value={form.maxFormationYear === undefined ? '' : form.maxFormationYear} 
                      onChange={e => setForm({...form, maxFormationYear: e.target.value === '' ? undefined : parseInt(e.target.value)})} 
                    />
                </div>
              </div>

              <div className="border border-gray-200 rounded-xl p-4 space-y-4">
                  <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                          <div className="p-1.5 bg-blue-100 rounded-lg text-blue-700">
                              <Clock className="w-4 h-4" />
                          </div>
                          <span className="text-sm font-bold text-gray-700">Regime de Horário</span>
                      </div>
                      <label className="flex items-center space-x-2 cursor-pointer">
                          <div className="relative">
                              <input type="checkbox" checked={form.is24h} onChange={e => setForm({...form, is24h: e.target.checked})} className="peer sr-only" />
                              <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                          </div>
                          <span className="text-xs font-bold text-gray-600">{form.is24h ? 'Plantão 24h' : 'Horário Definido'}</span>
                      </label>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                      <div className="flex items-center gap-2">
                          <div className="p-1.5 bg-gray-100 rounded-lg text-gray-700">
                              <CalendarDays className="w-4 h-4" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-gray-700">Dias de Funcionamento</span>
                            <span className="text-[10px] text-gray-400">Escala Preta x Escala Vermelha</span>
                          </div>
                      </div>
                      <label className="flex items-center space-x-2 cursor-pointer">
                          <div className="relative">
                              <input type="checkbox" checked={form.isBlackScaleOnly} onChange={e => setForm({...form, isBlackScaleOnly: e.target.checked})} className="peer sr-only" />
                              <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-gray-400 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-gray-800"></div>
                          </div>
                          <span className="text-xs font-bold text-gray-600">{form.isBlackScaleOnly ? 'Apenas Dias Úteis' : 'Todos os Dias'}</span>
                      </label>
                  </div>
                  
                  {!form.is24h && (
                      <div className="grid grid-cols-2 gap-4 animate-fade-in pt-2 border-t border-gray-100">
                          <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Início do Turno</label><input type="time" className="w-full p-2 border border-gray-300 rounded bg-white text-sm" value={form.startTime || ''} onChange={e => setForm({...form, startTime: e.target.value})} /></div>
                          <div><label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Fim do Turno</label><input type="time" className="w-full p-2 border border-gray-300 rounded bg-white text-sm" value={form.endTime || ''} onChange={e => setForm({...form, endTime: e.target.value})} /></div>
                      </div>
                  )}
              </div>

            </div>
            <div className="bg-gray-50 p-4 border-t flex justify-end gap-3"><button onClick={() => setEditingId(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg font-medium transition-colors">Cancelar</button><button onClick={handleSave} className="px-6 py-2 bg-military-600 text-white rounded-lg font-bold shadow-md hover:bg-military-700 transition-colors">Salvar Alterações</button></div>
          </div>
        </div>
      )}
      
      <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
        <div className="flex justify-between items-center mb-6"><div><h3 className="text-xl font-bold text-gray-900">Gerenciar Serviços</h3><p className="text-sm text-gray-500">Defina os tipos de escala.</p></div><button onClick={handleCreate} className="bg-military-600 text-white px-4 py-2 rounded-lg font-bold flex items-center"><PlusCircle className="w-5 h-5 mr-2" /> Novo Serviço</button></div>
        <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200"><thead className="bg-gray-100"><tr><th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase">Nome</th><th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase">Postos</th><th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase">Vagas/Antiguidade</th><th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase">Regime</th><th className="px-6 py-4 text-right text-xs font-bold text-gray-600 uppercase">Ações</th></tr></thead><tbody className="bg-white divide-y divide-gray-200">{data.services.map(s => (<tr key={s.id} className="hover:bg-gray-50 group"><td className="px-6 py-4 whitespace-nowrap font-bold text-gray-800">{s.name}</td><td className="px-6 py-4 whitespace-nowrap"><div className="flex gap-1">{s.allowedRanks.map(r => (<span key={r} className="text-xs bg-gray-100 px-2 py-0.5 rounded">{r}</span>))}</div></td><td className="px-6 py-4 whitespace-nowrap"><div className="flex flex-col"><span className="text-xs font-bold text-gray-700">{s.quantity} vagas {s.redScaleQuantity ? `(${s.redScaleQuantity} FDS)` : ''}</span>{s.maxFormationYear && <span className="text-[10px] text-military-600 font-bold uppercase">Form. ≤ {s.maxFormationYear}</span>}</div></td><td className="px-6 py-4 whitespace-nowrap text-sm"><div className="flex flex-col"><span className="font-bold text-gray-700">{s.is24h ? '24 HORAS' : `${s.startTime}-${s.endTime}`}</span><span className="text-[10px] text-gray-400">{s.isBlackScaleOnly ? 'APENAS DIAS ÚTEIS' : 'TODOS OS DIAS'}</span></div></td><td className="px-6 py-4 whitespace-nowrap text-right space-x-2"><button onClick={() => startEdit(s)} className="text-blue-500"><Edit className="w-4 h-4" /></button><button onClick={() => handleDeleteClick(s)} className="text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-4 h-4" /></button></td></tr>))}</tbody></table></div>
      </div>

      <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
          <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-100">
              <div>
                  <h3 className="text-xl font-bold text-gray-900 flex items-center"><Book className="w-6 h-6 mr-2 text-military-600" /> Regras de Setores</h3>
                  <p className="text-sm text-gray-500">Restrinja quais serviços determinados setores podem tirar (ex: Apenas Apoio).</p>
              </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="bg-gray-50 p-6 rounded-xl border border-gray-200 h-fit">
                  <h4 className="font-bold text-gray-700 mb-4 text-sm uppercase">Adicionar Regra</h4>
                  <div className="space-y-4">
                      <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome do Setor (Exato)</label>
                          <input 
                              type="text" 
                              value={sectorRuleForm.sectorName} 
                              onChange={e => setSectorRuleForm({ ...sectorRuleForm, sectorName: e.target.value })}
                              placeholder="Ex: Transporte"
                              className="w-full p-2 border border-gray-300 rounded bg-white focus:ring-2 focus:ring-military-500"
                          />
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Serviços PERMITIDOS</label>
                          <label className="flex items-center space-x-2 cursor-pointer p-2 bg-red-50 hover:bg-red-100 rounded border border-red-100 mb-2 transition-colors">
                              <input 
                                  type="checkbox" 
                                  checked={!sectorRuleForm.allowedServiceIds || sectorRuleForm.allowedServiceIds.length === 0}
                                  onChange={setAllServicesDisabled}
                                  className="text-red-600 focus:ring-red-500 rounded"
                              />
                              <span className="text-sm font-bold text-red-800 flex items-center gap-2"><Ban className="w-4 h-4"/> NENHUM (Dispensar Setor)</span>
                          </label>
                          
                          <div className="space-y-2 max-h-48 overflow-y-auto bg-white p-2 border rounded">
                              {servicesForRules.map(s => (
                                  <label key={s.id} className="flex items-center space-x-2 cursor-pointer p-1 hover:bg-gray-50 rounded">
                                      <input 
                                          type="checkbox" 
                                          checked={sectorRuleForm.allowedServiceIds?.includes(s.id) || false}
                                          onChange={() => toggleAllowedService(s.id)}
                                          className="text-military-600 focus:ring-military-500 rounded"
                                      />
                                      <span className="text-sm text-gray-700">{s.name}</span>
                                  </label>
                              ))}
                          </div>
                          <p className="text-[10px] text-gray-400 mt-1">* Militares deste setor SÓ poderão ser escalados nestes serviços.</p>
                      </div>
                      <button 
                          onClick={handleAddSectorRule}
                          className="w-full py-2 bg-military-600 text-white rounded-lg font-bold hover:bg-military-700 shadow-sm transition-all active:scale-95"
                      >
                          Salvar Regra
                      </button>
                  </div>
              </div>

              <div className="lg:col-span-2">
                  {(!data.sectorRules || data.sectorRules.length === 0) ? (
                      <div className="flex flex-col items-center justify-center h-full py-10 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
                          <Book className="w-10 h-10 mb-2 opacity-20" />
                          <p>Nenhuma regra de setor definida.</p>
                      </div>
                  ) : (
                      <div className="grid gap-4">
                          {data.sectorRules.map(rule => (
                              <div key={rule.id} className="flex justify-between items-center p-4 bg-white border border-gray-200 rounded-lg hover:shadow-sm transition-shadow">
                                  <div>
                                      <h5 className="font-bold text-military-800 text-lg">{rule.sectorName}</h5>
                                      <div className="flex flex-wrap gap-2 mt-2">
                                          {rule.allowedServiceIds.length === 0 ? (
                                              <span className="px-3 py-1 bg-red-100 text-red-800 text-xs rounded-full font-bold border border-red-200 flex items-center gap-1">
                                                  <Ban className="w-3 h-3"/> DISPENSADO GERAL
                                              </span>
                                          ) : (
                                              rule.allowedServiceIds.map(sid => {
                                                  const sName = servicesForRules.find(s => s.id === sid)?.name || sid;
                                                  return <span key={sid} className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full font-bold">{sName}</span>
                                              })
                                          )}
                                      </div>
                                  </div>
                                  <button onClick={() => handleDeleteRule(rule.id)} className="text-gray-400 hover:text-red-500 p-2">
                                      <Trash2 className="w-5 h-5" />
                                  </button>
                              </div>
                          ))}
                      </div>
                  )}
              </div>
          </div>
      </div>
    </div>
  );
};

export default ServiceManager;