import React, { useState } from 'react';
import { Award, Lock, User, Eye, EyeOff, LogIn, AlertCircle, ShieldCheck } from 'lucide-react';

export default function LoginView({ onLoginSuccess }) {
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const loginLimpo = login.trim().toLowerCase();
    const senhaLimpa = senha.trim();

    if (!loginLimpo || !senhaLimpa) {
      setErro('Informe seu usuário e senha.');
      return;
    }

    setCarregando(true);
    setErro('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: loginLimpo, senha: senhaLimpa })
      });

      const data = await res.json();

      if (!res.ok || !data.sucesso) {
        setErro(data.mensagem || 'Usuário ou senha inválidos.');
        setCarregando(false);
        return;
      }

      // Armazena sessão segura
      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('auth_usuario', JSON.stringify(data.usuario));

      if (typeof onLoginSuccess === 'function') {
        onLoginSuccess(data.usuario, data.token);
      }
    } catch (err) {
      console.error('Erro na autenticação:', err);
      setErro('Falha de conexão com o servidor. Tente novamente.');
      setCarregando(false);
    }
  };

  return (
    <div className="login-screen-wrapper">
      <div className="login-card-container">
        {/* Header do Card */}
        <div className="login-card-header">
          <div className="login-brand-icon">
            <Award size={32} />
          </div>
          <h1 className="login-title">Acesso Restrito</h1>
          <p className="login-subtitle">
            Painel da Equipe • Emissão e Gestão de Certificados
          </p>
        </div>

        {/* Mensagem de Erro */}
        {erro && (
          <div className="login-alert-error" role="alert">
            <AlertCircle size={18} className="login-alert-icon" />
            <span>{erro}</span>
          </div>
        )}

        {/* Formulário de Login */}
        <form onSubmit={handleSubmit} className="login-form" autoComplete="off">
          <div className="login-form-group">
            <label htmlFor="login-input" className="login-label">
              Usuário
            </label>
            <div className="login-input-wrapper">
              <User size={18} className="login-input-icon" />
              <input
                id="login-input"
                type="text"
                className="login-input"
                placeholder="Ex: jorge.augusto"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                autoFocus
                disabled={carregando}
                autoComplete="username"
              />
            </div>
          </div>

          <div className="login-form-group">
            <label htmlFor="senha-input" className="login-label">
              Senha
            </label>
            <div className="login-input-wrapper">
              <Lock size={18} className="login-input-icon" />
              <input
                id="senha-input"
                type={mostrarSenha ? 'text' : 'password'}
                className="login-input"
                placeholder="Digite sua senha"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                disabled={carregando}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="login-password-toggle"
                onClick={() => setMostrarSenha(!mostrarSenha)}
                title={mostrarSenha ? 'Ocultar senha' : 'Exibir senha'}
                tabIndex={-1}
              >
                {mostrarSenha ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="login-submit-btn"
            disabled={carregando}
          >
            {carregando ? (
              <span className="login-btn-loading">
                <span className="login-spinner"></span>
                Autenticando...
              </span>
            ) : (
              <span className="login-btn-content">
                <LogIn size={18} />
                Entrar no Painel
              </span>
            )}
          </button>
        </form>

        {/* Rodapé Seguro */}
        <div className="login-card-footer">
          <ShieldCheck size={16} className="login-shield-icon" />
          <span>Acesso autenticado e monitorado • Base Google Sheets</span>
        </div>
      </div>
    </div>
  );
}
