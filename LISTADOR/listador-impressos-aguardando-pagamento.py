"""
Script separado para listar solicitações em 'Aguardando Pagamento' (waiting_payment) no Lyra
e preencher Nome, CPF e Curso na aba 'IMPRESSOS' da planilha Turmas Geral (Pilares).

Uso:
  python LISTADOR/listador-impressos-aguardando-pagamento.py
  python LISTADOR/listador-impressos-aguardando-pagamento.py --dry-run
"""
import argparse
import concurrent.futures
import importlib.util
import json
import os
import sys
import gspread
import requests
from oauth2client.service_account import ServiceAccountCredentials

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LISTADOR_PATH = os.path.join(SCRIPT_DIR, "listador-extensoes-aperf.py")
spec = importlib.util.spec_from_file_location("listador_oficial", LISTADOR_PATH)
lst = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lst)

TARGET_SPREADSHEET_ID = os.environ.get(
    "IMPRESSOS_SHEET_ID",
    "1GdvByvznwciCpZ1QIqln8SbpopEL-L_ePyLcaTM3SQw",
).strip()
TARGET_SHEET_TAB = os.environ.get("IMPRESSOS_SHEET_TAB", "IMPRESSOS").strip()
TARGET_SHEET_GID = int(os.environ.get("IMPRESSOS_SHEET_GID", "450795890"))


def conectar_aba_impressos():
    scope = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/drive",
    ]
    creds = None
    env_cred = os.environ.get("GOOGLE_CREDENTIALS")
    env_cred_b64 = os.environ.get("GOOGLE_CREDENTIALS_BASE64")

    if env_cred and env_cred.strip().startswith("{"):
        creds = ServiceAccountCredentials.from_json_keyfile_dict(json.loads(env_cred.strip()), scope)
    elif env_cred_b64:
        import base64
        decoded = base64.b64decode(env_cred_b64.strip()).decode("utf-8")
        creds = ServiceAccountCredentials.from_json_keyfile_dict(json.loads(decoded), scope)
    else:
        for candidato in [lst.JSON_KEYFILE_PATH, "123.json", os.path.join(SCRIPT_DIR, "..", "123.json")]:
            if os.path.exists(candidato):
                creds = ServiceAccountCredentials.from_json_keyfile_name(candidato, scope)
                break

    if not creds:
        raise RuntimeError("Credenciais do Google Sheets não encontradas (123.json ou GOOGLE_CREDENTIALS).")

    client = gspread.authorize(creds)
    ss = client.open_by_key(TARGET_SPREADSHEET_ID)
    for ws in ss.worksheets():
        if ws.id == TARGET_SHEET_GID:
            return ws
    return ss.worksheet(TARGET_SHEET_TAB)


def buscar_aguardando_pagamento_lyra(headers):
    rota_sonda = 'certificates/certificate-solicitations?status=waiting_payment&sort={"_id":-1}&page=1&limit=50&aggregate=[]'
    data_sonda = lst.bater_na_api(rota_sonda, headers)
    if not data_sonda or "data" not in data_sonda:
        raise RuntimeError("Não foi possível consultar a fila waiting_payment no Lyra.")

    meta = data_sonda.get("metadata", {}).get("paginate", {})
    total_pages = int(meta.get("lastPage", 1) or 1)
    itens = list(data_sonda["data"])

    if total_pages > 1:
        def worker(pg):
            rota = f'certificates/certificate-solicitations?status=waiting_payment&sort={{"_id":-1}}&page={pg}&limit=50&aggregate=[]'
            d = lst.bater_na_api(rota, headers)
            return d.get("data", []) if d else []

        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
            for res_pg in executor.map(worker, range(2, total_pages + 1)):
                if res_pg:
                    itens.extend(res_pg)

    return itens


def main():
    parser = argparse.ArgumentParser(description="Lista solicitações em Aguardando Pagamento na aba IMPRESSOS.")
    parser.add_argument("--dry-run", action="store_true", help="Simula sem gravar na planilha.")
    args = parser.parse_args()

    print("=" * 65)
    print("🖨️  LISTADOR IMPRESSOS — AGUARDANDO PAGAMENTO (LYRA -> SHEETS)")
    print("=" * 65)

    res_login = requests.post(
        lst.URL_LOGIN_ESTATICA,
        json={"email": lst.EMAIL_ACESSO, "password": lst.SENHA_ACESSO},
        headers=lst.HEADERS_PADRAO,
        timeout=20,
    )
    if res_login.status_code != 200:
        print(f"❌ Falha no login Lyra ({res_login.status_code}): {res_login.text[:200]}")
        sys.exit(1)

    headers = lst.HEADERS_PADRAO.copy()
    headers["Authorization"] = res_login.json()["data"]["user"]["authorization"]

    itens = buscar_aguardando_pagamento_lyra(headers)
    print(f"📡 Capturados {len(itens)} registro(s) na fila 'Aguardando Pagamento' do Lyra.")

    ws = conectar_aba_impressos()
    valores = ws.get_all_values()
    cabecalhos = valores[0] if valores else ["Nome", "CPF", "Curso"]
    headers_norm = [lst.normalizar_texto(h) for h in cabecalhos]

    idx_nome = headers_norm.index("NOME") if "NOME" in headers_norm else 0
    idx_cpf = headers_norm.index("CPF") if "CPF" in headers_norm else 1
    idx_curso = headers_norm.index("CURSO") if "CURSO" in headers_norm else 2

    existentes = set()
    for row in valores[1:]:
        cpf_ex = "".join(ch for ch in (row[idx_cpf] if len(row) > idx_cpf else "") if ch.isdigit()).zfill(11)
        curso_ex = lst.normalizar_texto(row[idx_curso] if len(row) > idx_curso else "")
        if cpf_ex != "00000000000" and curso_ex:
            existentes.add(f"{cpf_ex}|{curso_ex}")

    novas_linhas = []
    vistas_rodada = set()
    for it in itens:
        ds = it.get("dataStudent") or {}
        dc = it.get("dataCourse") or {}
        nome = str(ds.get("name") or "").strip()
        cpf = "".join(ch for ch in str(ds.get("cpf") or "") if ch.isdigit()).zfill(11)
        curso = str(dc.get("course") or "").strip()

        if not nome or cpf == "00000000000" or not curso:
            continue

        chave = f"{cpf}|{lst.normalizar_texto(curso)}"
        if chave in existentes or chave in vistas_rodada:
            continue
        vistas_rodada.add(chave)

        linha = [""] * max(len(cabecalhos), idx_nome + 1, idx_cpf + 1, idx_curso + 1)
        linha[idx_nome] = nome
        linha[idx_cpf] = cpf
        linha[idx_curso] = curso
        novas_linhas.append(linha)

    print(f"🆕 Novas linhas para inserir na aba '{ws.title}': {len(novas_linhas)}")
    for l in novas_linhas[:5]:
        print(f"   • {l[idx_nome]} | {l[idx_cpf]} | {l[idx_curso]}")
    if len(novas_linhas) > 5:
        print(f"   ... e mais {len(novas_linhas) - 5} registro(s).")

    if args.dry_run:
        print("🔎 Modo --dry-run ativo: nenhuma linha gravada na planilha.")
        return

    if not novas_linhas:
        print("✅ Planilha já está atualizada.")
        return

    ws.append_rows(novas_linhas, value_input_option="USER_ENTERED")
    print(f"✅ Sucesso! {len(novas_linhas)} linha(s) inserida(s) na aba '{ws.title}'.")


if __name__ == "__main__":
    main()
