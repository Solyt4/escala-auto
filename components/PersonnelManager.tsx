import React, { useState } from 'react';
import { Military, Rank, MilitaryStatus } from '../types';
import { RANKS_LIST } from '../constants';
import { useAppStore } from '../store/useAppStore';
import { logAuditAction } from '../services/db';
import { parseISO } from '../utils/helpers';
import { format, addDays } from 'date-fns';
import { 
  AlertTriangle, CheckCircle2, Edit, X, PlusCircle, Check, 
  Filter, Search, Trash2, Save 
} from 'lucide-react';

const PersonnelManager: React.FC = () => {
  const { data, user, setAppData } = useAppStore();
  const [newSoldier, setNewSoldier] = useState<Partial<Military>>({ rank: Rank.SD_EV, eligibleServices: [], status: 'ATIVO' });
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('TODOS');
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Military>>({});
  
  const [sickLeaveId, setSickLeaveId] = useState<string | null>(null);
  const [sickDaysInput, setSickDaysInput] = useState<string>('');
  
  const [vacationId, setVacationId] = useState<string | null>(null);
  const [vacationDaysInput, setVacationDaysInput] = useState<string>('');

  const [excusedId, setExcusedId] = useState<string | null>(null);
  const [excusedDaysInput, setExcusedDaysInput] = useState<string>('');

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    onConfirm: () => void;
  } | null>(null);

  const currentUser = user!;
  const canManage = ['ADMIN', 'DEV', 'ESCALANTE'].includes(currentUser.role) || currentUser.username === 'rsilva';

  const handleAdd = async () => {
    if (!newSoldier.warName || !newSoldier.number) {
        setError("Preencha Nome e Número do militar.");
        return;
    }
    setError("");
    const soldier: Military = {
      id: `mil_${Math.random().toString(36).substr(2, 9)}`,
      number: newSoldier.number,
      warName: newSoldier.warName,
      rank: newSoldier.rank as Rank,
      sector: newSoldier.sector,
      status: newSoldier.status || 'ATIVO',
      eligibleServices: newSoldier.eligibleServices || [],
      history: [],
      unavailableDates: [],
      totalServices: 0,
      formationYear: new Date().getFullYear()
    } as Military;
    
    setAppData({ ...data, personnel: [...data.personnel, soldier] });
    setNewSoldier({ rank: Rank.SD_EV, eligibleServices: [], number: '', warName: '', sector: '', status: 'ATIVO' });
    
    await logAuditAction({
      action: 'ADD_MILITARY',
      user_id: currentUser.username,
      details: `Novo militar cadastrado: ${soldier.rank} ${soldier.warName}`
    });

    setSuccess("Militar adicionado com sucesso.");
    setTimeout(() => setSuccess(""), 3000);
  };

  const handleDeleteClick = (military: Military) => {
    setModalConfig({
        isOpen: true,
        title: "Excluir Militar",
        message: (
            <span>
                Tem certeza que deseja excluir o militar <strong>{military.rank} {military.warName}</strong> ({military.number})?
                <br/><br/>
                Esta ação é irreversível e removerá o militar do efetivo e de todas as escalas futuras.
            </span>
        ),
        onConfirm: () => removePersonnel(military.id)
    });
  };

  const removePersonnel = async (id: string) => {
    setModalConfig(null);
    const military = data.personnel.find(p => p.id === id);
    if (!military) return;

    await logAuditAction({
      action: 'DELETE_MILITARY',
      user_id: currentUser.username,
      deleted_item_id: id,
      deleted_item_type: 'MILITARY',
      details: `Excluído militar: ${military.rank} ${military.warName} (${military.number})`
    });

    const updatedPersonnel = data.personnel.filter(p => p.id !== id);
    const updatedScale = data.scale.filter(s => s.militaryId !== id);
    setAppData({ ...data, personnel: updatedPersonnel, scale: updatedScale });
    
    setSuccess("Militar excluído com sucesso.");
    setTimeout(() => setSuccess(""), 3000);
  };

  const handleStatusChange = (id: string, newStatus: MilitaryStatus) => {
    if (newStatus === 'BAIXADO') {
      setSickLeaveId(id);
      setSickDaysInput('');
      setVacationId(null);
      setExcusedId(null);
    } else if (newStatus === 'FERIAS') {
      setVacationId(id);
      setVacationDaysInput('');
      setSickLeaveId(null);
      setExcusedId(null);
    } else if (newStatus === 'DISPENSADO') {
      setExcusedId(id);
      setExcusedDaysInput('');
      setSickLeaveId(null);
      setVacationId(null);
    } else {
      setSickLeaveId(null);
      setVacationId(null);
      setExcusedId(null);
      updateStatusRecursive(id, newStatus);
    }
  };

  const confirmSickLeave = async (id: string) => {
      const days = parseInt(sickDaysInput);
      if (!days || days <= 0) {
          alert("Informe a quantidade de dias.");
          return;
      }
      const today = new Date();
      const startDateStr = format(today, 'yyyy-MM-dd');
      const datesToBlock = Array.from({ length: days }, (_, i) => format(addDays(today, i), 'yyyy-MM-dd'));
      const military = data.personnel.find(p => p.id === id);

      const updatedPersonnel = data.personnel.map(p => {
          if (p.id === id) {
              return {
                  ...p,
                  status: 'BAIXADO' as MilitaryStatus,
                  medicalLeaveData: { startDate: startDateStr, days },
                  unavailableDates: Array.from(new Set([...p.unavailableDates, ...datesToBlock]))
              };
          }
          return p;
      });
      setAppData({ ...data, personnel: updatedPersonnel });
      setSickLeaveId(null);
      if (military) {
        await logAuditAction({
            action: 'UPDATE_STATUS_SICK',
            user_id: currentUser.username,
            details: `Lançada BAIXA MÉDICA de ${days} dias para ${military.warName}`
        });
      }
  };
  
  const confirmVacation = async (id: string) => {
      const days = parseInt(vacationDaysInput);
      if (!days || days <= 0) {
          alert("Informe a quantidade de dias.");
          return;
      }
      const today = new Date();
      const startDateStr = format(today, 'yyyy-MM-dd');
      const datesToBlock = Array.from({ length: days }, (_, i) => format(addDays(today, i), 'yyyy-MM-dd'));
      const military = data.personnel.find(p => p.id === id);

      const updatedPersonnel = data.personnel.map(p => {
          if (p.id === id) {
              return {
                  ...p,
                  status: 'FERIAS' as MilitaryStatus,
                  vacationData: { startDate: startDateStr, days },
                  unavailableDates: Array.from(new Set([...p.unavailableDates, ...datesToBlock]))
              };
          }
          return p;
      });
      setAppData({ ...data, personnel: updatedPersonnel });
      setVacationId(null);
      if (military) {
        await logAuditAction({
            action: 'UPDATE_STATUS_VACATION',
            user_id: currentUser.username,
            details: `Lançada FÉRIAS de ${days} dias para ${military.warName}`
        });
      }
  };

  const confirmExcused = async (id: string) => {
      const days = parseInt(excusedDaysInput);
      if (!days || days <= 0) {
          alert("Informe a quantidade de dias.");
          return;
      }
      const today = new Date();
      const startDateStr = format(today, 'yyyy-MM-dd');
      const datesToBlock = Array.from({ length: days }, (_, i) => format(addDays(today, i), 'yyyy-MM-dd'));
      const military = data.personnel.find(p => p.id === id);

      const updatedPersonnel = data.personnel.map(p => {
          if (p.id === id) {
              return {
                  ...p,
                  status: 'DISPENSADO' as MilitaryStatus,
                  dispensationData: { startDate: startDateStr, days },
                  unavailableDates: Array.from(new Set([...p.unavailableDates, ...datesToBlock]))
              };
          }
          return p;
      });
      setAppData({ ...data, personnel: updatedPersonnel });
      setExcusedId(null);
      if (military) {
        await logAuditAction({
            action: 'UPDATE_STATUS_EXCUSED',
            user_id: currentUser.username,
            details: `Lançada DISPENSA de ${days} dias para ${military.warName}`
        });
      }
  };

  const cancelInputs = () => {
      setSickLeaveId(null);
      setVacationId(null);
      setExcusedId(null);
  };

  const updateStatusRecursive = async (id: string, newStatus: MilitaryStatus) => {
    const military = data.personnel.find(p => p.id === id);
    setAppData({ ...data, personnel: data.personnel.map(p => {
        if (p.id === id) {
             return { ...p, status: newStatus };
        }
        return p;
    })});

    if (military && military.status !== newStatus) {
        await logAuditAction({
            action: 'UPDATE_STATUS',
            user_id: currentUser.username,
            details: `Status de ${military.warName} alterado: ${military.status} -> ${newStatus}`
        });
    }
  };

  const startEdit = (military: Military) => {
    setEditingId(military.id);
    setEditForm({ ...military });
  };

  const saveEdit = async () => {
    if (!editingId || !editForm) return;
    setAppData({ ...data, personnel: data.personnel.map(p => p.id === editingId ? { ...editForm } as Military : p) });
    setEditingId(null);
    
    await logAuditAction({
        action: 'UPDATE_MILITARY',
        user_id: currentUser.username,
        details: `Dados editados do militar: ${editForm.warName}`
    });
  };

  const filteredPersonnel = data.personnel.filter(p => {
    const matchesTerm = p.warName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                       p.number.includes(searchTerm) || 
                       (p.sector && p.sector.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus = statusFilter === 'TODOS' || p.status === statusFilter;
    return matchesTerm && matchesStatus;
  }).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

  return (
    <div className="space-y-8 relative">
      
      {modalConfig && modalConfig.isOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col transform transition-all animate-scale-in">
                <div className="bg-red-600 p-4 flex justify-between items-center text-white">
                    <h3 className="font-bold text-lg flex items-center">
                        <AlertTriangle className="w-6 h-6 mr-2 fill-current" /> 
                        {modalConfig.title}
                    </h3>
                    <button onClick={() => setModalConfig(null)} className="text-white/80 hover:text-white"><X className="w-6 h-6"/></button>
                </div>
                <div className="p-6">
                    <div className="text-gray-700">{modalConfig.message}</div>
                </div>
                <div className="bg-gray-50 p-4 border-t border-gray-100 flex justify-end gap-3">
                    <button onClick={() => setModalConfig(null)} className="px-4 py-2 text-gray-600 font-bold hover:bg-gray-200 rounded-lg transition-colors">Cancelar</button>
                    <button 
                        onClick={modalConfig.onConfirm} 
                        className="px-6 py-2 text-white font-bold rounded-lg shadow-md transition-colors bg-red-600 hover:bg-red-700"
                    >
                        Confirmar Exclusão
                    </button>
                </div>
            </div>
        </div>
      )}

      {error && (
          <div className="fixed top-4 right-4 z-[100] bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded flex items-center shadow-lg animate-fade-in">
              <AlertTriangle className="w-5 h-5 mr-2" />
              <span>{error}</span>
              <button onClick={() => setError("")} className="ml-4 text-red-900 font-bold">&times;</button>
          </div>
      )}

      {success && (
          <div className="fixed top-4 right-4 z-[100] bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded flex items-center shadow-lg animate-fade-in">
              <CheckCircle2 className="w-5 h-5 mr-2" />
              <span>{success}</span>
              <button onClick={() => setSuccess("")} className="ml-4 text-green-900 font-bold">&times;</button>
          </div>
      )}

      {editingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] animate-scale-in">
            <div className="bg-military-900 p-4 flex justify-between items-center shrink-0">
              <h3 className="text-white font-bold text-lg flex items-center"><Edit className="w-5 h-5 mr-2" /> Editar Militar</h3>
              <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-white"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-6 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Graduação</label>
                  <select className="w-full p-2 border border-gray-300 rounded bg-gray-50" value={editForm.rank} onChange={e => setEditForm({ ...editForm, rank: e.target.value as Rank })}>
                    {RANKS_LIST.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Número</label>
                  <input type="text" className="w-full p-2 border border-gray-300 rounded bg-gray-50" value={editForm.number} onChange={e => setEditForm({ ...editForm, number: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome de Guerra</label>
                  <input type="text" className="w-full p-2 border border-gray-300 rounded bg-gray-50 uppercase font-bold text-gray-800" value={editForm.warName} onChange={e => setEditForm({ ...editForm, warName: e.target.value })} />
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Ano Formação</label>
                    <input type="number" className="w-full p-2 border border-gray-300 rounded bg-gray-50" value={editForm.formationYear} onChange={e => setEditForm({ ...editForm, formationYear: parseInt(e.target.value) || new Date().getFullYear() })} />
                </div>
                <div className="col-span-1">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Setor</label>
                  <input type="text" className="w-full p-2 border border-gray-300 rounded bg-gray-50" value={editForm.sector} onChange={e => setEditForm({ ...editForm, sector: e.target.value })} />
                </div>
              </div>
            </div>
            <div className="bg-gray-50 p-4 border-t flex justify-end space-x-3 shrink-0">
              <button onClick={() => setEditingId(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg">Cancelar</button>
              <button onClick={saveEdit} className="px-6 py-2 bg-military-600 text-white rounded-lg font-bold hover:bg-military-700 shadow-md">Salvar</button>
            </div>
          </div>
        </div>
      )}

      {canManage && (
        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 animate-fade-in">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center">
              <div className="p-2 bg-military-100 rounded-lg mr-3">
                <PlusCircle className="w-6 h-6 text-military-700" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">Cadastrar Novo Militar</h3>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-end">
            <div className="md:col-span-3">
              <label className="block text-sm font-bold text-gray-700 mb-2">Posto / Grad.</label>
              <select className="w-full border-gray-300 border bg-gray-50 rounded-lg p-3 text-gray-900 focus:ring-military-500 focus:border-military-500" value={newSoldier.rank} onChange={e => setNewSoldier({ ...newSoldier, rank: e.target.value as Rank, eligibleServices: [] })}>
                {RANKS_LIST.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-bold text-gray-700 mb-2">Número</label>
              <input type="text" placeholder="Ex: 1234" className="w-full border-gray-300 border bg-gray-50 rounded-lg p-3 text-gray-900 focus:ring-military-500 focus:border-military-500" value={newSoldier.number || ''} onChange={e => setNewSoldier({ ...newSoldier, number: e.target.value })} />
            </div>
            <div className="md:col-span-3">
              <label className="block text-sm font-bold text-gray-700 mb-2">Nome de Guerra</label>
              <input type="text" placeholder="Ex: SILVA" className="w-full border-gray-300 border bg-gray-50 rounded-lg p-3 text-gray-900 focus:ring-military-500 focus:border-military-500 uppercase" value={newSoldier.warName || ''} onChange={e => setNewSoldier({ ...newSoldier, warName: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-bold text-gray-700 mb-2">Setor</label>
              <input type="text" placeholder="Ex: Transportes" className="w-full border-gray-300 border bg-gray-50 rounded-lg p-3 text-gray-900 focus:ring-military-500 focus:border-military-500" value={newSoldier.sector || ''} onChange={e => setNewSoldier({ ...newSoldier, sector: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <button type="button" onClick={handleAdd} className="w-full bg-military-600 text-white p-3 rounded-lg font-bold hover:bg-military-700 shadow-md transition-all active:scale-95 flex justify-center items-center">
                <Check className="w-5 h-5 mr-1" /> Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex flex-col md:flex-row justify-between items-center gap-4">
          <h3 className="text-lg font-bold text-gray-800">Efetivo Atual</h3>
          <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto items-center">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Filter className="h-4 w-4 text-gray-400" /></div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="pl-9 pr-8 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-military-500 text-sm font-medium text-gray-700 appearance-none cursor-pointer">
                <option value="TODOS">Todos os Status</option>
                <option value="ATIVO">Ativo</option>
                <option value="FERIAS">Férias</option>
                <option value="DISPENSADO">Dispensado</option>
                <option value="BAIXADO">Baixado</option>
              </select>
            </div>
            <div className="relative w-full md:w-80">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Search className="h-5 w-5 text-gray-400" /></div>
              <input type="text" className="pl-10 w-full p-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-military-500 text-sm" placeholder="Buscar por Nome, Número ou Setor..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase">PG</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase">Número</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase">Nome de Guerra</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase">Status</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase">Setor</th>
                <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase">Missões</th>
                {canManage && <th className="px-6 py-4 text-right text-xs font-bold text-gray-600 uppercase">Ações</th>}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredPersonnel.length === 0 ? (
                <tr><td colSpan={canManage ? 7 : 6} className="px-6 py-10 text-center text-gray-400 italic">Nenhum militar encontrado.</td></tr>
              ) : (
                filteredPersonnel.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors group">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-military-700">{p.rank}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-800 font-mono">{p.number}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">{p.warName}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {sickLeaveId === p.id ? (
                          <div className="flex items-center gap-1 animate-fade-in-up">
                              <span className="text-xs font-bold text-red-700 mr-1">DIAS:</span>
                              <input 
                                autoFocus
                                type="number"
                                min="1"
                                value={sickDaysInput}
                                onChange={(e) => setSickDaysInput(e.target.value)}
                                className="w-12 py-0.5 px-1 border border-red-300 rounded text-center text-sm focus:ring-2 focus:ring-red-500 outline-none"
                              />
                              <button onClick={() => confirmSickLeave(p.id)} className="p-1 bg-green-100 text-green-700 rounded hover:bg-green-200"><Check className="w-3 h-3"/></button>
                              <button onClick={cancelInputs} className="p-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"><X className="w-3 h-3"/></button>
                          </div>
                      ) : vacationId === p.id ? (
                          <div className="flex items-center gap-1 animate-fade-in-up">
                              <span className="text-xs font-bold text-cyan-700 mr-1">DIAS:</span>
                              <input 
                                autoFocus
                                type="number"
                                min="1"
                                value={vacationDaysInput}
                                onChange={(e) => setVacationDaysInput(e.target.value)}
                                className="w-12 py-0.5 px-1 border border-cyan-300 rounded text-center text-sm focus:ring-2 focus:ring-cyan-500 outline-none"
                              />
                              <button onClick={() => confirmVacation(p.id)} className="p-1 bg-green-100 text-green-700 rounded hover:bg-green-200"><Check className="w-3 h-3"/></button>
                              <button onClick={cancelInputs} className="p-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"><X className="w-3 h-3"/></button>
                          </div>
                      ) : excusedId === p.id ? (
                          <div className="flex items-center gap-1 animate-fade-in-up">
                              <span className="text-xs font-bold text-orange-700 mr-1">DIAS:</span>
                              <input 
                                autoFocus
                                type="number"
                                min="1"
                                value={excusedDaysInput}
                                onChange={(e) => setExcusedDaysInput(e.target.value)}
                                className="w-12 py-0.5 px-1 border border-orange-300 rounded text-center text-sm focus:ring-2 focus:ring-orange-500 outline-none"
                              />
                              <button onClick={() => confirmExcused(p.id)} className="p-1 bg-green-100 text-green-700 rounded hover:bg-green-200"><Check className="w-3 h-3"/></button>
                              <button onClick={cancelInputs} className="p-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"><X className="w-3 h-3"/></button>
                          </div>
                      ) : (
                          <select 
                            value={p.status} 
                            onChange={(e) => handleStatusChange(p.id, e.target.value as MilitaryStatus)} 
                            className={`rounded-full px-3 py-1 text-xs font-bold border-none cursor-pointer transition-all ${p.status === 'ATIVO' ? 'bg-green-100 text-green-800' : p.status === 'FERIAS' ? 'bg-cyan-100 text-cyan-800' : p.status === 'DISPENSADO' ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-800'}`}
                          >
                            <option value="ATIVO">ATIVO</option>
                            <option value="FERIAS">FÉRIAS</option>
                            <option value="DISPENSADO">DISPENSADO</option>
                            <option value="BAIXADO">BAIXADO</option>
                          </select>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{p.sector || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600"><span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">{p.totalServices}</span></td>
                    {canManage && (
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium flex justify-end space-x-2">
                        <button onClick={() => startEdit(p)} title="Editar" className="text-blue-500 hover:text-blue-700 p-2"><Edit className="w-4 h-4" /></button>
                        <button onClick={() => handleDeleteClick(p)} title="Excluir" className="text-red-500 hover:text-red-700 p-2 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PersonnelManager;