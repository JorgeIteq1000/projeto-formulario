import React from 'react';
import { 
  Bot, 
  Search, 
  Smartphone, 
  FileEdit, 
  Workflow, 
  Award, 
  Clock, 
  ShieldAlert, 
  CheckCircle2, 
  Database,
  ArrowRight
} from 'lucide-react';

export default function AutomationGuide() {
  const passos = [
    {
      numero: '1',
      titulo: 'Varredura Contínua',
      icone: Search,
      badge: 'Robô Digital • Base Lyra',
      descricao: 'O processo identifica automaticamente novas solicitações feitas pelos alunos no portal acadêmico. Insere na planilha do Google Drive e cria o card no Bitrix24 no pipeline (NÚCLEO EXTENSÕES) coluna (ENTRADA).',
      detalhes: [
        'Varredura automatizada diária na base acadêmica',
        'Registro na planilha oficial do Drive',
        'Criação de Deal/Card no Bitrix24 na coluna [ENTRADA]'
      ]
    },
    {
      numero: '2',
      titulo: 'Notificação Ativa (Zionic IA)',
      icone: Smartphone,
      badge: 'WhatsApp • Custo Zero',
      descricao: 'Um disparo automático é feito para o WhatsApp do aluno avisando sobre a solicitação e enviando um link único e seguro (solicitacao.certificadoies.com.br/solicitacoes/TOKEN) agrupando os cursos das últimas 24h.',
      detalhes: [
        'Disparo ativo sem fricção direto no celular do aluno',
        'Link personalizado e seguro (ex: solicitacao.certificadoies.com.br/solicitacoes/...) com dados pré-autenticados',
        'Substitui 100% a dependência de e-mails lentos e manuais'
      ]
    },
    {
      numero: '3',
      titulo: 'Coleta Digital Inteligente',
      icone: FileEdit,
      badge: 'Formulário Responsivo',
      descricao: 'O aluno acessa o link e preenche o Formulário Inteligente em menos de 2 minutos. Os dados cadastrais já vêm preenchidos, o CEP é completado automaticamente e as regras condicionais são validadas.',
      detalhes: [
        'Nome, CPF e Cursos já preenchidos da planilha',
        'Cálculo automático de período pedagógico',
        'Campo condicional para professores municipais (data de evolução)',
        'Termo de auto-responsabilidade que zera retrabalho'
      ]
    },
    {
      numero: '4',
      titulo: 'Gestão Automatizada CRM',
      icone: Workflow,
      badge: 'Bitrix24 • Movimentação Autônoma',
      descricao: 'Assim que o aluno clica em finalizar o formulário, o robô avança o card dele sozinho no Bitrix24 da coluna [ENTRADA] diretamente para [EMITIR].',
      detalhes: [
        'Movimentação de coluna 100% autônoma no CRM',
        'Régua de cobrança automática caso o aluno não responda a tempo',
        'Notificação e rotina de cancelamento no Lyra após inatividade prolongada'
      ]
    },
    {
      numero: '5',
      titulo: 'Emissão Ágil & Descomplicada',
      icone: Award,
      badge: 'Zero E-mails Manuais',
      descricao: 'A equipe acadêmica não precisa cobrar nem trocar e-mails. Apenas confere os dados já higienizados e validados na coluna EMITIR e gera os certificados com agilidade total.',
      detalhes: [
        'Redução a zero do esforço braçal da equipe na coleta',
        'Eliminação do tempo de espera e frustração do aluno',
        'Certificados emitidos com conformidade documental MEC'
      ]
    }
  ];

  return (
    <div className="guide-container animate-fade-in">
      <div className="guide-header">
        <div className="guide-tag">
          <Bot size={16} />
          <span>Arquitetura da Solução</span>
        </div>
        <h2 className="guide-title">Automação de Ponta-a-Ponta na Emissão de Certificados</h2>
        <p className="guide-subtitle">
          Transformação do antigo processo reativo e dependente de e-mails manuais em um fluxo autônomo, 
          integrando Portal Acadêmico, Planilha do Google Drive, IA Zionic (WhatsApp) e Bitrix24 CRM.
        </p>
      </div>

      <div className="steps-container">
        {passos.map((passo, idx) => {
          const Icon = passo.icone;
          return (
            <div key={idx} className="step-card">
              <div className="step-number-col">
                <div className="step-number-circle">{passo.numero}</div>
                {idx < passos.length - 1 && <div className="step-connector-line"></div>}
              </div>

              <div className="step-body">
                <div className="step-top-row">
                  <div className="step-icon-badge">
                    <Icon size={20} />
                  </div>
                  <div className="step-meta">
                    <span className="step-badge">{passo.badge}</span>
                    <h3 className="step-title-text">{passo.titulo}</h3>
                  </div>
                </div>

                <p className="step-desc-text">{passo.descricao}</p>

                <ul className="step-list">
                  {passo.detalhes.map((item, dIdx) => (
                    <li key={dIdx}>
                      <CheckCircle2 size={16} className="text-emerald" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>

      {/* Regras de Cobrança e Governança */}
      <div className="governance-grid">
        <div className="gov-card">
          <div className="gov-icon-row text-amber">
            <Clock size={24} />
            <h4>Régua Ativa de Cobrança (Ninguém fica para trás)</h4>
          </div>
          <p>
            Se o card permanecer parado na coluna de espera sem que o aluno tenha acessado o formulário, 
            a IA Zionic dispara lembretes automáticos pelo WhatsApp com intervalo programado, sem demandar 
            nenhum tempo manual da equipe de atendimento.
          </p>
        </div>

        <div className="gov-card">
          <div className="gov-icon-row text-rose">
            <ShieldAlert size={24} />
            <h4>Limpeza e Cancelamento Automático</h4>
          </div>
          <p>
            Caso expire a janela máxima sem preenchimento, o aluno recebe um comunicado informando que a solicitação 
            será encerrada. O card é movido para a coluna "Cancelar Solicitação" e o cancelamento é registrado no 
            sistema Lyra com abertura de ocorrência automática.
          </p>
        </div>
      </div>
    </div>
  );
}
