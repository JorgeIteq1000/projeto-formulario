import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Search,
  RefreshCw,
  Smartphone,
  ExternalLink,
  Copy,
  Check,
  FileText,
  Database
} from 'lucide-react';

const ROTULO_REDE = { particular: 'Particular', estadual: 'Estadual', municipal: 'Municipal' };

const formatarData = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

export default function AdminKanban({ estatisticas, onUpdate }) {
  const [itens, setItens] = useState([]);
  const [integracao, setIntegracao] = useState(estatisticas?.integracao || null);
  const [ipLocal, setIpLocal] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [busca, setBusca] = useState('');
  const [toast, setToast] = useState('');
  const [copiado, setCopiado] = useState(null);

  const carregar = async () => {
    setCarregando(true);
    try {
      const res = await fetch('/api/solicitacoes');
      const json = await res.json();
      if (json.sucesso) {
        setItens(json.dados);
        if (json.integracao) setIntegracao(json.integracao);
        if (json.ipLocal) setIpLocal(json.ipLocal);
      }
    } catch (err) {
      console.error('Erro ao listar solicitações:', err);
    } finally {
      setCarregando(false);
    }
  };

  const sincronizarBase = async () => {
    setSincronizando(true);
    try {
      const res = await fetch('/api/sincronizar', { method: 'POST' });
      const json = await res.json();
      if (json.sucesso) {
        mostrarToast(json.mensagem || 'Base sincronizada com sucesso!');
        await carregar();
        onUpdate?.();
      } else {
        mostrarToast('Erro ao sincronizar: ' + json.mensagem);
      }
    } catch {
      mostrarToast('Falha na comunicação com o servidor.');
    } finally {
      setSincronizando(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  const mostrarToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  const obterLinkCompleto = (item) => {
    // Se o backend configurou domínio de produção, usa ele
    if (item.link && item.link.startsWith('http') && !item.link.includes('localhost') && !item.link.includes('127.0.0.1')) {
      return item.link;
    }
    // Se estiver rodando em rede local (IP) ou localhost, usa o origin do navegador
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/solicitacoes/${item.token}`;
    }
    return item.link;
  };

  const copiarLink = async (item) => {
    const url = obterLinkCompleto(item);
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(item.token);
      setTimeout(() => setCopiado(null), 2000);
      mostrarToast('Link copiado com sucesso!');
    } catch {
      mostrarToast('Não foi possível copiar o link.');
    }
  };

  const simularWhatsapp = async (item) => {
    try {
      const res = await fetch('/api/notificacoes/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: item.token })
      });
      const json = await res.json();
      mostrarToast(json.sucesso ? `📱 Link enviado (simulado) para ${item.nome}` : json.mensagem);
    } catch {
      mostrarToast('Falha ao simular disparo.');
    }
  };

  const termo = busca.trim().toLowerCase();
  const digitos = busca.replace(/\D/g, '');
  const filtrados = itens.filter((i) =>
    !termo ||
    i.nome.toLowerCase().includes(termo) ||
    (digitos && i.cpf.replace(/\D/g, '').includes(digitos)) ||
    (i.resposta?.observacao && i.resposta.observacao.toLowerCase().includes(termo)) ||
    (i.resposta?.resumoCustomizacao && i.resposta.resumoCustomizacao.toLowerCase().includes(termo))
  );

  const entrada = filtrados.filter((i) => i.status === 'ENTRADA');
  const emitir = filtrados.filter((i) => i.status === 'EMITIR');
  const LIMITE = 40;

  const Card = ({ item }) => (
    <div className={`kanban-card ${item.status === 'EMITIR' ? 'card-completed' : ''}`}>
      <div className="card-top">
        <span className="card-cpf font-mono">{item.cpf}</span>
        <span className={`card-badge ${item.status === 'EMITIR' ? 'badge-success' : 'badge-pending'}`}>
          {item.status === 'EMITIR' ? 'Respondido' : 'Aguardando aluno'}
        </span>
      </div>
      <h5 className="card-student-name">{item.nome}</h5>
      <div className="card-courses-summary">
        <span className="courses-count">
          {item.cursos.length} {item.cursos.length === 1 ? 'curso' : 'cursos'}
        </span>
        <span className="card-course-preview"> • solicitado em {formatarData(item.dataReferencia)}</span>
      </div>

      {item.resposta && (
        <div className="card-data-summary">
          <span>Protocolo: <code>{item.resposta.protocolo}</code></span>
          {item.resposta.bitrixCardId && (
            <span style={{ color: '#38bdf8', fontWeight: 600 }}>
              🔷 Bitrix24 SPA: #{item.resposta.bitrixCardId} ({item.resposta.bitrixStageId || ((item.resposta.temRevisao || item.resposta.periodosSugeridos?.some(p => p.aceite === 'Não Aceito' || p.customizado) || item.resposta.observacao) ? 'DT1046_76:PREPARATION' : 'DT1046_76:CLIENT')})
            </span>
          )}
          <span>
            Professor:{' '}
            {item.resposta.professor
              ? `Sim — ${
                  item.resposta.rede === 'municipal'
                    ? item.resposta.prefeituraSP
                      ? 'Prefeitura de SP'
                      : 'Municipal (Outro Município)'
                    : ROTULO_REDE[item.resposta.rede]
                }`
              : 'Não'}
          </span>
          {item.resposta.dataEvolucao && (
            <span>Última evolução: {formatarData(item.resposta.dataEvolucao)}</span>
          )}

          {item.resposta.observacao && (
            <div className="card-obs-alert">
              <strong>⚠️ Observação do Aluno:</strong>
              <span>{item.resposta.observacao}</span>
            </div>
          )}

          {item.resposta.resumoCustomizacao && (
            <div className="card-obs-alert" style={{ borderColor: 'rgba(245, 158, 11, 0.4)', background: 'rgba(245, 158, 11, 0.08)' }}>
              <strong style={{ color: '#fbbf24' }}>✏️ Revisão de Datas Solicitada:</strong>
              <span style={{ whiteSpace: 'pre-line', color: '#fde68a' }}>{item.resposta.resumoCustomizacao}</span>
            </div>
          )}

          {item.resposta.periodosSugeridos?.length > 0 && (
            <div style={{ marginTop: 6, fontSize: '0.74rem', background: 'rgba(59, 130, 246, 0.08)', padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(59, 130, 246, 0.2)' }}>
              <span style={{ fontWeight: 600, color: '#93c5fd', display: 'block', marginBottom: 2 }}>
                📅 Períodos Sugeridos ({item.resposta.periodosSugeridos.length}):
              </span>
              {item.resposta.periodosSugeridos.map((p, idx) => (
                <div key={idx} style={{ color: p.ultrapassaHoje ? '#f87171' : '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
                  <span>• {p.curso}: <strong>{p.dataInicioFormatada} a {p.dataFimFormatada}</strong></span>
                  {p.ultrapassaHoje ? (
                    <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.7rem' }}>
                      [CANCELADO - DATA FUTURA]
                    </span>
                  ) : (p.aceite === 'Não Aceito' || p.customizado) ? (
                    <span style={{ color: '#fbbf24', background: 'rgba(245, 158, 11, 0.15)', padding: '1px 6px', borderRadius: 4, fontWeight: 700, fontSize: '0.68rem', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                      ✏️ Data Customizada: {p.dataInicioCustomizadaFormatada || p.dataInicioFormatada} a {p.dataFimCustomizadaFormatada || p.dataFimFormatada}
                    </span>
                  ) : (
                    <span style={{ color: '#4ade80', background: 'rgba(34, 197, 94, 0.15)', padding: '1px 6px', borderRadius: 4, fontWeight: 700, fontSize: '0.68rem', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                      ✓ Aceito
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card-footer-actions">
        {item.status === 'ENTRADA' ? (
          <button type="button" className="btn-card-action" onClick={() => simularWhatsapp(item)}>
            <Smartphone size={14} /> WhatsApp
          </button>
        ) : <span />}
        <div className="card-actions-right">
          <button type="button" className="btn-card-action" onClick={() => copiarLink(item)} title="Copiar link">
            {copiado === item.token ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <a className="btn-card-primary" href={`/solicitacoes/${item.token}`} target="_blank" rel="noreferrer">
            Abrir link <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </div>
  );

  return (
    <div className="admin-kanban-container">
      {toast && <div className="toast-notification animate-fade-in">{toast}</div>}

      <div className="admin-header-row">
        <div>
          <div className="admin-tag-pipeline">
            <LayoutDashboard size={16} /> Pipeline Bitrix24 • Núcleo Extensões
            {integracao?.fonte === 'google_sheets' ? (
              <span className="live-pill" style={{ marginLeft: 8, background: '#ecfdf5', color: '#059669', borderColor: '#a7f3d0' }}>
                <Database size={13} style={{ marginRight: 4 }} /> Google Sheets Ativo
              </span>
            ) : (
              <span className="live-pill" style={{ marginLeft: 8, background: '#fef3c7', color: '#b45309', borderColor: '#fde68a' }}>
                <Database size={13} style={{ marginRight: 4 }} /> Base Piloto (Local)
              </span>
            )}

            {ipLocal && ipLocal !== 'localhost' && (
              <span className="live-pill" style={{ marginLeft: 8, background: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe' }} title="IP da máquina para acessar de outro computador na mesma rede Wi-Fi/LAN">
                <Smartphone size={13} style={{ marginRight: 4 }} /> IP Rede: http://{ipLocal}:{window.location.port || '5180'}
              </span>
            )}
          </div>
          <h2 className="admin-title">Links individuais por aluno</h2>
          <p className="admin-sub">
            Cada aluno recebe um único link com as solicitações das últimas 24h. Ao responder, o card avança de
            ENTRADA para EMITIR.
          </p>
        </div>
        <button
          type="button"
          className="btn-refresh"
          onClick={sincronizarBase}
          disabled={sincronizando}
          title="Recarregar dados da planilha ou base local"
        >
          <RefreshCw size={16} className={sincronizando ? 'animate-spin' : ''} />
          {sincronizando ? 'Sincronizando...' : 'Sincronizar'}
        </button>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Solicitações na planilha</div>
          <div className="metric-value">{estatisticas?.totalSolicitacoes ?? '—'}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Links gerados</div>
          <div className="metric-value">{estatisticas?.totalLinks ?? '—'}</div>
        </div>
        <div className="metric-card border-amber">
          <div className="metric-label">Aguardando aluno</div>
          <div className="metric-value text-amber">{estatisticas?.totalPendentes ?? '—'}</div>
        </div>
        <div className="metric-card border-emerald">
          <div className="metric-label">Prontos para emitir</div>
          <div className="metric-value text-emerald">{estatisticas?.totalRespondidos ?? '—'}</div>
        </div>
      </div>

      <div className="admin-filters-bar">
        <div className="search-filter-box">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            className="filter-input"
            placeholder="Buscar por nome ou CPF..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      {carregando ? (
        <p className="sf-muted">Carregando...</p>
      ) : (
        <div className="kanban-board">
          <div className="kanban-column">
            <div className="column-header">
              <div className="col-title-row">
                <span className="col-indicator indicator-amber" />
                <h4>ENTRADA</h4>
              </div>
              <span className="col-counter">{entrada.length}</span>
            </div>
            <div className="kanban-cards-stack">
              {entrada.slice(0, LIMITE).map((i) => <Card key={i.token} item={i} />)}
              {entrada.length > LIMITE && (
                <div className="cards-more-note">+{entrada.length - LIMITE} — use a busca para filtrar.</div>
              )}
            </div>
          </div>

          <div className="kanban-column">
            <div className="column-header">
              <div className="col-title-row">
                <span className="col-indicator indicator-emerald" />
                <h4>EMITIR</h4>
              </div>
              <span className="col-counter">{emitir.length}</span>
            </div>
            <div className="kanban-cards-stack">
              {emitir.length === 0 ? (
                <div className="kanban-empty-dropzone">
                  <FileText size={32} />
                  <p>Nenhum aluno respondeu ainda.</p>
                  <span>Clique em “Abrir link” em um card de ENTRADA para testar como aluno.</span>
                </div>
              ) : (
                emitir.map((i) => <Card key={i.token} item={i} />)
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
