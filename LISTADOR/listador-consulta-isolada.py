"""
Cópia isolada (somente leitura) do Listador para diagnóstico de um aluno específico no terminal.
NÃO grava nem altera nada no Google Sheets.

Uso:
  python LISTADOR/listador-consulta-isolada.py "Claudio Martines das Dores"
"""
import sys
import json
import re
import requests
from datetime import datetime
import importlib.util
import os

# Reaproveita helpers e credenciais do listador oficial sem duplicar lógica
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LISTADOR_PATH = os.path.join(SCRIPT_DIR, "listador-extensoes-aperf.py")
spec = importlib.util.spec_from_file_location("listador_oficial", LISTADOR_PATH)
lst = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lst)


def consultar_aluno_isolado(termo_busca: str):
    print("=" * 70)
    print(f"🔎 CONSULTA ISOLADA LYRA (SOMENTE LEITURA) | Aluno: {termo_busca}")
    print("=" * 70)

    res_login = requests.post(
        lst.URL_LOGIN_ESTATICA,
        json={"email": lst.EMAIL_ACESSO, "password": lst.SENHA_ACESSO},
        headers=lst.HEADERS_PADRAO,
        timeout=20,
    )
    if res_login.status_code != 200:
        print(f"❌ Falha no login da API Lyra ({res_login.status_code}): {res_login.text[:200]}")
        return

    token_auth = res_login.json().get("data", {}).get("user", {}).get("authorization")
    headers = lst.HEADERS_PADRAO.copy()
    headers["Authorization"] = token_auth

    from urllib.parse import quote
    termo_enc = quote(termo_busca.strip())

    encontrados = []
    ids_vistos = set()

    for status_alvo, rotulo in [
        ("waiting_approval", "Aguardando Aprovação"),
        ("waiting_payment", "Aguardando Pagamento"),
        ("", "Todos os Status (Geral)"),
    ]:
        filtro_status = f"status={status_alvo}&" if status_alvo else ""
        rota = f'certificates/certificate-solicitations?{filtro_status}searchTerm={termo_enc}&sort={{"_id":-1}}&page=1&limit=50&aggregate=[]'
        resp = lst.bater_na_api(rota, headers)
        itens = (resp or {}).get("data") or []
        print(f"📡 Fila [{rotulo}]: {len(itens)} registro(s) retornado(s)")

        for item in itens:
            item_id = str(item.get("_id") or "")
            if item_id and item_id in ids_vistos:
                continue
            if item_id:
                ids_vistos.add(item_id)
            item["_status_lyra_origem"] = status_alvo or item.get("status")
            item["_fila_origem"] = rotulo
            encontrados.append(item)

    if not encontrados:
        print("\n⚠️ Nenhuma solicitação encontrada para este termo na API do Lyra.")
        return

    print(f"\n🎯 Total de solicitações únicas encontradas: {len(encontrados)}\n")

    for idx, r in enumerate(encontrados, start=1):
        ds = r.get("dataStudent") or {}
        dc = r.get("dataCourse") or {}
        cpf = str(ds.get("cpf") or "").strip()
        tipo_curso = dc.get("courseType", "")
        no_escopo = lst.eh_tipo_extensao_ou_aperfeicoamento(tipo_curso)

        tipo_raw = str(r.get("type") or "").lower()
        tipo_cert = "Digital" if tipo_raw == "digital" else ("Impresso" if tipo_raw == "print" else tipo_raw.capitalize())
        status_lyra = lst.traduzir_status_lyra(r.get("_status_lyra_origem") or r.get("status"))

        enrolments_raw = r.get("enrolment") or []
        enr = enrolments_raw[0] if enrolments_raw else {}
        contrato = str(enr.get("_id") or r.get("_enrolmentId") or "N/A")
        rc = enr.get("registryCourse") or {}
        data_inicio_iso = str(rc.get("dateStart") or enr.get("createdAt") or "")
        criacao_matricula_iso = str(enr.get("createdAt") or "")
        crs = rc.get("course") or {}
        meses_minimos = crs.get("minMonthsToComplete")
        data_inicio_fmt = lst.formatar_data(data_inicio_iso)

        previsao_termino = "N/A"
        if meses_minimos and data_inicio_fmt != "N/A":
            previsao_termino = lst.calcular_previsao_termino(data_inicio_fmt, meses_minimos)
        elif enr.get("expiredAt"):
            previsao_termino = lst.formatar_data(enr.get("expiredAt"))

        if (not previsao_termino or previsao_termino == "N/A") and re.match(r'^[0-9a-fA-F]{24}$', contrato):
            d_enr = lst.bater_na_api(f'students/enrolments/{contrato}?populate={{}}', headers)
            if d_enr and d_enr.get("data"):
                enr_det = d_enr["data"]
                rc_det = enr_det.get("registryCourse") or {}
                dt_ini_det = lst.formatar_data(rc_det.get("dateStart") or enr_det.get("createdAt"))
                min_m_det = (rc_det.get("course") or {}).get("minMonthsToComplete")
                if min_m_det and dt_ini_det != "N/A":
                    previsao_termino = lst.calcular_previsao_termino(dt_ini_det, min_m_det)
                elif enr_det.get("expiredAt"):
                    previsao_termino = lst.formatar_data(enr_det.get("expiredAt"))

        # Busca telefone / dados pessoais do aluno
        dados_aluno_api = {}
        if cpf:
            h_tel = headers.copy()
            h_tel["requestOrigin"] = "busca-rapida-pesquisa"
            d_tel = lst.bater_na_api(f'students/students/cpf/{cpf}?populate={{}}', h_tel)
            if d_tel and d_tel.get("data"):
                dados_aluno_api = d_tel["data"]

        saida = {
            "solicitacao_num": idx,
            "no_escopo_extensao_aperf": no_escopo,
            "fila_encontrada": r.get("_fila_origem"),
            "status_bruto_api": r.get("status"),
            "status_mapeado_coluna_V": status_lyra,
            "id_evento_coluna_J": r.get("_id"),
            "solicitacao_createdAt_coluna_A": lst.formatar_data(str(r.get("createdAt") or "")[:10]),
            "cpf_coluna_B": cpf,
            "nome_coluna_C": ds.get("name"),
            "tipo_certificado_coluna_D": tipo_cert,
            "tipo_curso_coluna_E": tipo_curso,
            "curso_coluna_F": dc.get("course"),
            "certificadora_coluna_G": dc.get("certifier"),
            "carga_horaria": dc.get("workload"),
            "contrato_coluna_H": contrato,
            "telefone_coluna_L": dados_aluno_api.get("cellPhone") or dados_aluno_api.get("whatsApp") or dados_aluno_api.get("phone") or "N/A",
            "data_inicio_iso_coluna_M": data_inicio_iso,
            "criacao_matricula_iso_coluna_N": criacao_matricula_iso,
            "rg_coluna_P": dados_aluno_api.get("identity") or dados_aluno_api.get("rg") or "",
            "nacionalidade_coluna_Q": dados_aluno_api.get("nationality") or "",
            "data_nascimento_coluna_R": lst.formatar_data_nascimento(dados_aluno_api.get("birthDate") or ""),
            "minMonthsToComplete_bruto": meses_minimos,
            "prazo_minimo_conclusao_coluna_X": previsao_termino,
            "charge_raw": r.get("charge"),
        }

        print(f"--- SOLICITAÇÃO #{idx} ---")
        print(json.dumps(saida, indent=2, ensure_ascii=False))
        print()


if __name__ == "__main__":
    termo = " ".join(sys.argv[1:]).strip() if len(sys.argv) > 1 else "Claudio Martines das Dores"
    consultar_aluno_isolado(termo)
