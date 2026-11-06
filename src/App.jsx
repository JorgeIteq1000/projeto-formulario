import React, { useEffect, useState } from 'react';
import { Award } from 'lucide-react';
import Navbar from './components/Navbar';
import StudentForm from './components/StudentForm';
import AdminKanban from './components/AdminKanban';
import AutomationGuide from './components/AutomationGuide';

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

function TeamView() {
  const [activeTab, setActiveTab] = useState('kanban'); // 'kanban' | 'guia'
  const [estatisticas, setEstatisticas] = useState(null);

  const fetchEstatisticas = async () => {
    try {
      const res = await fetch('/api/estatisticas');
      const data = await res.json();
      if (data.sucesso) setEstatisticas(data.dados);
    } catch (err) {
      console.error('Erro ao buscar estatísticas:', err);
    }
  };

  useEffect(() => { fetchEstatisticas(); }, []);

  return (
    <div className="app-container">
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} estatisticas={estatisticas} />
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

  useEffect(() => {
    const handlePopState = () => setTokenAluno(extrairToken());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return tokenAluno ? <StudentView token={tokenAluno} /> : <TeamView />;
}
