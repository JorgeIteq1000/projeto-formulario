import React, { useEffect, useState, useMemo } from 'react';
import {
  User,
  CreditCard,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  XCircle,
  Send,
  ShieldCheck,
  Calendar,
  GraduationCap,
  CalendarRange,
  Clock,
  IdCard,
  MapPin
} from 'lucide-react';
import {
  gerarSugestoesPeriodos,
  formatDateBR,
  parseDate,
  validarDataEvolucao17Meses,
  validarDataConclusao
} from '../utils/dateSuggestions.js';

const NAO_INFORMADO = 'Não informado';

// "Extensão • 45h" — a planilha pode trazer a carga como "45", "45h" ou "45 horas"
function formatarTipoComCarga(curso) {
  const tipo = curso.tipoCurso || 'Extensão';
  const carga = String(curso.cargaHoraria || '').trim();
  if (!carga) return tipo;
  return /^\d+$/.test(carga) ? `${tipo} • ${carga}h` : `${tipo} • ${carga}`;
}

export default function StudentForm({ token }) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [dados, setDados] = useState(null);

  // Profissional da Educação que atua na Rede Municipal de ensino: null | true | false
  const [professor, setProfessor] = useState(null);
  const [dataEvolucao, setDataEvolucao] = useState('');
  const [aceitesCursos, setAceitesCursos] = useState({});
  const [confirmacao, setConfirmacao] = useState(false);

  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState('');
  const [sucesso, setSucesso] = useState(null);

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const res = await fetch(`/api/link/${encodeURIComponent(token)}`);
        const json = await res.json();
        if (!ativo) return;
        if (!res.ok || !json.sucesso) {
          setErro(json.mensagem || 'Link inválido ou expirado.');
        } else {
          setDados(json.dados);
          if (json.dados.jaRespondido) {
            setSucesso({ protocolo: json.dados.protocolo, respondidoEm: json.dados.respondidoEm });
          }
        }
      } catch {
        if (ativo) setErro('Não foi possível conectar ao servidor. Tente novamente em instantes.');
      } finally {
        if (ativo) setCarregando(false);
      }
    })();
    return () => { ativo = false; };
  }, [token]);

  // Regra condicional: ao responder "Não", limpa a data de evolução
  const escolherProfessor = (valor) => {
    setProfessor(valor);
    if (!valor) {
      setDataEvolucao('');
      setAceitesCursos({});
    }
  };

  const hoje = new Date().toISOString().slice(0, 10);

  // Valida a data de evolução funcional com limite retroativo de 17 meses
  const validacaoEvolucao = useMemo(() => {
    if (!dataEvolucao || !/^\d{4}-\d{2}-\d{2}$/.test(dataEvolucao)) {
      return { valida: true, erro: null, limite17MesesISO: '' };
    }
    return validarDataEvolucao17Meses(dataEvolucao);
  }, [dataEvolucao]);

  // Calcula dinamicamente as sugestões de datas sequenciais quando houver data de evolução válida
  const periodosSugeridos = useMemo(() => {
    if (!dataEvolucao || !dados?.cursos?.length) return [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataEvolucao)) return [];
    if (!validacaoEvolucao.valida) return [];
    return gerarSugestoesPeriodos(dataEvolucao, dados.cursos);
  }, [dataEvolucao, dados?.cursos, validacaoEvolucao.valida]);

  // Duração (em meses) do período do curso, conforme a carga horária
  const mesesDoCurso = (indice) => periodosSugeridos.find((p) => p.indice === indice)?.mesesPeriodo || 1;

  // Handlers para aceite individual e datas customizadas
  const escolherAceite = (indice, novoAceite) => {
    setAceitesCursos((prev) => {
      const atual = prev[indice] || {};
      if (novoAceite === 'Aceito') {
        return {
          ...prev,
          [indice]: {
            ...atual,
            aceite: 'Aceito',
            erro: null
          }
        };
      }
      const dataStr = atual.dataConclusao || '';
      const val = dataStr ? validarDataConclusao(dataStr, new Date(), mesesDoCurso(indice)) : { valida: false, erro: 'Informe a data de conclusão.' };
      return {
        ...prev,
        [indice]: {
          ...atual,
          aceite: 'Não Aceito',
          dataConclusao: dataStr,
          valida: val.valida,
          erro: val.erro,
          dataInicioISO: val.dataInicioISO,
          dataFimISO: val.dataFimISO,
          dataInicioFormatada: val.dataInicioFormatada,
          dataFimFormatada: val.dataFimFormatada
        }
      };
    });
  };

  const escolherDataConclusao = (indice, dataStr) => {
    const val = validarDataConclusao(dataStr, new Date(), mesesDoCurso(indice));
    setAceitesCursos((prev) => ({
      ...prev,
      [indice]: {
        ...(prev[indice] || {}),
        aceite: 'Não Aceito',
        dataConclusao: dataStr,
        valida: val.valida,
        erro: val.erro,
        dataInicioISO: val.dataInicioISO,
        dataFimISO: val.dataFimISO,
        dataInicioFormatada: val.dataInicioFormatada,
        dataFimFormatada: val.dataFimFormatada
      }
    }));
  };

  // Consolida os períodos sugeridos com as opções de aceite do aluno
  const periodosProcessados = useMemo(() => {
    return periodosSugeridos.map((p) => {
      const conf = aceitesCursos[p.indice] || {};
      const isNaoAceito = conf.aceite === 'Não Aceito';
      if (isNaoAceito) {
        const customValida = Boolean(conf.valida);
        const ultrapassaHoje = customValida
          ? false
          : Boolean(conf.erro && conf.erro.includes('ultrapassa'));
        return {
          ...p,
          aceite: 'Não Aceito',
          customizado: true,
          dataInicio: customValida && conf.dataInicioISO ? conf.dataInicioISO : p.dataInicio,
          dataFim: customValida && conf.dataFimISO ? conf.dataFimISO : p.dataFim,
          dataInicioFormatada: customValida && conf.dataInicioFormatada ? conf.dataInicioFormatada : p.dataInicioFormatada,
          dataFimFormatada: customValida && conf.dataFimFormatada ? conf.dataFimFormatada : p.dataFimFormatada,
          dataInicioCustomizada: conf.dataInicioISO || null,
          dataFimCustomizada: conf.dataFimISO || null,
          dataInicioCustomizadaFormatada: conf.dataInicioFormatada || null,
          dataFimCustomizadaFormatada: conf.dataFimFormatada || null,
          cancelado: !customValida,
          ultrapassaHoje,
          status: customValida ? 'CUSTOMIZADO' : 'INVALIDO'
        };
      }
      return {
        ...p,
        aceite: 'Aceito',
        customizado: false,
        dataInicioCustomizada: null,
        dataFimCustomizada: null,
        dataInicioCustomizadaFormatada: null,
        dataFimCustomizadaFormatada: null,
        cancelado: Boolean(p.cancelado),
        ultrapassaHoje: Boolean(p.ultrapassaHoje),
        status: p.ultrapassaHoje ? 'CANCELADO_DATA_FUTURA' : 'APROVADO'
      };
    });
  }, [periodosSugeridos, aceitesCursos]);

  // Cursos válidos (exclui os cancelados por ultrapassarem a data atual ou com dados inválidos)
  const cursosValidos = useMemo(() => {
    return periodosProcessados.filter((p) => !p.cancelado && !p.ultrapassaHoje);
  }, [periodosProcessados]);

  // Se todas as extensões ultrapassam a data atual ou possuem dados inválidos, o formulário não pode ser enviado
  const todosCancelados = periodosProcessados.length > 0 && cursosValidos.length === 0;

  // Validação: todos os cursos marcados como "Não Aceito" devem possuir uma data customizada válida
  const customizacoesValidas = useMemo(() => {
    for (const p of periodosSugeridos) {
      const conf = aceitesCursos[p.indice];
      if (conf?.aceite === 'Não Aceito') {
        if (!conf.valida) return false;
      }
    }
    return true;
  }, [periodosSugeridos, aceitesCursos]);

  // Validação: se atua na Rede Municipal, a data da última evolução é OBRIGATÓRIA
  // e deve respeitar o limite de 17 meses retroativos
  const formularioValido =
    professor !== null &&
    (professor === false || Boolean(dataEvolucao)) &&
    validacaoEvolucao.valida &&
    customizacoesValidas &&
    !todosCancelados &&
    confirmacao;

  const enviar = async (e) => {
    e.preventDefault();
    if (!formularioValido) return;

    setEnviando(true);
    setErroEnvio('');
    try {
      const periodosSugeridosPayload = periodosProcessados.map((p) => ({
        indice: p.indice,
        curso: p.curso,
        tipoCurso: p.tipoCurso || 'Extensão',
        certificadora: p.certificadora,
        contrato: p.contrato,
        cargaHoraria: p.cargaHoraria || '',
        cargaConsiderada: p.cargaConsiderada,
        cargaEstimada: Boolean(p.cargaEstimada),
        mesesPeriodo: p.mesesPeriodo,
        aceite: p.aceite,
        dataInicio: p.dataInicio,
        dataFim: p.dataFim,
        dataInicioFormatada: p.dataInicioFormatada,
        dataFimFormatada: p.dataFimFormatada,
        dataInicioCustomizada: p.aceite === 'Não Aceito' ? (p.dataInicioCustomizada || null) : null,
        dataFimCustomizada: p.aceite === 'Não Aceito' ? (p.dataFimCustomizada || null) : null,
        dataInicioCustomizadaFormatada: p.aceite === 'Não Aceito' ? (p.dataInicioCustomizadaFormatada || null) : null,
        dataFimCustomizadaFormatada: p.aceite === 'Não Aceito' ? (p.dataFimCustomizadaFormatada || null) : null,
        customizado: p.aceite === 'Não Aceito',
        cancelado: Boolean(p.cancelado),
        ultrapassaHoje: Boolean(p.ultrapassaHoje)
      }));

      const res = await fetch(`/api/link/${encodeURIComponent(token)}/resposta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          professor,
          // A pergunta única já confirma a atuação na Rede Municipal; mantém o contrato aceito pelo backend
          rede: professor ? 'municipal' : null,
          prefeituraSP: professor ? true : null,
          dataEvolucao: professor && dataEvolucao ? dataEvolucao : null,
          observacao: null,
          periodosSugeridos: periodosSugeridosPayload,
          confirmacao
        })
      });
      const json = await res.json();
      if (!res.ok || !json.sucesso) {
        setErroEnvio(json.mensagem || 'Não foi possível enviar. Tente novamente.');
      } else {
        setSucesso({ protocolo: json.protocolo, respondidoEm: json.respondidoEm });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch {
      setErroEnvio('Falha de conexão. Verifique sua internet e tente novamente.');
    } finally {
      setEnviando(false);
    }
  };

  // ---------- Estados de tela ----------
  if (carregando) {
    return (
      <div className="sf-card sf-center">
        <div className="spinner-sm spinner-lg" />
        <p className="sf-muted">Carregando sua solicitação...</p>
      </div>
    );
  }

  if (erro) {
    return (
      <div className="sf-card sf-center">
        <AlertCircle size={44} className="text-rose" />
        <h2 className="sf-title">Link indisponível</h2>
        <p className="sf-muted">{erro}</p>
        <p className="sf-muted sf-small">
          Caso precise, abra uma nova solicitação pela Área do Aluno.
        </p>
      </div>
    );
  }

  if (sucesso) {
    return (
      <div className="sf-card sf-center animate-fade-in">
        <div className="success-badge-icon">
          <CheckCircle2 size={48} className="text-emerald" />
        </div>
        <h2 className="sf-title">Tudo certo, {dados.nome.split(' ')[0]}!</h2>
        <p className="sf-muted">
          Recebemos suas informações. Seu certificado seguiu para emissão e você será avisado(a) pelo WhatsApp.
        </p>
        <div className="protocol-showcase-box">
          <div className="protocol-label">Protocolo</div>
          <div className="protocol-code">{sucesso.protocolo}</div>
          {sucesso.respondidoEm && <div className="protocol-time">Enviado em {sucesso.respondidoEm}</div>}
        </div>
      </div>
    );
  }

  // ---------- Formulário ----------
  return (
    <form className="sf-wrapper animate-fade-in" onSubmit={enviar}>
      <header className="sf-card sf-header">
        <span className="security-badge">
          <ShieldCheck size={14} /> Link individual e seguro
        </span>
        <h1 className="sf-title-lg">Confirmação para emissão do certificado</h1>
        <p className="sf-muted">Leva menos de 1 minuto. Confira seus dados e responda às perguntas abaixo.</p>
      </header>

      {/* Dados do aluno (somente leitura) */}
      <section className="sf-card">
        <h2 className="sf-section-title">Seus dados</h2>
        <div className="sf-readonly-grid">
          <div className="sf-readonly">
            <User size={18} />
            <div>
              <span className="sf-label">Nome</span>
              <strong>{dados.nome}</strong>
            </div>
          </div>
          <div className="sf-readonly">
            <CreditCard size={18} />
            <div>
              <span className="sf-label">CPF</span>
              <strong className="font-mono">{dados.cpf}</strong>
            </div>
          </div>
          <div className="sf-readonly">
            <Calendar size={18} />
            <div>
              <span className="sf-label">Data de Nascimento</span>
              <strong>{dados.dataNascimento || NAO_INFORMADO}</strong>
            </div>
          </div>
          <div className="sf-readonly">
            <IdCard size={18} />
            <div>
              <span className="sf-label">RG</span>
              <strong className="font-mono">{dados.rg || NAO_INFORMADO}</strong>
            </div>
          </div>
          <div className="sf-readonly">
            <MapPin size={18} />
            <div>
              <span className="sf-label">Naturalidade</span>
              <strong>{dados.naturalidade || NAO_INFORMADO}</strong>
            </div>
          </div>
        </div>

        {/* Aviso Institucional de Atualização Cadastral e Prazo de 96 Horas (logo abaixo dos dados pessoais) */}
        <div className="sf-notice-card" style={{ marginTop: 14, padding: '14px 16px', borderRadius: 10, borderLeft: '4px solid #f59e0b', background: 'rgba(245, 158, 11, 0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <AlertTriangle size={20} className="text-amber" />
            <h2 className="sf-section-title" style={{ margin: 0, fontSize: '1.05rem', color: '#fef3c7' }}>
              Aviso Importante sobre Atualização Cadastral e Prazo
            </h2>
          </div>
          <p style={{ color: '#cbd5e1', fontSize: '0.875rem', lineHeight: 1.6, margin: 0 }}>
            Caso seja necessário atualização ou correção de algum dado pessoal, é necessário que primeiro seja realizada a atualização dentro da sua área do aluno, pois após o envio deste formulário, as informações serão processadas conforme consta em sistema. Os dados devem ser atualizados exclusivamente na área do aluno, aba "Meus Dados". A falta de finalização do formulário em <strong>96hr</strong>, ocasionará o cancelamento da solicitação, devendo o aluno, abrir uma nova solicitação dentro da área do aluno.
          </p>
        </div>

        <h3 className="sf-subtitle">
          <BookOpen size={16} />
          {dados.cursos.length === 1 ? 'Curso solicitado' : `Cursos solicitados (${dados.cursos.length})`}
        </h3>
        <ul className="sf-course-list">
          {dados.cursos.map((c) => (
            <li key={c.contrato} className="sf-course">
              <span className={`badge-pill ${c.tipoCurso === 'Aperfeiçoamento' ? 'badge-purple' : 'badge-blue'}`}>
                {formatarTipoComCarga(c)}
              </span>
              <strong>{c.curso}</strong>
              <span className="sf-muted sf-small">{c.certificadora}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Pergunta única: profissional da Educação na Rede Municipal? */}
      <section className="sf-card">
        <h2 className="sf-section-title">
          <GraduationCap size={18} /> Você é profissional da área da Educação e atua na Rede Municipal de ensino?
        </h2>
        <div className="sf-options sf-options-2" role="radiogroup">
          {[
            { v: true, t: 'Sim' },
            { v: false, t: 'Não' }
          ].map((op) => (
            <button
              key={String(op.v)}
              type="button"
              role="radio"
              aria-checked={professor === op.v}
              className={`sf-option ${professor === op.v ? 'selected' : ''}`}
              onClick={() => escolherProfessor(op.v)}
            >
              {op.t}
            </button>
          ))}
        </div>

        {/* Sim: data da última evolução funcional (obrigatória) */}
        {professor === true && (
                  <div className="sf-conditional animate-fade-in">
                    <label className="sf-question" htmlFor="dataEvolucao">
                      Quando foi a data da sua última evolução funcional?
                      <span className="badge-pill badge-purple" style={{ marginLeft: 8, fontSize: '0.72rem' }}>
                        Obrigatório
                      </span>
                    </label>

                    <div className="input-with-icon sf-date">
                      <Calendar size={18} className="field-icon" />
                      <input
                        id="dataEvolucao"
                        type="date"
                        required
                        max={hoje}
                        value={dataEvolucao}
                        onChange={(e) => setDataEvolucao(e.target.value)}
                        className="form-input"
                      />
                    </div>
                    <span className="field-helper">
                      A data da última evolução funcional é usada para calcularmos os períodos válidos de pontuação (limite retroativo de 17 meses).
                    </span>

                    {/* Alerta de erro de 17 meses retroativos */}
                    {!validacaoEvolucao.valida && (
                      <div className="lookup-error animate-fade-in" style={{ marginTop: 10 }}>
                        <AlertCircle size={18} />
                        <span>{validacaoEvolucao.erro}</span>
                      </div>
                    )}

                    {/* Bloco de Sugestão de Períodos Pedagógicos */}
                    {periodosSugeridos.length > 0 && (
                      <div className="sf-periodos-container animate-fade-in">
                        <div className="sf-periodos-header">
                          <div className="sf-periodos-icon">
                            <CalendarRange size={18} />
                          </div>
                          <div>
                            <h4 className="sf-periodos-title">Sugestão de Período para Emissão</h4>
                            <p className="sf-periodos-sub">
                              Períodos mensais em dias úteis, conforme a carga horária e sem sobreposição, a partir de{' '}
                              <strong>
                                {formatDateBR(parseDate(dataEvolucao))}
                              </strong>:
                            </p>
                          </div>
                        </div>

                        <div className="sf-periodos-list">
                          {periodosProcessados.map((p) => {
                            const conf = aceitesCursos[p.indice] || { aceite: 'Aceito' };
                            const isNaoAceito = conf.aceite === 'Não Aceito';

                            return (
                              <div
                                key={p.indice}
                                className={`sf-periodo-card ${p.cancelado && !isNaoAceito ? 'cancelado' : ''}`}
                              >
                                <div className="sf-periodo-card-main">
                                  <div className="sf-periodo-info">
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                      <span className="sf-label">Curso {p.indice} • {formatarTipoComCarga(p)}</span>
                                      {p.ultrapassaHoje && !isNaoAceito && (
                                        <span className="badge-cancelado">
                                          <XCircle size={12} /> Sugestão Cancelada (Data Futura)
                                        </span>
                                      )}
                                      {isNaoAceito && (
                                        <span className="badge-customizado">
                                          ✏️ Data Customizada
                                        </span>
                                      )}
                                    </div>
                                    <strong className="sf-periodo-curso" title={p.curso}>{p.curso}</strong>
                                    {p.ultrapassaHoje && !isNaoAceito && (
                                      <span style={{ fontSize: '0.74rem', color: '#f87171' }}>
                                        Término ({p.dataFimFormatada}) ultrapassa a data atual — não é permitida emissão futura. Você pode selecionar "Não Aceito" e informar uma data de conclusão válida.
                                      </span>
                                    )}
                                  </div>
                                  <div className="sf-periodo-datas">
                                    <Clock size={13} />
                                    <span>{p.dataInicioFormatada} até {p.dataFimFormatada}</span>
                                  </div>
                                </div>

                                {/* Seletor de Aceite Individual */}
                                <div className="sf-aceite-container">
                                  <div className="sf-aceite-header">
                                    <span className="sf-aceite-prompt">Você aceita este período proposto?</span>
                                    <div className="sf-aceite-btn-group">
                                      <button
                                        type="button"
                                        className={`btn-aceite ${!isNaoAceito ? 'active-aceito' : ''}`}
                                        onClick={() => escolherAceite(p.indice, 'Aceito')}
                                      >
                                        <CheckCircle2 size={13} /> Aceito
                                      </button>
                                      <button
                                        type="button"
                                        className={`btn-aceite ${isNaoAceito ? 'active-nao-aceito' : ''}`}
                                        onClick={() => escolherAceite(p.indice, 'Não Aceito')}
                                      >
                                        <XCircle size={13} /> Não Aceito
                                      </button>
                                    </div>
                                  </div>

                                  {/* Campo "Data de Conclusão" quando "Não Aceito" */}
                                  {isNaoAceito && (
                                    <div className="sf-custom-date-box animate-fade-in">
                                      <label className="sf-custom-date-label">
                                        Data de Conclusão
                                      </label>
                                      <div className="sf-custom-input-row">
                                        <div className="input-with-icon sf-date" style={{ maxWidth: 220 }}>
                                          <Calendar size={15} className="field-icon" />
                                          <input
                                            type="date"
                                            className="form-input form-input-sm"
                                            max={hoje}
                                            value={conf.dataConclusao || ''}
                                            onChange={(e) => escolherDataConclusao(p.indice, e.target.value)}
                                          />
                                        </div>
                                        {conf.valida && (
                                          <span className="sf-custom-date-preview">
                                            Novo período: <strong>{conf.dataInicioFormatada} até {conf.dataFimFormatada}</strong>
                                          </span>
                                        )}
                                      </div>

                                      {conf.erro && (
                                        <div className="lookup-error animate-fade-in" style={{ marginTop: 6 }}>
                                          <AlertCircle size={14} />
                                          <span>{conf.erro}</span>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
        )}
      </section>

      {/* Confirmação */}
      <section className="sf-card">
        <label className="terms-checkbox-label">
          <input
            type="checkbox"
            className="custom-checkbox"
            checked={confirmacao}
            onChange={(e) => setConfirmacao(e.target.checked)}
          />
          <span className="terms-body">
            Confirmo que todas as informações estão corretas e estou ciente de que não será possível alterá-las após o envio deste formulário.
          </span>
        </label>

        {todosCancelados && (
          <div className="lookup-error" style={{ marginTop: 12 }}>
            <AlertCircle size={16} />
            <span>
              Todas as extensões solicitadas ultrapassam a data atual e tiveram a solicitação cancelada. Não é possível enviar neste momento. Por favor, aguarde o cumprimento dos períodos para realizar uma nova solicitação.
            </span>
          </div>
        )}

        {erroEnvio && (
          <div className="lookup-error" style={{ marginTop: 12 }}>
            <AlertCircle size={15} /> <span>{erroEnvio}</span>
          </div>
        )}

        <button type="submit" className="btn btn-primary sf-submit" disabled={!formularioValido || enviando}>
          {enviando ? (
            <>
              <div className="spinner-sm" /> Enviando...
            </>
          ) : (
            <>
              <Send size={18} /> Enviar
            </>
          )}
        </button>
      </section>
    </form>
  );
}
