import React, { useState, useEffect, useRef } from 'react';
import { User } from './types';
import Login from './components/Login';
import { STORAGE_KEY } from './constants';
import { 
  Shield, LayoutDashboard, Users, Calendar, Briefcase, 
  BrainCircuit, Database, LogOut, Wifi, WifiOff, 
  CloudCheck, CloudOff, RefreshCw, User as UserIcon, Menu, X 
} from 'lucide-react';

import Dashboard from './components/Dashboard';
import PersonnelManager from './components/PersonnelManager';
import ServiceManager from './components/ServiceManager';
import ScaleGenerator from './components/ScaleGenerator';
import ScaleViewer from './components/ScaleViewer';
import AnalysisViewer from './components/AnalysisViewer';
import DatabaseConfig from './components/DatabaseConfig';

import { fetchRemoteData, saveRemoteData, subscribeToData, getDbConfig } from './services/db';
import { useAppStore } from './store/useAppStore';
import supabase from './lib/supabaseClient';

const TypewriterFooter = ({ text }: { text: string }) => {
  const [displayText, setDisplayText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [loopNum, setLoopNum] = useState(0);
  const [typingSpeed, setTypingSpeed] = useState(150);

  useEffect(() => {
    const handleType = () => {
      const fullText = text;
      
      setDisplayText(current => 
        isDeleting 
          ? fullText.substring(0, current.length - 1) 
          : fullText.substring(0, current.length + 1)
      );

      setTypingSpeed(isDeleting ? 50 : 100);

      if (!isDeleting && displayText === fullText) {
        setTimeout(() => setIsDeleting(true), 2500); // Wait before deleting
      } else if (isDeleting && displayText === '') {
        setIsDeleting(false);
        setLoopNum(loopNum + 1);
      }
    };

    const timer = setTimeout(handleType, typingSpeed);
    return () => clearTimeout(timer);
  }, [displayText, isDeleting, loopNum, typingSpeed, text]);

  return (
    <p className="text-[10px] text-military-500 font-bold uppercase tracking-widest opacity-60 font-mono h-4">
      {displayText}
      <span className="animate-pulse border-r-2 border-military-500 ml-0.5 h-3 inline-block align-middle"></span>
    </p>
  );
};

const App: React.FC = () => {
  const { user, setUser, data, setAppData } = useAppStore();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'personnel' | 'scale' | 'analysis' | 'services' | 'database'>('dashboard');
  const [dbConnected, setDbConnected] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'IDLE' | 'SAVING' | 'SYNCED' | 'ERROR'>('SYNCED');
  const [authLoading, setAuthLoading] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  const isInitialMount = useRef(true);
  const isRemoteUpdate = useRef(false);
  const saveTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const metadata = session.user.user_metadata || {};
        setUser({
          username: session.user.email || 'user',
          name: metadata.name || 'Militar',
          role: metadata.role || 'ESCALANTE'
        });
      }
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const metadata = session.user.user_metadata || {};
        setUser({
          username: session.user.email || 'user',
          name: metadata.name || 'Militar',
          role: metadata.role || 'ESCALANTE'
        });
      } else {
        setUser(null);
      }
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [setUser]);

  useEffect(() => {
    if (!user) return;

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        setAppData(JSON.parse(saved));
    }

    const config = getDbConfig();
    setDbConnected(!!config);
    
    if(config) {
        fetchRemoteData().then(d => { 
            if(d) { 
                isRemoteUpdate.current = true; 
                setAppData({ ...d, sectorRules: d.sectorRules || [] }); 
                setSyncStatus('SYNCED');
            } 
        });
    }
    
    const unsubscribe = subscribeToData((newData) => { 
        isRemoteUpdate.current = true; 
        setAppData({ ...newData, sectorRules: newData.sectorRules || [] }); 
        setSyncStatus('SYNCED');
    });
    
    return () => unsubscribe();
  }, [user, setAppData]);

  useEffect(() => {
    if (!user) return;

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    
    if (isRemoteUpdate.current) { 
        isRemoteUpdate.current = false; 
        return; 
    }
    
    if (isInitialMount.current) {
        isInitialMount.current = false;
        return;
    }

    if (getDbConfig()) {
        setSyncStatus('SAVING');
        if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
        
        saveTimeoutRef.current = window.setTimeout(async () => {
            const result = await saveRemoteData(data);
            if (result.success) {
                setSyncStatus('SYNCED');
            } else {
                setSyncStatus('ERROR');
            }
        }, 800);
    }
  }, [data, user]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  };

  const handleNavClick = (tab: typeof activeTab) => {
    setActiveTab(tab);
    setIsMobileMenuOpen(false);
  };

  if (authLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center animate-pulse">
          <Shield className="w-12 h-12 text-military-600 mb-4" />
          <p className="text-military-800 font-bold">Carregando Sistema...</p>
        </div>
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <div className="h-screen bg-gray-50 flex font-sans text-gray-900 overflow-hidden relative">
      
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-20 md:hidden animate-fade-in"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      <aside className={`
        fixed inset-y-0 left-0 z-30 w-64 bg-military-900 text-white flex flex-col shadow-xl 
        transform transition-transform duration-300 ease-in-out flex-shrink-0
        md:relative md:translate-x-0
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        print:hidden
      `}>
        <div className="p-6 border-b border-military-800 flex items-center justify-between">
            <div className="flex items-center">
              <Shield className="w-8 h-8 text-military-300 mr-3" />
              <div>
                  <h1 className="text-xl font-bold tracking-wide">HFA Escala</h1>
                  <p className="text-xs text-military-400 uppercase tracking-wider">Sistema Integrado</p>
              </div>
            </div>
            <button 
              onClick={() => setIsMobileMenuOpen(false)} 
              className="md:hidden text-gray-400 hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
        </div>
        
        <div className="p-4 bg-military-800/50 flex flex-col gap-2">
          <div className="flex items-center space-x-3">
              <div className="bg-military-600 p-2 rounded-full"><UserIcon className="w-5 h-5 text-white" /></div>
              <div className="overflow-hidden">
                  <p className="text-sm font-bold truncate">{user.name}</p>
                  <p className="text-xs text-military-300 truncate">{user.role}</p>
              </div>
          </div>
          
          <div className="flex flex-col gap-1 mt-1">
              <div className={`flex items-center text-[10px] font-bold px-2 py-0.5 rounded ${dbConnected ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
                {dbConnected ? <Wifi className="w-3 h-3 mr-1" /> : <WifiOff className="w-3 h-3 mr-1" />}
                {dbConnected ? 'CONECTADO' : 'OFFLINE'}
              </div>
              {dbConnected && (
                  <div className={`flex items-center text-[10px] font-bold px-2 py-0.5 rounded ${syncStatus === 'SYNCED' ? 'bg-blue-900/50 text-blue-300' : syncStatus === 'SAVING' ? 'bg-yellow-900/50 text-yellow-300' : 'bg-red-900/50 text-red-300'}`}>
                    {syncStatus === 'SYNCED' ? <CloudCheck className="w-3 h-3 mr-1" /> : syncStatus === 'SAVING' ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : <CloudOff className="w-3 h-3 mr-1" />}
                    {syncStatus === 'SYNCED' ? 'SINCRONIZADO' : syncStatus === 'SAVING' ? 'SALVANDO...' : 'ERRO DE SYNC'}
                  </div>
              )}
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <button onClick={() => handleNavClick('dashboard')} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg ${activeTab === 'dashboard' ? 'bg-military-700 font-bold' : 'text-military-200 hover:bg-military-800'}`}><LayoutDashboard className="w-5 h-5" /><span>Dashboard</span></button>
          <button onClick={() => handleNavClick('personnel')} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg ${activeTab === 'personnel' ? 'bg-military-700 font-bold' : 'text-military-200 hover:bg-military-800'}`}><Users className="w-5 h-5" /><span>Efetivo</span></button>
          <button onClick={() => handleNavClick('scale')} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg ${activeTab === 'scale' ? 'bg-military-700 font-bold' : 'text-military-200 hover:bg-military-800'}`}><Calendar className="w-5 h-5" /><span>Gerar Escala</span></button>
          {(user.role === 'ADMIN' || user.role === 'DEV' || user.role === 'ESCALANTE') && <button onClick={() => handleNavClick('services')} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg ${activeTab === 'services' ? 'bg-military-700 font-bold' : 'text-military-200 hover:bg-military-800'}`}><Briefcase className="w-5 h-5" /><span>Serviços</span></button>}
          <button onClick={() => handleNavClick('analysis')} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg ${activeTab === 'analysis' ? 'bg-military-700 font-bold' : 'text-military-200 hover:bg-military-800'}`}><BrainCircuit className="w-5 h-5" /><span>Análise & Dados</span></button>
          {(user.role === 'DEV' || user.role === 'ADMIN') && (
            <button onClick={() => handleNavClick('database')} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg ${activeTab === 'database' ? 'bg-military-700 font-bold' : 'text-military-200 hover:bg-military-800'}`}><Database className="w-5 h-5" /><span>Configurações</span></button>
          )}
        </nav>
        
        <div className="px-4 pb-2 text-center mt-auto">
            <TypewriterFooter text="SD R. SILVA 24/AÇO ©" />
        </div>

        <div className="p-4 border-t border-military-800">
            <button onClick={handleLogout} className="w-full flex items-center space-x-3 px-4 py-3 text-red-300 hover:bg-red-950/30 rounded-lg transition-colors">
                <LogOut className="w-5 h-5" /><span>Sair</span>
            </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col h-full overflow-hidden w-full relative">
        
        <div className="md:hidden bg-white border-b border-gray-200 p-4 flex items-center justify-between shrink-0 z-10 shadow-sm">
            <div className="flex items-center gap-2">
                <Shield className="w-6 h-6 text-military-700"/>
                <span className="font-bold text-gray-800 text-lg">HFA Escala</span>
            </div>
            <button 
                onClick={() => setIsMobileMenuOpen(true)} 
                className="p-2 text-gray-600 hover:bg-gray-100 hover:text-military-700 rounded-lg transition-colors"
            >
                <Menu className="w-6 h-6" />
            </button>
        </div>

        <main className="flex-1 overflow-y-auto p-4 md:p-8 h-full bg-gray-50/50">
          <header className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 print:hidden">
            <div>
                <h2 className="text-2xl md:text-3xl font-bold text-gray-800 uppercase tracking-tight">
                    {activeTab === 'personnel' ? 'Efetivo Militar' : 
                     activeTab === 'scale' ? 'Gerenciamento de Escalas' : 
                     activeTab === 'database' ? 'Configurações e Dados' : 
                     activeTab === 'analysis' ? 'ANÁLISE ESTATÍSTICA' : 
                     activeTab.toUpperCase()}
                </h2>
                <p className="text-gray-500 font-medium text-sm md:text-base">HFA - Hospital das Forças Armadas</p>
            </div>
            {syncStatus === 'SAVING' && <div className="text-[10px] font-bold text-yellow-600 bg-yellow-50 px-2 py-1 rounded-full border border-yellow-200 animate-pulse self-start sm:self-auto">Sincronizando alterações...</div>}
          </header>

          {activeTab === 'dashboard' && <Dashboard />}
          {activeTab === 'personnel' && <PersonnelManager />}
          {activeTab === 'scale' && (
              <div className="space-y-8">
                  <ScaleGenerator data={data} onUpdateData={setAppData} />
                  <ScaleViewer />
              </div>
          )}
          {activeTab === 'services' && <ServiceManager />}
          {activeTab === 'database' && (
              <DatabaseConfig 
                  currentData={data} 
                  onDataLoaded={(d) => { 
                      isRemoteUpdate.current = true; 
                      setAppData(d); 
                      setDbConnected(true); 
                      setSyncStatus('SYNCED'); 
                  }} 
              />
          )}
          {activeTab === 'analysis' && <AnalysisViewer />}
        </main>
      </div>
    </div>
  );
};

export default App;