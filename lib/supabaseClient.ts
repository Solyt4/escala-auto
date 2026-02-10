
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Singleton do Supabase Client.
 * 
 * INSTRUÇÕES:
 * 1. Crie um arquivo chamado .env.local na raiz do seu projeto.
 * 2. Adicione as seguintes linhas (sem aspas):
 *    VITE_SUPABASE_URL=https://kgxuokasiojpknuxnunc.supabase.co
 *    VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtneHVva2FzaW9qcGtudXhudW5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNDc4MTIsImV4cCI6MjA4MTcyMzgxMn0.Zj3b4oK7DE7sZQ5SGfCjDFZ3hlmDCPH7Cso_AA-oyhE
 */

// Fallback values provided by user for immediate resolution if env vars are not detected by bundler
const FALLBACK_URL = 'https://kgxuokasiojpknuxnunc.supabase.co';
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtneHVva2FzaW9qcGtudXhudW5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNDc4MTIsImV4cCI6MjA4MTcyMzgxMn0.Zj3b4oK7DE7sZQ5SGfCjDFZ3hlmDCPH7Cso_AA-oyhE';

const getEnv = (key: string, fallback: string): string => {
  const env = (import.meta as any).env;
  if (env && env[key]) return env[key];
  
  // Use fallback if env is missing
  return fallback;
};

const supabaseUrl: string = getEnv('VITE_SUPABASE_URL', FALLBACK_URL);
const supabaseAnonKey: string = getEnv('VITE_SUPABASE_ANON_KEY', FALLBACK_KEY);

const createSafeClient = () => {
  // createClient throws if URL is empty. We ensure it's not empty by using fallbacks or returning a proxy.
  if (!supabaseUrl) {
    console.warn("Supabase: VITE_SUPABASE_URL não encontrada. O sistema pode apresentar falhas de conexão.");
    return new Proxy({} as SupabaseClient, {
      get: (target, prop) => {
        const forbidden = ['from', 'auth', 'storage', 'channel'];
        if ( forbidden.includes(prop.toString())) {
          return () => {
            throw new Error("Supabase URL é obrigatória. Verifique seu arquivo .env.local.");
          };
        }
        return (target as any)[prop];
      }
    });
  }
  return createClient(supabaseUrl, supabaseAnonKey);
};

const supabase: SupabaseClient = createSafeClient();

export default supabase;
