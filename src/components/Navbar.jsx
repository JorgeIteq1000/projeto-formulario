import { Award, LayoutDashboard, Sparkles } from 'lucide-react';

export default function Navbar({ activeTab, setActiveTab, estatisticas }) {
  const respondidos = estatisticas?.totalRespondidos || 0;

  return (
    <header className="navbar-container">
      <div className="navbar-inner">
        <div className="navbar-brand">
          <div className="brand-icon-wrapper">
            <Award className="brand-icon" size={26} />
          </div>
          <div className="brand-text">
            <div className="brand-title">
              Certificados — Painel da Equipe
              <span className="live-pill">
                <span className="live-dot"></span>
                Protótipo
              </span>
            </div>
            <div className="brand-subtitle">Extensão & Aperfeiçoamento</div>
          </div>
        </div>

        <nav className="navbar-nav">
          <button
            type="button"
            className={`nav-btn ${activeTab === 'kanban' ? 'active' : ''}`}
            onClick={() => setActiveTab('kanban')}
          >
            <LayoutDashboard size={18} />
            <span>Gestão Bitrix24</span>
            {respondidos > 0 && <span className="nav-badge success">{respondidos} emitir</span>}
          </button>

          <button
            type="button"
            className={`nav-btn ${activeTab === 'guia' ? 'active' : ''}`}
            onClick={() => setActiveTab('guia')}
          >
            <Sparkles size={18} />
            <span>Fluxo da Automação</span>
          </button>
        </nav>
      </div>
    </header>
  );
}
