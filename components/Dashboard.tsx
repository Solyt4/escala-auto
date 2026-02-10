import React, { useState, useMemo, useRef } from 'react';
import { MilitaryStatus, Rank } from '../types';
import { useAppStore } from '../store/useAppStore';
import { 
  Users, Calendar, Shield, AlertTriangle, ChevronUp, ChevronDown, 
  Plane, Stethoscope, UserMinus, X, Activity, Clock, Trash2,
  FileText, RefreshCw, UserPlus, Archive, Ban, Search
} from 'lucide-react';
import { format, addDays } from 'date-fns';
import ptBR from 'date-fns/locale/pt-BR';
import { parseISO } from '../utils/helpers';
import { logAuditAction } from '../services/db';

const Dashboard: React.FC = () => {
  const { data, user, setAppData } = useAppStore();
  const [selectedStatus, setSelectedStatus] = useState<MilitaryStatus | null>(null);
  const [isExiting, setIsExiting] = useState(false);
  const [logFilterDate, setLogFilterDate] = useState('');
  const transitionTimeoutRef = useRef<number | null>(null);

  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    isDestructive?: boolean;
    onConfirm: () => void;
  } | null>(null);

  const uniqueScaleDays = useMemo(() => {
    if (!data.scale || data.scale.length === 0) return 0;
    try {
        const unique = new Set(data.scale.map(s => {
            if (!s.date) return '';
            return s.date.substring(0, 10);
        }));
        if (unique.has('')) unique.delete('');
        return unique.size;
    } catch (e) {
        console.error("Erro ao calcular dias de escala", e);
        return 0;
    }
  }, [data.scale]);

  const stats = {
    total: data.personnel.length,
    scales: uniqueScaleDays,
    cb: data.personnel.filter(p => p.rank === Rank.CB).length,
    sd_ep: data.personnel.filter(p => p.rank === Rank.SD_EP).length,
    sd_ev: data.personnel.filter(p => p.rank === Rank.SD_EV).length,
    vacation: data.personnel.filter(p => p.status === 'FERIAS').length,
    sick: data.personnel.filter(p => p.status === 'BAIXADO').length,
    excused: data.personnel.filter(p => p.status === 'DISPENSADO').length,
  };

  const handleClearLogsClick = () => {
    setModalConfig({
        isOpen: true,
        title: "Limpar Histórico de Logs",
        message: "ATENÇÃO: Deseja realmente apagar todo o histórico de logs do sistema? Esta ação não pode ser desfeita e removerá todos os registros de auditoria visualizados abaixo.",
        isDestructive: true,
        onConfirm: executeClearLogs
    });
  };

  const executeClearLogs = async () => {
    setModalConfig(null);
    setAppData({ ...data, logs: [] });
  };

  const getLogStyle = (action: string) => {
    if (action.includes('DELETE')) return { icon: <Trash2 className="w-4 h-4" />, color: 'bg-red-100 text-red-600', label: 'Exclusão' };
    if (action.includes('SWAP')) return { icon: <RefreshCw className="w-4 h-4" />, color: 'bg-blue-100 text-blue-600', label: 'Troca de Serviço' };
    if (action.includes('ADD')) return { icon: <UserPlus className="w-4 h-4" />, color: 'bg-green-100 text-green-600', label: 'Inclusão' };
    if (action.includes('ARCHIVE')) return { icon: <Archive className="w-4 h-4" />, color: 'bg-orange-100 text-orange-600', label: 'Arquivamento' };
    if (action.includes('RESET')) return { icon: <Ban className="w-4 h-4" />, color: 'bg-red-100 text-red-600', label: 'Reset Geral' };
    
    return { icon: <Activity className="w-4 h-4" />, color: 'bg-gray-100 text-gray-600', label: 'Atividade' };
  };

  const Card = ({ title, value, colorClass, icon, subtext, onClick, isActive }: any) => (
    <div 
      onClick={onClick}
      className={`bg-white p-6 rounded-xl shadow-sm border relative overflow-hidden group transition-all duration-200 
        ${onClick ? 'cursor-pointer hover:shadow-md hover:-translate-y-1' : ''}
        ${isActive ? 'ring-2 ring-offset-2 ring-military-500 border-military-500' : 'border-gray-100'}
      `}
    >
      <div className={`absolute top-0 left-0 w-1 h-full ${colorClass}`}></div>
      <div className="flex justify-between items-start">
        <div>
          <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">{title}</div>
          <div className="text-3xl font-bold text-gray-900">{value}</div>
          {subtext && <div className="text-xs text-gray-400 mt-1">{subtext}</div>}
        </div>
        <div className={`p-2 rounded-lg bg-gray-50 group-hover:bg-gray-100 transition-colors`}>
          {icon}
        </div>
      </div>
      {onClick && isActive && (
        <div className="absolute bottom-2 right-2 text-military-600 animate-pulse">
            <ChevronUp className="w-4 h-4" />
        </div>
      )}
      {onClick && !isActive && (
        <div className="absolute bottom-2 right-2 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">
            <ChevronDown className="w-4 h-4" />
        </div>
      )}
    </div>
  );

  const handleStatusSwitch = (newStatus: MilitaryStatus) => {
    if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
    }

    if (selectedStatus === newStatus) {
        // Closing the current one
        setIsExiting(true);
        transitionTimeoutRef.current = window.setTimeout(() => {
            setSelectedStatus(null);
            setIsExiting(false);
        }, 300); // Matches animation duration
    } else if (selectedStatus) {
        // Switching from one to another
        setIsExiting(true);
        transitionTimeoutRef.current = window.setTimeout(() => {
            setSelectedStatus(newStatus);
            setIsExiting(false);
        }, 300);
    } else {
        // Opening fresh
        setSelectedStatus(newStatus);
        setIsExiting(false);
    }
  };

  const closeStatus = () => {
      setIsExiting(true);
      setTimeout(() => {
          setSelectedStatus(null);
          setIsExiting(false);
      }, 300);
  };

  const getFilteredPersonnel = () => {
      if (!selectedStatus) return [];
      return data.personnel.filter(p => p.status === selectedStatus);
  };

  const filteredList = getFilteredPersonnel();
  
  const statusLabels: Record<string, { label: string, color: string }> = {
      'FERIAS': { label: 'Militares em Férias', color: 'bg-cyan-100 text-cyan-800 border-cyan-200' },
      'BAIXADO': { label: 'Militares Baixados', color: 'bg-red-100 text-red-800 border-red-200' },
      'DISPENSADO': { label: 'Militares Dispensados', color: 'bg-orange-100 text-orange-800 border-orange-200' }
  };

  const logs = data.logs || [];

  const filteredLogs = useMemo(() => {
      if (!logFilterDate) return logs;
      
      return logs.filter(log => {
          const logDate = new Date(log.timestamp);
          const formattedLogDate = format(logDate, 'yyyy-MM-dd');
          return formattedLogDate === logFilterDate;
      });
  }, [logs, logFilterDate]);

  return (
    <div className="space-y-6 mb-8 relative">
      
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
                    <div className="text-gray-700">{modalConfig.message}</div>
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card title="Total Efetivo" value={stats.total} colorClass="bg-military-600" icon={<Users className="w-6 h-6 text-military-700" />} />
        <Card title="Dias de Escala" value={stats.scales} subtext="Dias computados" colorClass="bg-yellow-500" icon={<Calendar className="w-6 h-6 text-yellow-600" />} />
        <Card title="Cabos" value={stats.cb} colorClass="bg-blue-600" icon={<Shield className="w-6 h-6 text-blue-700" />} />
        <Card title="Soldados (EP/EV)" value={stats.sd_ep + stats.sd_ev} subtext={`${stats.sd_ep} EP / ${stats.sd_ev} EV`} colorClass="bg-green-600" icon={<Shield className="w-6 h-6 text-green-700" />} />
      </div>
      
      <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider flex items-center mt-8 mb-2">
        <AlertTriangle className="w-4 h-4 mr-2" /> Situação de Indisponibilidade <span className="text-[10px] ml-2 text-gray-400 normal-case">(Clique para ver detalhes)</span>
      </h3>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card 
            title="Em Férias" 
            value={stats.vacation} 
            colorClass="bg-cyan-500" 
            icon={<Plane className="w-6 h-6 text-cyan-600" />} 
            onClick={() => handleStatusSwitch('FERIAS')}
            isActive={selectedStatus === 'FERIAS'}
        />
        <Card 
            title="Baixados (Saúde)" 
            value={stats.sick} 
            colorClass="bg-red-500" 
            icon={<Stethoscope className="w-6 h-6 text-red-600" />} 
            onClick={() => handleStatusSwitch('BAIXADO')}
            isActive={selectedStatus === 'BAIXADO'}
        />
        <Card 
            title="Dispensados" 
            value={stats.excused} 
            colorClass="bg-orange-400" 
            icon={<UserMinus className="w-6 h-6 text-orange-500" />} 
            onClick={() => handleStatusSwitch('DISPENSADO')}
            isActive={selectedStatus === 'DISPENSADO'}
        />
      </div>

      {selectedStatus && (
          <div className={`bg-white rounded-xl shadow-lg border border-gray-200 mt-6 overflow-hidden transform transition-all ${isExiting ? 'animate-fade-out-up' : 'animate-fade-in-up'}`}>
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                  <div className="flex items-center gap-3">
                      <div className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-2 ${statusLabels[selectedStatus].color}`}>
                        {selectedStatus === 'FERIAS' && <Plane className="w-3 h-3"/>}
                        {selectedStatus === 'BAIXADO' && <Stethoscope className="w-3 h-3"/>}
                        {selectedStatus === 'DISPENSADO' && <UserMinus className="w-3 h-3"/>}
                        {statusLabels[selectedStatus].label}
                      </div>
                      <span className="text-gray-400 text-xs font-bold">({filteredList.length} militares)</span>
                  </div>
                  <button onClick={closeStatus} className="text-gray-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-full transition-colors">
                      <X className="w-5 h-5" />
                  </button>
              </div>
              
              <div className="max-h-80 overflow-y-auto">
                  {filteredList.length === 0 ? (
                      <div className="p-8 text-center text-gray-400 italic text-sm">Nenhum militar nesta situação no momento.</div>
                  ) : (
                      <table className="min-w-full divide-y divide-gray-100">
                          <thead className="bg-gray-50 sticky top-0">
                              <tr>
                                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Posto/Grad</th>
                                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Nome de Guerra</th>
                                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Número</th>
                                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Setor</th>
                                  {(selectedStatus === 'FERIAS' || selectedStatus === 'BAIXADO' || selectedStatus === 'DISPENSADO') && <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Período</th>}
                              </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-100">
                              {filteredList.map((m) => (
                                  <tr key={m.id} className="hover:bg-blue-50/50 transition-colors">
                                      <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-600 font-medium">{m.rank}</td>
                                      <td className="px-6 py-3 whitespace-nowrap text-sm font-bold text-gray-900">{m.warName}</td>
                                      <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-500 font-mono">{m.number}</td>
                                      <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-500">{m.sector || '-'}</td>
                                      
                                      {selectedStatus === 'FERIAS' && (
                                          <td className="px-6 py-3 whitespace-nowrap text-xs text-cyan-700 font-medium">
                                              {m.vacationData ? (
                                                  <>
                                                    {format(parseISO(m.vacationData.startDate), 'dd/MM')} 
                                                    <span className="text-gray-400 mx-1">➜</span> 
                                                    {format(addDays(parseISO(m.vacationData.startDate), m.vacationData.days), 'dd/MM')}
                                                  </>
                                              ) : '-'}
                                          </td>
                                      )}

                                      {selectedStatus === 'BAIXADO' && (
                                          <td className="px-6 py-3 whitespace-nowrap text-xs text-red-700 font-medium">
                                              {m.medicalLeaveData ? (
                                                  <>
                                                    {format(parseISO(m.medicalLeaveData.startDate), 'dd/MM')} 
                                                    <span className="text-gray-400 mx-1">➜</span> 
                                                    {format(addDays(parseISO(m.medicalLeaveData.startDate), m.medicalLeaveData.days), 'dd/MM')}
                                                    <span className="ml-2 bg-red-50 text-red-600 border border-red-100 px-1.5 py-0.5 rounded-full text-[10px]">
                                                      {m.medicalLeaveData.days} dias
                                                    </span>
                                                  </>
                                              ) : '-'}
                                          </td>
                                      )}

                                      {selectedStatus === 'DISPENSADO' && (
                                          <td className="px-6 py-3 whitespace-nowrap text-xs text-orange-700 font-medium">
                                              {m.dispensationData ? (
                                                  <>
                                                    {format(parseISO(m.dispensationData.startDate), 'dd/MM')} 
                                                    <span className="text-gray-400 mx-1">➜</span> 
                                                    {format(addDays(parseISO(m.dispensationData.startDate), m.dispensationData.days), 'dd/MM')}
                                                    <span className="ml-2 bg-orange-50 text-orange-600 border border-orange-100 px-1.5 py-0.5 rounded-full text-[10px]">
                                                      {m.dispensationData.days} dias
                                                    </span>
                                                  </>
                                              ) : '-'}
                                          </td>
                                      )}
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  )}
              </div>
          </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 mt-8 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-gray-500" />
                  <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Histórico de Atividades Recentes</h3>
              </div>

              <div className="flex items-center gap-3 w-full md:w-auto">
                
                <div className="flex items-center bg-white border border-gray-300 rounded-lg px-2 py-1 shadow-sm w-full md:w-auto">
                    <Calendar className="w-4 h-4 text-gray-400 mr-2 shrink-0"/>
                    <input 
                        type="date" 
                        value={logFilterDate}
                        onChange={(e) => setLogFilterDate(e.target.value)}
                        className="text-xs font-bold text-gray-700 bg-transparent outline-none w-full md:w-auto"
                        title="Filtrar logs por data"
                    />
                    {logFilterDate && (
                        <button 
                            onClick={() => setLogFilterDate('')}
                            className="ml-2 p-1 hover:bg-gray-100 rounded-full text-gray-400 hover:text-red-500 transition-colors"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    )}
                </div>

                {user?.role === 'DEV' && (
                  <button 
                    onClick={handleClearLogsClick}
                    className="flex items-center gap-1 text-[10px] font-bold bg-red-50 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-100 transition-colors whitespace-nowrap"
                    title="Limpar histórico de logs"
                  >
                    <Trash2 className="w-3 h-3" /> Limpar
                  </button>
                )}
                
                <span className="text-[10px] text-gray-400 bg-white border border-gray-200 px-2 py-1 rounded-full whitespace-nowrap hidden sm:inline-block">
                    Exibindo {filteredLogs.length} registro(s)
                </span>
              </div>
          </div>
          
          <div className="max-h-80 overflow-y-auto p-4 bg-gray-50/50">
              {filteredLogs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 opacity-50">
                      {logFilterDate ? (
                          <>
                             <Search className="w-12 h-12 text-gray-300 mb-2"/>
                             <p className="text-sm text-gray-400 italic">Nenhuma atividade encontrada nesta data.</p>
                             <button onClick={() => setLogFilterDate('')} className="mt-2 text-xs text-blue-500 hover:underline">Limpar Filtro</button>
                          </>
                      ) : (
                          <>
                             <FileText className="w-12 h-12 text-gray-300 mb-2"/>
                             <p className="text-sm text-gray-400 italic">Nenhuma atividade registrada.</p>
                          </>
                      )}
                  </div>
              ) : (
                  <div className="space-y-3">
                      {filteredLogs.map((log, index) => {
                          const date = new Date(log.timestamp);
                          const isValidDate = !isNaN(date.getTime());
                          const displayTime = isValidDate 
                              ? format(date, "dd/MM/yy 'às' HH:mm", { locale: ptBR })
                              : log.timestamp;
                          
                          const style = getLogStyle(log.action);

                          return (
                              <div key={index} className="flex items-start bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                                  <div className={`mt-1 p-2 rounded-full shrink-0 ${style.color}`}>
                                      {style.icon}
                                  </div>
                                  <div className="ml-3 flex-1">
                                      <div className="flex justify-between items-start">
                                          <h4 className="text-sm font-bold text-gray-800">{style.label}</h4>
                                          <span className="text-[10px] text-gray-400 flex items-center gap-1 bg-gray-100 px-1.5 py-0.5 rounded">
                                              <Clock className="w-3 h-3" /> {displayTime}
                                          </span>
                                      </div>
                                      <p className="text-xs text-gray-600 mt-1">{log.details}</p>
                                      <div className="mt-1.5 text-[10px] text-gray-400 font-medium">
                                          Responsável: <span className="text-gray-500">{log.user_id.split('@')[0]}</span>
                                      </div>
                                  </div>
                              </div>
                          );
                      })}
                  </div>
              )}
          </div>
      </div>
    </div>
  );
};

export default Dashboard;