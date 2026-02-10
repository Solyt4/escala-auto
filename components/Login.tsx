import React, { useState } from 'react';
import supabase from '../lib/supabaseClient';
import { Shield, Lock, User as UserIcon, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { User } from '../types';

interface LoginProps {
  onLogin?: (user: User) => void; 
}

const Login: React.FC<LoginProps> = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isShaking, setIsShaking] = useState(false);

  const SYSTEM_DOMAIN = '@hfa.local';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const cleanUsername = username.trim().toLowerCase();
      const emailToUse = `${cleanUsername}${SYSTEM_DOMAIN}`;

      console.log(`[LOGIN DEBUG] Tentando logar com: ${emailToUse}`);

      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: emailToUse,
        password: password,
      });

      if (authError) {
        console.error("[LOGIN ERROR] Resposta do Supabase:", authError);
        if (authError.message.includes("Email not confirmed")) {
            throw new Error("Usuário criado, mas pendente de confirmação no painel do Supabase.");
        }
        throw authError;
      }
      
    } catch (err: any) {
      console.error("Erro capturado:", err);
      setError(err.message || 'Credenciais inválidas.');
      
      // Trigger error animation
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 500); // Reset after animation duration

    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-military-900 via-military-800 to-gray-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-200 animate-fade-in">
        <div className="bg-military-900 p-8 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
          
          <div className="relative z-10">
            <div className="bg-white/10 p-3 rounded-full inline-block mb-4 backdrop-blur-sm">
                <Shield className="w-12 h-12 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-white tracking-wide">HFA Escala</h1>
            <p className="text-military-200 text-sm mt-1 font-medium tracking-wider uppercase">Acesso Restrito Militar</p>
          </div>
        </div>
        
        <form onSubmit={handleLogin} className="p-8 space-y-6">
          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded-lg flex items-center gap-2 text-sm border border-red-200 animate-fade-in">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
            </div>
          )}

          <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Usuário</label>
              <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input 
                      type="text" 
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-300 text-gray-900 rounded-lg focus:ring-2 focus:ring-military-500 focus:border-military-500 outline-none transition-all placeholder-gray-400"
                      placeholder="Usúario"
                      autoFocus
                  />
              </div>
          </div>

          <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Senha</label>
              <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input 
                      type="password" 
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-300 text-gray-900 rounded-lg focus:ring-2 focus:ring-military-500 focus:border-military-500 outline-none transition-all placeholder-gray-400"
                      placeholder="••••••••"
                  />
              </div>
          </div>

          <button 
              type="submit" 
              disabled={loading}
              className={`
                w-full py-3 font-bold rounded-lg shadow-lg flex items-center justify-center gap-2 transition-all duration-500
                ${isShaking 
                    ? 'bg-red-600 text-white ring-4 ring-red-400/50 border border-red-500 animate-shake' 
                    : 'bg-military-600 text-white hover:bg-military-700 border-transparent'}
                ${loading ? 'opacity-70 cursor-wait' : ''}
              `}
          >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-4 h-4" />}
              {loading ? 'Autenticando...' : (isShaking ? 'Credenciais Inválidas' : 'Acessar Sistema')}
          </button>
        </form>
        
        <div className="p-4 bg-gray-50 border-t border-gray-100 text-center">
            <p className="text-xs text-gray-500">Hospital das Forças Armadas &copy; 2024</p>
        </div>
      </div>
    </div>
  );
};

export default Login;