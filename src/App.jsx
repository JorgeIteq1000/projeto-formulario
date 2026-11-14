import React, { useEffect, useState } from 'react';
import { Award } from 'lucide-react';
import Navbar from './components/Navbar';
import StudentForm from './components/StudentForm';
import AdminKanban from './components/AdminKanban';
import AutomationGuide from './components/AutomationGuide';
import LoginView from './components/LoginView';
import { obterToken, obterUsuario, limparSessao, authFetch } from './utils/apiAuth.js';

// Suporte a token via rota /solicitacoes/:token ou query param ?t=...
function extrairToken() {
  if (typeof window === 'undefined') return null;

  // 1. Rota amigável /solicitacoes/:token ou /solicitacao/:token
  const match = window.location.pathname.match(/\/(?:solicitacoes|solicitacao)\/([^/?#]+)/i);
  if (match && match[1]) {
    return decodeURIComponent(match[1]);
  }

  // 2. Query param tradicional ?t=... ou ?token=...
  const params = new URLSearchParams(window.location.search);
  return params.get('t') || params.get('token') || null;
}

function StudentView({ token }) {
  return (
    <div className="app-container">
      <header className="sf-topbar">
        <div className="brand-icon-wrapper">
          <Award size={22} />
        </div>
        <div className="brand-text">
          <div className="brand-title">Certificados</div>
          <div className="brand-subtitle">Extensão & Aperfeiçoamento</div>
        </div>
      </header>
      <main className="main-content sf-main">
        <StudentForm token={token} />
      </main>
    </div>
  );
}

function TeamView({ usuario, onLogout }) {
  const [activeTab, setActiveTab] = useState('kanban'); // 'kanban' | 'guia'
  const [estatisticas, setEstatisticas] = useState(null);

  const fetchEstatisticas = async () => {
    try {
      const res = await authFetch('/api/estatisticas');
      const data = await res.json();
      if (data.sucesso) setEstatisticas(data.dados);
    } catch (err) {
      console.error('Erro ao buscar estatísticas:', err);
    }
  };

  useEffect(() => {
    fetchEstatisticas();
  }, []);

  return (
    <div className="app-container">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        estatisticas={estatisticas}
        usuario={usuario}
        onLogout={onLogout}
      />
      <main className="main-content">
        {activeTab === 'kanban' && <AdminKanban estatisticas={estatisticas} onUpdate={fetchEstatisticas} />}
        {activeTab === 'guia' && <AutomationGuide />}
      </main>
      <footer className="footer-app">
        <div className="footer-inner">
          <span className="footer-badge">Automação de Certificados • Piloto - Feito por: Jorge Augusto</span>
          <span>Google Sheets • Hostinger • WhatsApp (Zionic) • Bitrix24 CRM</span>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  const [tokenAluno, setTokenAluno] = useState(() => extrairToken());
  const [usuarioLogado, setUsuarioLogado] = useState(() => obterUsuario());
  const [verificandoSessao, setVerificandoSessao] = useState(() => Boolean(obterToken()));

  // Monitorar mudanças na URL / rota do aluno
  useEffect(() => {
    const handlePopState = () => setTokenAluno(extrairToken());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Monitorar desautenticação global (ex: token expirado em chamadas da API)
  useEffect(() => {
    const handleUnauthorized = () => {
      setUsuarioLogado(null);
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  // Validação silenciosa do token ao carregar a página da equipe
  useEffect(() => {
    const token = obterToken();
    if (!token) {
      setVerificandoSessao(false);
      return;
    }

    authFetch('/api/auth/me')
      .then(async (res) => {
        if (res.ok) {
          const json = await res.json();
          if (json.sucesso && json.usuario) {
            setUsuarioLogado(json.usuario);
          } else {
            limparSessao();
            setUsuarioLogado(null);
          }
        } else {
          limparSessao();
          setUsuarioLogado(null);
        }
      })
      .catch(() => {
        // Mantém o usuário do storage em caso de instabilidade pontual
      })
      .finally(() => {
        setVerificandoSessao(false);
      });
  }, []);

  const handleLogout = async () => {
    try {
      await authFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignora erro de rede no logout
    }
    limparSessao();
    setUsuarioLogado(null);
  };

  // 1. Rota de Aluno: 100% pública e sem login
  if (tokenAluno) {
    return <StudentView token={tokenAluno} />;
  }

  // 2. Verificação de sessão existente
  if (verificandoSessao) {
    return (
      <div className="login-screen-wrapper">
        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          <div className="login-spinner" style={{ width: 28, height: 28, margin: '0 auto 12px' }}></div>
          <p style={{ fontSize: '0.9rem' }}>Verificando credenciais...</p>
        </div>
      </div>
    );
  }

  // 3. Rota de Equipe: Se não autenticado, exibe tela de login
  if (!usuarioLogado) {
    return <LoginView onLoginSuccess={(user) => setUsuarioLogado(user)} />;
  }

  // 4. Rota de Equipe: Autenticado
  return <TeamView usuario={usuarioLogado} onLogout={handleLogout} />;
}
