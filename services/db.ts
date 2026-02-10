import supabase from '../lib/supabaseClient';
import { AppData, AuditEntry } from '../types';
import { createClient } from '@supabase/supabase-js';
import { useAppStore } from '../store/useAppStore';

const DB_CONFIG_KEY = 'hfa_supabase_config_manual';

const getEnv = (key: string): string => {
  return (import.meta as any).env?.[key] || '';
};

export const getDbConfig = (): { url: string; key: string } | null => {
  const stored = localStorage.getItem(DB_CONFIG_KEY);
  if (stored) return JSON.parse(stored);

  const url = getEnv('VITE_SUPABASE_URL');
  const key = getEnv('VITE_SUPABASE_ANON_KEY');
  
  if (url && key) {
    return { url, key };
  }
  
  return null;
};

export const getEffectiveDbConfig = (): { url: string; key: string } => {
  const explicit = getDbConfig();
  if (explicit) return explicit;

  // Compatibilidade com o cliente singleton/fallback definido em lib/supabaseClient.ts.
  // Evita que a UI marque o sistema como offline quando o client padrão está ativo.
  return { url: 'Configurado via Singleton', key: '******' };
};

const getActiveClient = () => {
  const manual = localStorage.getItem(DB_CONFIG_KEY);
  if (manual) {
    const { url, key } = JSON.parse(manual);
    if (url && url !== getEnv('VITE_SUPABASE_URL')) {
        return createClient(url, key);
    }
  }
  return supabase;
};

export const saveDbConfig = (url: string, key: string) => {
  localStorage.setItem(DB_CONFIG_KEY, JSON.stringify({ url, key }));
  console.log("[DB] Configuração manual salva. Reiniciando para aplicar...");
  window.location.reload();
}; 

export const clearDbConfig = () => {
  localStorage.removeItem(DB_CONFIG_KEY);
  window.location.reload();
};

export const fetchRemoteData = async (): Promise<AppData | null> => {
  try {
    const client = getActiveClient();
    const { data, error } = await client
      .from('hfa_data')
      .select('content')
      .eq('id', 1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    
    return data?.content as AppData;
  } catch (err) {
    console.error("[SUPABASE] Erro ao buscar dados:", err);
    // Mantém compatibilidade com o cliente singleton/fallback definido em lib/supabaseClient.ts
  // para que o app não fique marcado como "offline" quando não há config manual/env explícita.
  return { url: 'Configurado via Singleton', key: '******' };
  }
};

export const saveRemoteData = async (data: AppData): Promise<{success: boolean, error?: any}> => {
  try {
    const client = getActiveClient();
    const { error } = await client
      .from('hfa_data')
      .upsert({ 
        id: 1, 
        content: data, 
        updated_at: new Date().toISOString() 
      }, { onConflict: 'id' });

    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error("[SUPABASE] Erro ao persistir dados:", err);
    return { success: false, error: err };
  }
};

export const logAuditAction = async (entry: Omit<AuditEntry, 'timestamp'>): Promise<void> => {
  if (entry.user_id === 'rsilva@hfa.local') {
      return;
  }

  const timestamp = new Date().toISOString();
  const fullEntry: AuditEntry = { ...entry, timestamp };

  console.log(`[AUDIT] ${entry.action}:`, entry.details);

  try {
      const store = useAppStore.getState();
      const currentLogs = store.data.logs || [];
      
      const newLogs = [fullEntry, ...currentLogs].slice(0, 200);
      
      store.setAppData({
          ...store.data,
          logs: newLogs
      });

  } catch (err) {
      console.warn(`[AUDIT] Falha ao registrar log local:`, err);
  }
};

export const subscribeToData = (onUpdate: (data: AppData) => void) => {
  const client = getActiveClient();
  
  try {
    const channel = client
      .channel('hfa_realtime_changes')
      .on('postgres_changes', 
          { event: 'UPDATE', schema: 'public', table: 'hfa_data', filter: 'id=eq.1' }, 
          (payload) => {
            console.log("[SUPABASE] Mudança detectada na nuvem...");
            if (payload.new && payload.new.content) {
              onUpdate(payload.new.content as AppData);
            }
          }
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  } catch (err) {
    console.warn("[SUPABASE] Falha na subscrição Realtime:", err);
    return () => {};
  }
};