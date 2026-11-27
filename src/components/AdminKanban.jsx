import React, { useEffect, useState } from 'react';
import { authFetch } from '../utils/apiAuth.js';
import {
  LayoutDashboard,
  Search,
  RefreshCw,
  Smartphone,
  ExternalLink,
  Copy,
  Check,
  FileText,
  Database,
  Award,
  Zap
} from 'lucide-react';

const ROTULO_REDE = { particular: 'Particular', estadual: 'Estadual', municipal: 'Municipal' };

const formatarData = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

export default function AdminKanban({ estatisticas, onUpdate }) {
  const [itens, setItens] = useState([]);
  const [criarDigital, setCriarDigital] = useState([]);
  const [statusOperacional, setStatusOperacional] = useState(null);
  const [integracao, setIntegracao] = useState(estatisticas?.integracao || null);
  const [certificacaoAutomatica, setCertificacaoAutomatica] = useState(
    Boolean(estatisticas?.configuracoes?.certificacaoAutomatica)
  );
  const [alterandoConfig, setAlterandoConfig] = useState(false);
  const [emitindoPorToken, setEmitindoPorToken] = useState({});
  const [ipLocal, setIpLocal] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [executandoRegua, setExecutandoRegua] = useState(false);
  const [enviandoWhatsPorToken, setEnviandoWhatsPorToken] = useState({});
  const [busca, setBusca] = useState('');
  const [filtroRapido, setFiltroRapido] = useState('todos');
  const [ordenacao, setOrdenacao] = useState('recentes');
  const [limitePorColuna, setLimitePorColuna] = useState({ entrada: 40, emitir: 40, emitidos: 40 });
  const [toast, setToast] = useState('');
  const [copiado, setCopiado] = useState(null);

  const carregar = async () => {
    setCarregando(true);
    try {
      const res = await authFetch('/api/solicitacoes');
      const json = await res.json();
      if (json.sucesso) {
        setItens(json.dados);
        setCriarDigital(json.criarDigital || []);
        setStatusOperacional(json.statusOperacional || null);
        if (json.integracao) setIntegracao(json.integracao);
        if (typeof json.configuracoes?.certificacaoAutomatica === 'boolean') {
          setCertificacaoAutomatica(json.configuracoes.certificacaoAutomatica);
        }
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
      const res = await authFetch('/api/sincronizar', { method: 'POST' });
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

  const alternarCertificacaoAutomatica = async () => {
    if (alterandoConfig) return;
    const novoValor = !certificacaoAutomatica;
    setAlterandoConfig(true);
    try {
      const res = await authFetch('/api/configuracoes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ certificacaoAutomatica: novoValor })
      });
      const json = await res.json();
      if (json.sucesso) {
        setCertificacaoAutomatica(Boolean(json.dados?.certificacaoAutomatica));
        mostrarToast(
          novoValor
            ? '⚡ Certificação automática ATIVADA!'
            : '⏸️ Certificação automática DESATIVADA — emissão manual pelo card.'
        );
        onUpdate?.();
      } else {
        mostrarToast(json.mensagem || 'Não foi possível alterar a configuração.');
      }
    } catch {
      mostrarToast('Falha ao atualizar o interruptor de certificação automática.');
    } finally {
      setAlterandoConfig(false);
    }
  };

  const emitirNoLyra = async (item) => {
    if (emitindoPorToken[item.token]) return;
    setEmitindoPorToken((prev) => ({ ...prev, [item.token]: true }));
    try {
      const res = await authFetch(`/api/solicitacoes/${item.token}/emitir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const json = await res.json();
      if (json.resposta) {
        setItens((prev) =>
          prev.map((it) => (it.token === item.token ? { ...it, resposta: json.resposta } : it))
        );
      }
      if (json.sucesso) {
        mostrarToast(`🎓 ${json.mensagem || `Certificado emitido para ${item.nome}!`}`);
        onUpdate?.();
      } else {
        mostrarToast(`⚠️ ${json.mensagem || 'Não foi possível concluir a emissão no Lyra.'}`);
      }
    } catch {
      mostrarToast('Falha na comunicação ao tentar emitir no Lyra.');
    } finally {
      setEmitindoPorToken((prev) => {
        const proximo = { ...prev };
        delete proximo[item.token];
        return proximo;
      });
    }
  };

  useEffect(() => { carregar(); }, []);

  const mostrarToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
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

  const enviarWhatsappIndividual = async (item) => {
    if (enviandoWhatsPorToken[item.token]) return;
    if (!window.confirm(`Enviar mensagem de WhatsApp via Zionic para ${item.nome}?`)) return;
    setEnviandoWhatsPorToken((prev) => ({ ...prev, [item.token]: true }));
    try {
      const res = await authFetch('/api/notificacoes/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: item.token, simular: false })
      });
      const json = await res.json();
      if (json.sucesso) {
        mostrarToast(
          json.simulado
            ? `📱 Disparo simulado para ${item.nome} (credenciais Zionic não ativas)`
            : `✅ WhatsApp enviado via Zionic para ${item.nome}!`
        );
      } else {
        mostrarToast(`⚠️ ${json.mensagem || 'Falha ao enviar WhatsApp.'}`);
      }
    } catch {
      mostrarToast('Falha na comunicação ao enviar WhatsApp.');
    } finally {
      setEnviandoWhatsPorToken((prev) => {
        const proximo = { ...prev };
        delete proximo[item.token];
        return proximo;
      });
    }
  };

  const executarReguaAgora = async () => {
    if (executandoRegua) return;
    if (!window.confirm('Deseja iniciar a Régua de WhatsApp agora (envio real com intervalo de 60s entre alunos)?')) return;
    setExecutandoRegua(true);
    try {
      const res = await authFetch('/api/regua/executar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const json = await res.json();
      mostrarToast(json.sucesso ? `🚀 ${json.mensagem}` : `⚠️ ${json.mensagem}`);
    } catch {
      mostrarToast('Falha ao iniciar a régua de WhatsApp.');
    } finally {
      setExecutandoRegua(false);
    }
  };

  const termo = busca.trim().toLowerCase();
  const digitos = busca.replace(/\D/g, '');
  const filtrados = itens
    .filter((i) => {
      const bateBusca =
        !termo ||
        i.nome.toLowerCase().includes(termo) ||
        (digitos && i.cpf.replace(/\D/g, '').includes(digitos)) ||
        (i.cursos && i.cursos.some((c) => String(c.curso || '').toLowerCase().includes(termo))) ||
        (i.resposta?.protocolo && String(i.resposta.protocolo).toLowerCase().includes(termo)) ||
        (i.resposta?.observacao && i.resposta.observacao.toLowerCase().includes(termo)) ||
        (i.resposta?.resumoCustomizacao && i.resposta.resumoCustomizacao.toLowerCase().includes(termo));

      if (!bateBusca) return false;

      if (filtroRapido === 'pendentes') {
        return i.status === 'EMITIR' && i.resposta?.emitidoNoLyra !== true;
      }
      if (filtroRapido === 'emitidos') {
        return i.status === 'EMITIR' && i.resposta?.emitidoNoLyra === true;
      }
      if (filtroRapido === 'customizados') {
        return Boolean(
          i.resposta?.resumoCustomizacao ||
          i.resposta?.periodosSugeridos?.some((p) => p.aceite === 'Não Aceito' || p.customizado)
        );
      }
      return true;
    })
    .sort((a, b) => {
      if (ordenacao === 'urgentes') {
        const ha = typeof a.horasRestantes96h === 'number' ? a.horasRestantes96h : 9999;
        const hb = typeof b.horasRestantes96h === 'number' ? b.horasRestantes96h : 9999;
        return ha - hb;
      }
      const da = String(a.dataReferencia || '');
      const db = String(b.dataReferencia || '');
      return ordenacao === 'antigos' ? da.localeCompare(db) : db.localeCompare(da);
    });

  const entrada = filtrados.filter((i) => i.status === 'ENTRADA');
  const emitir = filtrados.filter((i) => i.status === 'EMITIR' && i.resposta?.emitidoNoLyra !== true);
  const emitidos = filtrados.filter((i) => i.status === 'EMITIR' && i.resposta?.emitidoNoLyra === true);

  const carregarMais = (coluna) => {
    setLimitePorColuna((prev) => ({ ...prev, [coluna]: (prev[coluna] || 40) + 40 }));
  };

  const Card = ({ item }) => {
    const jaEmitidoLyra = item.resposta?.emitidoNoLyra === true;
    const agendadoAuto = item.resposta?.emissaoModo === 'AUTOMATICA_AGENDADA' && !jaEmitidoLyra;
    const aguardandoManual = Boolean(item.resposta?.aguardandoEmissaoManual) && !jaEmitidoLyra;
    const estaEmitindoEste = Boolean(emitindoPorToken[item.token]);

    return (
      <div className={`kanban-card ${item.status === 'EMITIR' ? 'card-completed' : ''}`}>
        <div className="card-top">
          <span className="card-cpf font-mono">{item.cpf}</span>
          {item.status === 'ENTRADA' ? (
            <span className="card-badge badge-pending">Aguardando aluno</span>
          ) : jaEmitidoLyra ? (
            <span className="card-badge badge-success">🎓 Emitido no Lyra</span>
          ) : agendadoAuto ? (
            <span className="card-badge badge-scheduled-emit" title="A emissão automática ocorrerá após 120 minutos do envio">
              ⏱️ Auto em 120 min
            </span>
          ) : aguardandoManual ? (
            <span className="card-badge badge-awaiting-emit">⏳ Aguardando emissão</span>
          ) : (
            <span className="card-badge badge-success">Respondido</span>
          )}
        </div>
        <h5 className="card-student-name">{item.nome}</h5>
        <div className="card-courses-summary">
          <span className="courses-count">
            {item.cursos.length} {item.cursos.length === 1 ? 'curso' : 'cursos'}
          </span>
          <span className="card-course-preview"> • solicitado em {formatarData(item.dataReferencia)}</span>
        </div>

        {item.tipoImpressoStatus && (
          <div className="card-impresso-badge-row">
            <span className={`impresso-pill ${item.tipoImpressoStatus === 'AGUARDANDO_PAGAMENTO' ? 'imp-pendente' : 'imp-ok'}`}>
              🖨️ {item.tipoImpressoStatus === 'AGUARDANDO_PAGAMENTO'
                ? 'Impresso: Aguardando Pagamento'
                : 'Impresso: Aprovado / Retirada'}
            </span>
          </div>
        )}

        {item.status === 'ENTRADA' && (
          <div className="card-whatsapp-meta">
            <span className="whats-pill">
              <Smartphone size={12} />
              {item.statusWhatsApp === 'D0_ENVIADO'
                ? 'D0 enviado'
                : String(item.statusWhatsApp || '').startsWith('LEMBRETE')
                  ? `Lembrete (${item.totalLembretesWhatsApp || 1})`
                  : item.statusWhatsApp === 'ALERTA_24H' || item.statusWhatsApp === 'ALERTA_2H'
                    ? 'Alerta últimas 24h'
                    : item.statusWhatsApp === 'EXPIRADO'
                      ? 'Aviso 96h enviado'
                      : item.statusWhatsApp
                        ? item.statusWhatsApp
                        : 'Aguardando 1º envio'}
            </span>
            {typeof item.horasRestantes96h === 'number' && (
              <span
                className={`prazo-pill ${item.horasRestantes96h <= 0
                  ? 'prazo-expirado'
                  : item.horasRestantes96h <= 24
                    ? 'prazo-urgente'
                    : 'prazo-ok'
                  }`}
                title={item.dataUltimoWhatsApp ? `Último envio: ${item.dataUltimoWhatsApp}` : undefined}
              >
                {item.horasRestantes96h <= 0 ? 'Prazo 96h vencido' : `Restam ${item.horasRestantes96h}h`}
              </span>
            )}
          </div>
        )}

        {item.resposta && (
          <div className="card-data-summary">
            <span>Protocolo: <code>{item.resposta.protocolo}</code></span>
            {item.resposta.bitrixCardId && (
              <span style={{ color: '#38bdf8', fontWeight: 600 }}>
                🔷 Bitrix24 SPA: #{item.resposta.bitrixCardId} ({item.resposta.bitrixStageId || ((item.resposta.temRevisao || item.resposta.periodosSugeridos?.some(p => p.aceite === 'Não Aceito' || p.customizado) || item.resposta.observacao) ? 'DT1046_76:PREPARATION' : 'DT1046_76:CLIENT')})
              </span>
            )}
            {!item.resposta.origemPlanilha && (
              <span>
                Professor:{' '}
                {item.resposta.professor
                  ? `Sim — ${item.resposta.rede === 'municipal'
                    ? item.resposta.prefeituraSP
                      ? 'Prefeitura de SP'
                      : 'Municipal (Outro Município)'
                    : ROTULO_REDE[item.resposta.rede]
                  }`
                  : 'Não'}
              </span>
            )}
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

            {item.resposta.periodosSugeridos?.length > 0 ? (
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
            ) : item.cursos?.length > 0 && (
              <div style={{ marginTop: 6, fontSize: '0.74rem', background: 'rgba(59, 130, 246, 0.08)', padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                <span style={{ fontWeight: 600, color: '#93c5fd', display: 'block', marginBottom: 2 }}>
                  📚 Cursos da Solicitação ({item.cursos.length}):
                </span>
                {item.cursos.map((c, idx) => (
                  <div key={idx} style={{ color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
                    <span>
                      • <strong>{c.curso}</strong> ({c.tipoCurso}{c.cargaHoraria ? ` • ${c.cargaHoraria}h` : ''})
                    </span>
                    {c.certificadora && <span style={{ color: '#94a3b8' }}>• {c.certificadora}</span>}
                    {c.statusLyra && (
                      <span style={{ color: '#93c5fd', background: 'rgba(59, 130, 246, 0.15)', padding: '1px 6px', borderRadius: 4, fontSize: '0.68rem' }}>
                        {c.statusLyra}
                      </span>
                    )}
                  </div>
                ))}
                {(item.telefone || item.dataNascimento) && (
                  <div style={{ color: '#94a3b8', marginTop: 4, fontSize: '0.7rem' }}>
                    {item.telefone ? `Tel: ${item.telefone}` : ''}
                    {item.telefone && item.dataNascimento ? ' • ' : ''}
                    {item.dataNascimento ? `Nasc: ${item.dataNascimento}` : ''}
                  </div>
                )}
              </div>
            )}

            {agendadoAuto && item.resposta?.emissaoAgendadaParaFormatada && (
              <div className="lyra-scheduled-box">
                ⏱️ Emissão automática agendada para <strong>{item.resposta.emissaoAgendadaParaFormatada}</strong> (janela de 120 min). Você pode antecipar clicando em <strong>Emitir</strong>.
              </div>
            )}

            {item.resposta.emissaoLyra?.length > 0 && (
              <div className="lyra-status-box">
                <span className="lyra-status-title">
                  🎓 Status Lyra ({item.resposta.emissaoLyra.filter((e) => e.ok).length}/{item.resposta.emissaoLyra.length}):
                </span>
                {item.resposta.emissaoLyra.map((em, idx) => (
                  <div key={idx} className={`lyra-status-row ${em.ok ? 'ok' : 'fail'}`}>
                    <span>• {em.curso}:</span>
                    {em.ok ? (
                      <strong>
                        Emitido{em.bookRegistry ? ` (Livro ${em.bookRegistry.book}, Reg. ${em.bookRegistry.registry})` : ''}
                      </strong>
                    ) : (
                      <strong>Pendente — {em.message || 'Erro ao emitir'}</strong>
                    )}
                  </div>
                ))}
                {item.resposta.emitidoEm && (
                  <div className="lyra-status-meta">
                    Concluído em {item.resposta.emitidoEm}
                    {item.resposta.emitidoPor ? ` • ${item.resposta.emitidoPor}` : ''}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="card-footer-actions">
          {item.status === 'ENTRADA' ? (
            <button
              type="button"
              className="btn-card-action"
              onClick={() => enviarWhatsappIndividual(item)}
              disabled={Boolean(enviandoWhatsPorToken[item.token])}
              title="Enviar link por WhatsApp via Zionic para este aluno"
            >
              <Smartphone size={14} /> {enviandoWhatsPorToken[item.token] ? 'Enviando...' : 'WhatsApp'}
            </button>
          ) : jaEmitidoLyra ? (
            <span className="badge-emitted-pill" title="Certificado já aprovado e emitido no Lyra">
              <Check size={13} /> Emitido
            </span>
          ) : (
            <button
              type="button"
              className="btn-card-emitir"
              onClick={() => emitirNoLyra(item)}
              disabled={estaEmitindoEste}
              title="Aprovar e emitir certificado no Lyra com os dados preenchidos pelo aluno"
            >
              {estaEmitindoEste ? (
                <>
                  <RefreshCw size={14} className="animate-spin" /> Emitindo...
                </>
              ) : (
                <>
                  <Award size={14} /> Emitir
                </>
              )}
            </button>
          )}
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
  };

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

            {statusOperacional && (
              <span
                className="live-pill"
                style={{ marginLeft: 8, background: 'rgba(59, 130, 246, 0.12)', color: '#93c5fd', borderColor: 'rgba(59, 130, 246, 0.3)' }}
                title="Status da Régua de WhatsApp (1h) no servidor"
              >
                {statusOperacional.reguaEmAndamento
                  ? '⏰ Régua 1h: Em execução...'
                  : statusOperacional.ultimaExecucaoRegua?.dataHora
                    ? `⏰ Régua: ${statusOperacional.ultimaExecucaoRegua.dataHora} (${statusOperacional.ultimaExecucaoRegua.enviados ?? 0} env.)`
                    : '⏰ Régua 1h: Ativa (aguardando 1º ciclo)'}
              </span>
            )}

            {statusOperacional?.fila120MinCount > 0 && (
              <span
                className="live-pill"
                style={{ marginLeft: 8, background: 'rgba(245, 158, 11, 0.14)', color: '#fcd34d', borderColor: 'rgba(245, 158, 11, 0.35)' }}
                title="Alunos aguardando emissão automática na janela de 120 minutos"
              >
                ⏱️ Fila 120 min: {statusOperacional.fila120MinCount}
              </span>
            )}
          </div>
          <h2 className="admin-title">Links individuais por aluno</h2>
          <p className="admin-sub">
            Cada aluno recebe um único link com as solicitações da janela de 96h. Ao responder, o card avança de
            ENTRADA para EMITIR.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-refresh"
            onClick={executarReguaAgora}
            disabled={executandoRegua}
            title="Iniciar rodada da Régua de WhatsApp agora"
          >
            <Smartphone size={16} />
            {executandoRegua ? 'Iniciando...' : 'Executar Régua'}
          </button>
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
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Solicitações na planilha</div>
          <div className="metric-value">{estatisticas?.totalSolicitacoes ?? '—'}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Links gerados</div>
          <div className="metric-value">{itens.length || estatisticas?.totalLinks || 0}</div>
        </div>
        <div className="metric-card border-amber">
          <div className="metric-label">Aguardando aluno</div>
          <div className="metric-value text-amber">
            {carregando ? (estatisticas?.totalPendentes ?? '—') : itens.filter((i) => i.status === 'ENTRADA').length}
          </div>
        </div>
        <div className="metric-card border-emerald">
          <div className="metric-label">Prontos para emitir</div>
          <div className="metric-value text-emerald">
            {carregando
              ? (estatisticas?.totalRespondidos ?? '—')
              : itens.filter((i) => i.status === 'EMITIR' && i.resposta?.emitidoNoLyra !== true).length}
          </div>
        </div>
        <div className="metric-card border-blue">
          <div className="metric-label">Emitidos</div>
          <div className="metric-value text-blue">
            {carregando
              ? '—'
              : itens.filter((i) => i.status === 'EMITIR' && i.resposta?.emitidoNoLyra === true).length}
          </div>
        </div>
      </div>

      <div className="admin-filters-bar">
        <div className="search-filter-box">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            className="filter-input"
            placeholder="Buscar por nome, CPF, curso ou protocolo..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        <select
          className="filter-select"
          value={ordenacao}
          onChange={(e) => setOrdenacao(e.target.value)}
          aria-label="Ordenar solicitações"
        >
          <option value="recentes">Mais recentes primeiro</option>
          <option value="antigos">Mais antigos primeiro</option>
          <option value="urgentes">Prazo 96h mais urgente</option>
        </select>

        <div
          className={`auto-cert-toggle-card ${certificacaoAutomatica ? 'is-active' : 'is-manual'}`}
          onClick={alternarCertificacaoAutomatica}
          role="switch"
          aria-checked={certificacaoAutomatica}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              alternarCertificacaoAutomatica();
            }
          }}
          title={
            certificacaoAutomatica
              ? 'Ativo: alunos preenchem o formulário e o certificado é emitido automaticamente no Lyra'
              : 'Desativado: é necessário clicar em "Emitir" no card do aluno na coluna EMITIR'
          }
        >
          <div className="auto-cert-info">
            <div className="auto-cert-title-row">
              <Zap size={15} className={certificacaoAutomatica ? 'icon-zap-on' : 'icon-zap-off'} />
              <span className="auto-cert-label">Certificação Automática</span>
              <span className={`auto-cert-pill ${certificacaoAutomatica ? 'pill-on' : 'pill-off'}`}>
                {certificacaoAutomatica ? 'ATIVA' : 'DESATIVADA'}
              </span>
            </div>
            <span className="auto-cert-desc">
              {certificacaoAutomatica
                ? 'Emite automaticamente no Lyra 120 min após o aluno enviar'
                : 'Requer clicar em "Emitir" no card da coluna EMITIR'}
            </span>
          </div>

          <button
            type="button"
            className={`toggle-switch-btn ${certificacaoAutomatica ? 'on' : 'off'}`}
            disabled={alterandoConfig}
            aria-label="Alternar certificação automática"
            onClick={(e) => {
              e.stopPropagation();
              alternarCertificacaoAutomatica();
            }}
          >
            <span className="toggle-switch-thumb" />
          </button>
        </div>
      </div>

      <div className="kanban-quick-filters" role="group" aria-label="Filtros rápidos">
        {[
          { id: 'todos', label: `Todos (${itens.length})` },
          { id: 'pendentes', label: `Pendentes de Emissão (${itens.filter((i) => i.status === 'EMITIR' && i.resposta?.emitidoNoLyra !== true).length})` },
          { id: 'emitidos', label: `Emitidos (${itens.filter((i) => i.status === 'EMITIR' && i.resposta?.emitidoNoLyra === true).length})` },
          { id: 'customizados', label: `Data Customizada (${itens.filter((i) => i.resposta?.resumoCustomizacao || i.resposta?.periodosSugeridos?.some((p) => p.aceite === 'Não Aceito' || p.customizado)).length})` }
        ].map((f) => (
          <button
            key={f.id}
            type="button"
            className={`quick-filter-pill ${filtroRapido === f.id ? 'active' : ''}`}
            onClick={() => setFiltroRapido(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {criarDigital.length > 0 && (
        <div className="criar-digital-banner animate-fade-in">
          <div className="criar-digital-banner-head">
            <strong>🖨️ Impressos aguardando criação manual do Digital no Lyra ({criarDigital.length})</strong>
          </div>
          <div className="criar-digital-banner-list">
            {criarDigital.map((cd, idx) => (
              <span key={idx} className="criar-digital-chip">
                <strong>{cd.nome}</strong> ({cd.cpf}) — {cd.curso} <em>[{cd.statusLyra || 'Pendente'}]</em>
              </span>
            ))}
          </div>
        </div>
      )}

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
              {entrada.slice(0, limitePorColuna.entrada).map((i) => <Card key={i.token} item={i} />)}
              {entrada.length > limitePorColuna.entrada && (
                <button type="button" className="btn-load-more" onClick={() => carregarMais('entrada')}>
                  Mostrar mais (+{Math.min(40, entrada.length - limitePorColuna.entrada)} de {entrada.length - limitePorColuna.entrada} restantes)
                </button>
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
                  <p>Nenhum aluno aguardando emissão.</p>
                  <span>Quando um aluno responder ao formulário, ele aparecerá aqui para emissão.</span>
                </div>
              ) : (
                emitir.slice(0, limitePorColuna.emitir).map((i) => <Card key={i.token} item={i} />)
              )}
              {emitir.length > limitePorColuna.emitir && (
                <button type="button" className="btn-load-more" onClick={() => carregarMais('emitir')}>
                  Mostrar mais (+{Math.min(40, emitir.length - limitePorColuna.emitir)} de {emitir.length - limitePorColuna.emitir} restantes)
                </button>
              )}
            </div>
          </div>

          <div className="kanban-column">
            <div className="column-header">
              <div className="col-title-row">
                <span className="col-indicator indicator-blue" />
                <h4>EMITIDOS</h4>
              </div>
              <span className="col-counter">{emitidos.length}</span>
            </div>
            <div className="kanban-cards-stack">
              {emitidos.length === 0 ? (
                <div className="kanban-empty-dropzone">
                  <Award size={32} />
                  <p>Nenhum certificado emitido ainda.</p>
                  <span>Os alunos aprovados no Lyra aparecem automaticamente aqui.</span>
                </div>
              ) : (
                emitidos.slice(0, limitePorColuna.emitidos).map((i) => <Card key={i.token} item={i} />)
              )}
              {emitidos.length > limitePorColuna.emitidos && (
                <button type="button" className="btn-load-more" onClick={() => carregarMais('emitidos')}>
                  Mostrar mais (+{Math.min(40, emitidos.length - limitePorColuna.emitidos)} de {emitidos.length - limitePorColuna.emitidos} restantes)
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
