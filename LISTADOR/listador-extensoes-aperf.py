import time
import requests
import json
import base64
import hashlib
import os
import sys
import unicodedata
import gspread
import concurrent.futures
from datetime import datetime
import calendar
import re
from oauth2client.service_account import ServiceAccountCredentials
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad
import threading
import queue

# ==========================================
# CONFIGURAÇÕES E CREDENCIAIS GERAIS
# ==========================================
CURRENT_VERSION = "3.0.0 (Automático/Headless)"
GOOGLE_SHEET_NAME = "Listador"
JSON_KEYFILE_PATH = '123.json'
CHAVE_SECRETA = "9pYz4paxNPln9nuMC2tEG596"
BASE_URL_API = "https://api-gateway.faculdadeesp.com.br/"
URL_LOGIN_ESTATICA = "https://api-gateway.faculdadeesp.com.br/U2FsdGVkX18tJxVXlIIZptWAhw0ik7pOGx/b1OQG8SGT8oun6VP/MYl5CMxQjrGK"

# Credenciais e Planilha Fixas para Automação
EMAIL_ACESSO = "comercial@iteqescolas.com.br"
SENHA_ACESSO = "N@talia16103010"
ABA_PLANILHA = "Extensões e Aperfeiçoamentos"

HEADERS_PADRAO = {
    "Accept": "application/json", "Content-Type": "application/json", "Company": "iteq",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}

# ==========================================
# LOG
# ==========================================
LISTADOR_QUEUES = {}
session_context_listador = threading.local()

def get_listador_queue(session_id: str):
    if session_id not in LISTADOR_QUEUES:
        LISTADOR_QUEUES[session_id] = queue.Queue()
    return LISTADOR_QUEUES[session_id]

def clear_listador_queue(session_id: str):
    if session_id in LISTADOR_QUEUES:
        del LISTADOR_QUEUES[session_id]

def log(mensagem, tipo="INFO"):
    hora_atual = datetime.now().strftime("%H:%M:%S")
    msg_str = f"[{hora_atual}] {mensagem}"
    print(msg_str)
    
    session_id = getattr(session_context_listador, 'session_id', None)
    if session_id and session_id in LISTADOR_QUEUES:
        LISTADOR_QUEUES[session_id].put({"msg": mensagem, "tipo": tipo})


# ==========================================
# UTILITÁRIOS DA API E GOOGLE SHEETS
# ==========================================
def normalizar_texto(texto):
    if not texto: return ""
    return unicodedata.normalize('NFKD', str(texto)).encode('ASCII', 'ignore').decode('utf-8').upper().strip()

def eh_tipo_extensao_ou_aperfeicoamento(tipo_curso):
    norm = normalizar_texto(tipo_curso)
    return "EXTENSAO" in norm or "APERFEICOAMENTO" in norm

def formatar_data(data_iso):
    if not data_iso or data_iso == "N/A": return "N/A"
    try: return datetime.strptime(data_iso[:10], "%Y-%m-%d").strftime("%d/%m/%Y")
    except: return data_iso[:10]

def calcular_previsao_termino(data_inicio_str, meses_para_add):
    if not data_inicio_str or data_inicio_str == "N/A" or not meses_para_add: return "N/A"
    try:
        dt = datetime.strptime(data_inicio_str, "%d/%m/%Y")
        mes = dt.month - 1 + int(meses_para_add)
        ano = dt.year + mes // 12
        mes = mes % 12 + 1
        dia = min(dt.day, calendar.monthrange(ano, mes)[1])
        return datetime(ano, mes, dia).strftime("%d/%m/%Y")
    except: return "N/A"

def criptografar_rota(rota_limpa):
    salt = os.urandom(8)
    key_iv, prev = b'', b''
    while len(key_iv) < 48:
        prev = hashlib.md5(prev + CHAVE_SECRETA.encode('utf-8') + salt).digest()
        key_iv += prev
    cipher = AES.new(key_iv[:32], AES.MODE_CBC, key_iv[32:48])
    encrypted = cipher.encrypt(pad(rota_limpa.encode('utf-8'), AES.block_size))
    return BASE_URL_API + base64.b64encode(b'Salted__' + salt + encrypted).decode('utf-8')

def bater_na_api(rota_limpa, headers, tentativas=3):
    for _ in range(tentativas):
        url_cripto = criptografar_rota(rota_limpa)
        try:
            res = requests.get(url_cripto, headers=headers, timeout=20)
            if res.status_code == 200: return res.json()
            elif res.status_code == 404: return None
        except Exception: pass
        time.sleep(2)
    return None

def setup_google_sheets(worksheet_name_param):
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__)) if not getattr(sys, 'frozen', False) else os.path.dirname(sys.executable)
        caminho_cred = os.path.join(script_dir, JSON_KEYFILE_PATH) if not os.path.exists(JSON_KEYFILE_PATH) else JSON_KEYFILE_PATH
        
        scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
        creds = ServiceAccountCredentials.from_json_keyfile_name(caminho_cred, scope)
        client = gspread.authorize(creds)
        spreadsheet = client.open(GOOGLE_SHEET_NAME)
        try:
            sheet = spreadsheet.worksheet(worksheet_name_param)
        except gspread.exceptions.WorksheetNotFound:
            log(f"⚠️ Aba '{worksheet_name_param}' não encontrada. Criando automaticamente com cabeçalhos padrão...")
            sheet = spreadsheet.add_worksheet(title=worksheet_name_param, rows=1000, cols=20)
            cabecalhos = [
                'SOLICITAÇÃO', 'CPF', 'NOME', 'TIPO DE CERTIFICADO', 'TIPO DE CURSO',
                'CURSO', 'CERTIFICADORA', 'CONTRATO', 'STATUS DO EVENTO', 'ID DO EVENTO',
                'DATA CRIAÇÃO EVENTO', 'TELEFONE', 'DATA INÍCIO (ISO)', 'CRIAÇÃO MATRÍCULA (ISO)',
                'USER ID', 'RG', 'Nacionalidade', 'Data de Nascimento'
            ]
            sheet.append_row(cabecalhos, value_input_option='USER_ENTERED')
        return sheet
    except Exception as e:
        log(f"Erro no Setup Sheets: {e}")
        return None

def carregar_filtros_json():
    # Lê os tipos de curso diretamente do JSON de Configuração
    script_dir = os.path.dirname(os.path.abspath(__file__)) if not getattr(sys, 'frozen', False) else os.path.dirname(sys.executable)
    cursos = []
    
    # 1. Tenta pegar a seleção salva pelo painel/preset
    arq_selection = os.path.join(script_dir, "selection_preset.json")
    if os.path.exists(arq_selection):
        try:
            with open(arq_selection, 'r', encoding='utf-8') as f:
                cursos = json.load(f).get("selected", [])
        except Exception: pass

    # 2. Tenta pegar o JSON base de tipos
    if not cursos:
        arq_tipos = os.path.join(script_dir, "tipos_certificados.json")
        if os.path.exists(arq_tipos):
            try:
                with open(arq_tipos, 'r', encoding='utf-8') as f:
                    cursos = json.load(f).get("cursos", [])
            except Exception: pass
            
    # Garantir estritamente apenas cursos de Extensão e Aperfeiçoamento
    cursos_filtrados = [c for c in cursos if eh_tipo_extensao_ou_aperfeicoamento(c)]
    if not cursos_filtrados:
        cursos_filtrados = ["Extensão", "Aperfeiçoamento"]
    return cursos_filtrados

# ==========================================
# MOTOR PRINCIPAL DE PROCESSAMENTO
# ==========================================
def executar_rotina_automatizada(session_id=None):
    if session_id:
        session_context_listador.session_id = session_id
    log("="*60)
    log(f"🎓 INICIANDO LISTADOR DE CERTIFICADOS AUTOMÁTICO v{CURRENT_VERSION}")
    log("="*60)
    
    selected_courses = carregar_filtros_json()
    if not selected_courses:
        log("❌ NENHUM filtro de curso encontrado nos arquivos JSON. Parando execução.")
        return
        
    log(f"📌 Filtros carregados ({len(selected_courses)} alvos): {', '.join(selected_courses)}")

    try:
        log("🔑 Autenticando na API ESP...")
        res_login = requests.post(URL_LOGIN_ESTATICA, json={"email": EMAIL_ACESSO, "password": SENHA_ACESSO}, headers=HEADERS_PADRAO)
        if res_login.status_code != 200:
            log("❌ Falha crítica no login da API. Verifique usuário e senha.")
            return
            
        token_auth = res_login.json().get("data", {}).get("user", {}).get("authorization")
        headers = HEADERS_PADRAO.copy()
        headers["Authorization"] = token_auth

        log(f"📖 Conectando à Aba '{ABA_PLANILHA}' da Planilha '{GOOGLE_SHEET_NAME}'...")
        sheet = setup_google_sheets(ABA_PLANILHA)
        if not sheet:
            log(f"❌ Erro Crítico ao conectar na aba com a chave 123.json. Extrator encerrado.")
            return

        log("🔎 Buscando a Página 1 para Mapeamento Global...")
        rota_sonda = f'certificates/certificate-solicitations?status=waiting_approval&sort={{"_id":-1}}&page=1&limit=50&aggregate=[]'
        data_sonda = bater_na_api(rota_sonda, headers)
        
        if not data_sonda or 'data' not in data_sonda:
            log("❌ Erro ao ler a API na página 1 ou fim absoluto dos registros.")
            return
            
        meta_paginate = data_sonda.get("metadata", {}).get("paginate", {})
        total_pages = meta_paginate.get("lastPage", 1)
        total_docs = meta_paginate.get("total", "??")
        
        log(f"🎯 Total na API detectado: {total_docs} Documentos espalhados em {total_pages} Páginas.")
        
        resultados_brutos = data_sonda['data']
        
        if total_pages > 1:
            log("🚀 Disparando Exército de Agentes para capturar as páginas em paralelo...")
            paginas_restantes = range(2, total_pages + 1)
            
            def worker_fetch(pg):
                rota = f'certificates/certificate-solicitations?status=waiting_approval&sort={{"_id":-1}}&page={pg}&limit=50&aggregate=[]'
                d = bater_na_api(rota, headers)
                if d and 'data' in d:
                    log(f"⚡ [AGENTE] Página {pg}/{total_pages} capturada com sucesso!")
                    return d['data']
                return []

            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                futures = {executor.submit(worker_fetch, pg): pg for pg in paginas_restantes}
                for future in concurrent.futures.as_completed(futures):
                    res = future.result()
                    if res:
                        resultados_brutos.extend(res)

        log("✅ Todo o ecossistema foi baixado! Realizando cruzamento estrito de filtros...")

        resultados = []
        for item in resultados_brutos:
            c_type = item.get("dataCourse", {}).get("courseType", "")
            c_name = item.get("dataCourse", {}).get("course", "")
            nome_aluno = item.get("dataStudent", {}).get("name", "Sem Nome")
            
            # Filtro estrito: somente tipos de Extensão e Aperfeiçoamento
            if not eh_tipo_extensao_ou_aperfeicoamento(c_type):
                log(f"🚫 [IGNORADO] Aluno: {nome_aluno} | Tipo: '{c_type}' | Curso: '{c_name}' -> Razão: Não é Extensão nem Aperfeiçoamento")
                continue

            # Filtro por sub-seleção se houver
            match = False
            for sc in selected_courses:
                sc_norm = normalizar_texto(sc)
                if sc_norm in normalizar_texto(c_type) or sc_norm in normalizar_texto(c_name):
                    match = True
                    log(f"✅ [MATCH] Aluno: {nome_aluno} | Filtro: '{sc}' -> '{c_name}' ({c_type})")
                    break
                    
            if match:
                resultados.append(item)
            else:
                log(f"🚫 [IGNORADO] Aluno: {nome_aluno} | Curso: '{c_name}' -> Razão: Fora do escopo dos filtros")

        log(f"🎯 Resumo do Filtro: {len(resultados)} Certificados de Interesse Prontos para Processamento.")
        if len(resultados) == 0:
            log("✅ Nenhum novo candidato alvo hoje. Finalizando com êxito.")
            return

        log("📝 Lendo cabeçalhos da planilha para alinhamento dinâmico das colunas...")
        cabecalhos_planilha = sheet.row_values(1)
        if not cabecalhos_planilha:
            cabecalhos_planilha = [
                'SOLICITAÇÃO', 'CPF', 'NOME', 'TIPO DE CERTIFICADO', 'TIPO DE CURSO',
                'CURSO', 'CERTIFICADORA', 'CONTRATO', 'STATUS DO EVENTO', 'ID DO EVENTO',
                'DATA CRIAÇÃO EVENTO', 'TELEFONE', 'DATA INÍCIO (ISO)', 'CRIAÇÃO MATRÍCULA (ISO)',
                'USER ID', 'RG', 'Nacionalidade', 'Data de Nascimento'
            ]
            sheet.append_row(cabecalhos_planilha, value_input_option='USER_ENTERED')
            log("ℹ️ Cabeçalhos inseridos na aba vazia.")

        log(f"📋 Colunas detectadas na planilha: {', '.join(cabecalhos_planilha)}")

        log("📝 Preparando Anti-Duplicidade do Google Sheets...")
        try:
            dados_existentes = sheet.get_all_values()
            chaves_existentes = set()
            if len(dados_existentes) > 1:
                headers_norm = [normalizar_texto(h) for h in dados_existentes[0]]
                idx_cpf = headers_norm.index("CPF") if "CPF" in headers_norm else 1
                idx_tipo = headers_norm.index("TIPO DE CERTIFICADO") if "TIPO DE CERTIFICADO" in headers_norm else 3
                idx_curso = headers_norm.index("CURSO") if "CURSO" in headers_norm else 5

                for row in dados_existentes[1:]:
                    cpf_row = row[idx_cpf].strip() if len(row) > idx_cpf else ""
                    tipo_row = row[idx_tipo].strip().upper() if len(row) > idx_tipo else ""
                    curso_row = row[idx_curso].strip().upper() if len(row) > idx_curso else ""
                    if cpf_row and curso_row:
                        chaves_existentes.add(f"{cpf_row}|{tipo_row}|{curso_row}")
        except Exception as e:
            log(f"⚠️ Erro ao verificar duplicidade: {e}")
            chaves_existentes = set()

        linhas_planilha = []
        for r in resultados:
            cpf = r.get("dataStudent", {}).get("cpf", "").strip()
            curso = r.get("dataCourse", {}).get("course", "").strip()
            
            tipo_raw = r.get("type", "").lower()
            if tipo_raw == "digital": tipo_certificado = "Digital"
            elif tipo_raw == "print": tipo_certificado = "Impresso"
            else: tipo_certificado = tipo_raw.capitalize()
            
            # Trava anti-duplicidade
            chave_atual = f"{cpf}|{tipo_certificado.upper()}|{curso.upper()}"
            if chave_atual in chaves_existentes:
                continue 
            chaves_existentes.add(chave_atual)
            
            nome = r.get("dataStudent", {}).get("name", "")
            tipo_curso = r.get("dataCourse", {}).get("courseType", "")
            certificadora = r.get("dataCourse", {}).get("certifier", "")
            
            dt_solicita_crua = r.get("createdAt", "")[:10]
            try: dt_solicita = datetime.strptime(dt_solicita_crua, "%Y-%m-%d").strftime("%d/%m/%Y")
            except: dt_solicita = dt_solicita_crua
                
            # Extrair dados de matrícula (enrolment)
            contrato = "N/A"
            data_inicio_iso = ""
            criacao_matricula_iso = ""
            previsao_termino = "N/A"
            enrolments_raw = r.get("enrolment", [])
            enr = enrolments_raw[0] if (enrolments_raw and len(enrolments_raw) > 0) else {}
            if enr:
                contrato = str(enr.get("_id", "N/A"))
                criacao_matricula_iso = str(enr.get("createdAt") or "")
                rc = enr.get("registryCourse", {})
                data_inicio_iso = str(rc.get("dateStart") or enr.get("createdAt") or "")
                
                # Previsão de término
                crs = rc.get("course", {})
                meses_minimos = crs.get("minMonthsToComplete")
                data_inicio_fmt = formatar_data(data_inicio_iso)
                if meses_minimos and data_inicio_fmt != "N/A":
                    previsao_termino = calcular_previsao_termino(data_inicio_fmt, meses_minimos)
                else:
                    previsao_termino = formatar_data(enr.get("expiredAt"))
            
            # Dados do Aluno via API (Telefone, RG, Nacionalidade, Data de Nascimento, User ID)
            telefone = "N/A"
            rg = ""
            nacionalidade = ""
            data_nascimento = ""
            user_id = ""

            if cpf:
                try:
                    h_tel = headers.copy()
                    h_tel["requestOrigin"] = "busca-rapida-pesquisa"
                    rota_tel = f'students/students/cpf/{cpf}?populate={{}}'
                    d_tel = bater_na_api(rota_tel, h_tel)
                    if d_tel and d_tel.get("data"):
                        dt_aluno = d_tel["data"]
                        tel_raw = dt_aluno.get("cellPhone") or dt_aluno.get("whatsApp") or dt_aluno.get("phone") or "N/A"
                        telefone = str(tel_raw).strip()
                        
                        rg = str(dt_aluno.get("identity") or dt_aluno.get("rg") or "").strip()
                        
                        nacionalidade = str(dt_aluno.get("nationality") or "").strip()
                        if not nacionalidade:
                            nacionalidade = "Brasileira"
                        
                        bdate_raw = dt_aluno.get("birthDate") or ""
                        if bdate_raw:
                            try:
                                data_nascimento = datetime.strptime(bdate_raw[:10], "%Y-%m-%d").strftime("%d/%m/%Y")
                            except:
                                data_nascimento = bdate_raw[:10]
                                
                        u = dt_aluno.get("user")
                        if isinstance(u, dict):
                            user_id = str(u.get("_id") or "")
                        else:
                            user_id = str(dt_aluno.get("_userId") or "")
                except Exception:
                    telefone = "N/A"
            
            # Mapa semântico de todos os campos possíveis
            mapa_campos = {
                "SOLICITACAO": dt_solicita,
                "CPF": cpf,
                "NOME": nome,
                "TIPO DE CERTIFICADO": tipo_certificado,
                "TIPO DE CURSO": tipo_curso,
                "CURSO": curso,
                "CERTIFICADORA": certificadora,
                "CONTRATO": contrato,
                "STATUS DO EVENTO": "PENDENTE_ENVIO",
                "ID DO EVENTO": "N/A",
                "DATA CRIACAO EVENTO": datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
                "TELEFONE": telefone,
                "DATA INICIO (ISO)": data_inicio_iso,
                "CRIACAO MATRICULA (ISO)": criacao_matricula_iso,
                "USER ID": user_id,
                "RG": rg,
                "NACIONALIDADE": nacionalidade,
                "NATURALIDADE": nacionalidade, # Retrocompatibilidade caso ainda esteja com cabeçalho antigo
                "DATA DE NASCIMENTO": data_nascimento,
                # Chaves auxiliares/retrocompatíveis:
                "STATUS": "",
                "LOTE": "",
                "OBSERVACAO": "",
                "PARCERIA": "",
                "ENVIADO AO BITRIX": "",
                "ALERTA DUPLICIDADE": "",
                "DATA DE INSCRICAO": formatar_data(criacao_matricula_iso),
                "DATA DE INICIO": formatar_data(data_inicio_iso),
                "PRAZO MINIMO PARA CONCLUSAO": previsao_termino
            }

            # Monta a linha exatamente na ordem e direção dos cabeçalhos da planilha
            linha_ordenada = []
            for col_header in cabecalhos_planilha:
                col_norm = normalizar_texto(col_header)
                val = mapa_campos.get(col_norm, "")
                linha_ordenada.append(val)
            
            linhas_planilha.append(linha_ordenada)

        if len(linhas_planilha) == 0:
            log("✅ Base Inteiramente Atualizada! Todos os registros filtrados já constavam na planilha. Encerrando.")
            return

        log(f"🚀 INSERÇÃO DE LOTE: Escrevendo {len(linhas_planilha)} novas linhas na aba '{ABA_PLANILHA}'...")
        try:
            sheet.append_rows(linhas_planilha, value_input_option='USER_ENTERED')
            log(f"🎉 SUCESSO ABSOLUTO! Planilha espelhada e retroalimentada na Nuvem!")
            for linha in linhas_planilha:
                log(f"👤 Aluno inserido: {linha[2]} | Curso: {linha[5]} | Tipo: {linha[4]}")
        except Exception as e:
            log(f"❌ Erro Físico ao registrar os dados no Google Sheets: {e}")

    except Exception as e:
        log(f"❌ ERRO CRÍTICO NA ROTINA MAIN: {e}")
    finally:
        log("🏁 Execução Automatizada Concluída.")
        log("FINALIZADO_LISTADOR", tipo="SISTEMA")

def atualizar_colunas_novas_linhas_existentes(session_id=None):
    if session_id:
        session_context_listador.session_id = session_id
    log("="*60)
    log("🔄 INICIANDO ATUALIZAÇÃO RETROATIVA DAS COLUNAS P, Q E R")
    log("="*60)
    
    try:
        log(f"📖 Conectando à Planilha '{GOOGLE_SHEET_NAME}', Aba '{ABA_PLANILHA}'...")
        sheet = setup_google_sheets(ABA_PLANILHA)
        if not sheet:
            log("❌ Erro ao conectar ao Google Sheets. Encerrando.")
            return

        all_vals = sheet.get_all_values()
        if len(all_vals) <= 1:
            log("✅ Planilha vazia ou apenas com cabeçalhos.")
            return

        hex_re = re.compile(r'^[0-9a-fA-F]{24}$')
        pendentes = []
        for idx, row in enumerate(all_vals[1:], start=2):
            val_p = row[15].strip() if len(row) > 15 else ''
            val_q = row[16].strip() if len(row) > 16 else ''
            val_r = row[17].strip() if len(row) > 17 else ''
            
            # Se qualquer uma das 3 colunas estiver vazia
            if not val_p or not val_q or not val_r:
                cpf = row[1].strip() if len(row) > 1 else ''
                nome = row[2].strip() if len(row) > 2 else ''
                curso = row[5].strip() if len(row) > 5 else ''
                contrato = row[7].strip() if len(row) > 7 else ''
                pendentes.append({
                    "row": idx,
                    "cpf": cpf,
                    "nome": nome,
                    "curso": curso,
                    "contrato": contrato,
                    "val_p": val_p,
                    "val_q": val_q,
                    "val_r": val_r
                })

        total_pendentes = len(pendentes)
        log(f"📊 Total de linhas na planilha: {len(all_vals)-1} | Linhas pendentes de atualização em P, Q e R: {total_pendentes}")

        if total_pendentes == 0:
            log("✨ Todas as linhas já estão com as colunas P, Q e R 100% preenchidas!")
            return

        log("🔑 Autenticando na API ESP...")
        res_login = requests.post(URL_LOGIN_ESTATICA, json={"email": EMAIL_ACESSO, "password": SENHA_ACESSO}, headers=HEADERS_PADRAO)
        if res_login.status_code != 200:
            log("❌ Falha crítica no login da API ESP.")
            return

        token_auth = res_login.json().get("data", {}).get("user", {}).get("authorization")
        headers = HEADERS_PADRAO.copy()
        headers["Authorization"] = token_auth

        def obter_dados_aluno(item):
            row_idx = item["row"]
            contrato = item["contrato"]
            cpf = item["cpf"]
            curso_plan = item["curso"].strip().upper()
            
            enr = None
            # 1. Tenta via ID de contrato direto
            if hex_re.match(contrato):
                rota = f'students/enrolments/{contrato}?populate={{}}'
                d = bater_na_api(rota, headers)
                if d and 'data' in d:
                    enr = d['data']
            
            # 2. Se não encontrou ou ID não é hex, tenta busca por CPF
            if not enr and cpf:
                rota_cpf = f'students/enrolments?page=1&limit=10&aggregate=[{{"$match":{{"cpf":"{cpf}"}}}},{{"$sort":{{"createdAt":-1}}}}]'
                d_cpf = bater_na_api(rota_cpf, headers)
                if d_cpf and 'data' in d_cpf and len(d_cpf['data']) > 0:
                    for mat in d_cpf['data']:
                        nome_crs = mat.get("registryCourse", {}).get("course", {}).get("_name", "").strip().upper()
                        if curso_plan and (curso_plan in nome_crs or nome_crs in curso_plan):
                            enr = mat
                            break
                    if not enr:
                        enr = d_cpf['data'][0]

            if not enr:
                return {
                    "row": row_idx,
                    "nome": item["nome"],
                    "p": item["val_p"] or "N/A",
                    "q": item["val_q"] or "N/A",
                    "r": item["val_r"] or "N/A"
                }

            dt_insc = formatar_data(enr.get("createdAt"))
            rc = enr.get("registryCourse", {})
            dt_ini = formatar_data(rc.get("dateStart") or enr.get("createdAt"))
            crs = rc.get("course", {})
            min_m = crs.get("minMonthsToComplete")
            if min_m and dt_ini != "N/A":
                prev = calcular_previsao_termino(dt_ini, min_m)
            else:
                prev = formatar_data(enr.get("expiredAt"))

            return {
                "row": row_idx,
                "nome": item["nome"],
                "p": dt_insc if dt_insc != "N/A" else (item["val_p"] or "N/A"),
                "q": dt_ini if dt_ini != "N/A" else (item["val_q"] or "N/A"),
                "r": prev if prev != "N/A" else (item["val_r"] or "N/A")
            }

        TAMANHO_LOTE = 100
        concluidos = 0

        for i in range(0, total_pendentes, TAMANHO_LOTE):
            sub_lote = pendentes[i:i + TAMANHO_LOTE]
            ranges_lote = []

            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                resultados_futures = list(executor.map(obter_dados_aluno, sub_lote))

            for res_aluno in resultados_futures:
                r_idx = res_aluno["row"]
                ranges_lote.append({
                    "range": f"P{r_idx}:R{r_idx}",
                    "values": [[res_aluno["p"], res_aluno["q"], res_aluno["r"]]]
                })

            try:
                sheet.batch_update(ranges_lote, value_input_option='USER_ENTERED')
                concluidos += len(sub_lote)
                pct = int((concluidos / total_pendentes) * 100)
                log(f"💾 [PROGRESSO] Lote gravado no Sheets: {concluidos}/{total_pendentes} alunos ({pct}%).")
            except Exception as e:
                log(f"❌ Erro ao gravar lote no Sheets: {e}")

            time.sleep(1.0)

        log(f"🎉 SUCESSO! {concluidos} linhas foram atualizadas com Inscrição (P), Início (Q) e Previsão (R)!")

    except Exception as e:
        log(f"❌ ERRO CRÍTICO NA ATUALIZAÇÃO RETROATIVA: {e}")
    finally:
        log("🏁 Processo de Atualização Concluído.")
        log("FINALIZADO_LISTADOR", tipo="SISTEMA")

def atualizar_telefones_linhas_existentes(session_id=None):
    if session_id:
        session_context_listador.session_id = session_id
    log("="*60)
    log("📞 INICIANDO ATUALIZAÇÃO RETROATIVA EXCLUSIVA DA COLUNA N (TELEFONE)")
    log("="*60)
    
    try:
        log(f"📖 Conectando à Planilha '{GOOGLE_SHEET_NAME}', Aba '{ABA_PLANILHA}'...")
        sheet = setup_google_sheets(ABA_PLANILHA)
        if not sheet:
            log("❌ Erro ao conectar ao Google Sheets. Encerrando.")
            return

        all_vals = sheet.get_all_values()
        if len(all_vals) <= 1:
            log("✅ Planilha vazia ou apenas com cabeçalhos.")
            return

        pendentes = []
        for idx, row in enumerate(all_vals[1:], start=2):
            val_n = row[13].strip() if len(row) > 13 else ''
            
            # Se a coluna N (Telefone) estiver vazia
            if not val_n:
                cpf = row[1].strip() if len(row) > 1 else ''
                nome = row[2].strip() if len(row) > 2 else ''
                if cpf:
                    pendentes.append({
                        "row": idx,
                        "cpf": cpf,
                        "nome": nome
                    })

        total_pendentes = len(pendentes)
        log(f"📊 Total de linhas na planilha: {len(all_vals)-1} | Linhas sem Telefone (Coluna N): {total_pendentes}")

        if total_pendentes == 0:
            log("✨ Todas as linhas já estão com a coluna N (Telefone) preenchida!")
            return

        log("🔑 Autenticando na API ESP...")
        res_login = requests.post(URL_LOGIN_ESTATICA, json={"email": EMAIL_ACESSO, "password": SENHA_ACESSO}, headers=HEADERS_PADRAO)
        if res_login.status_code != 200:
            log("❌ Falha crítica no login da API ESP.")
            return

        token_auth = res_login.json().get("data", {}).get("user", {}).get("authorization")
        headers = HEADERS_PADRAO.copy()
        headers["Authorization"] = token_auth
        headers["requestOrigin"] = "busca-rapida-pesquisa"

        def obter_telefone_aluno(item):
            row_idx = item["row"]
            cpf = item["cpf"]
            nome = item["nome"]
            
            telefone = "N/A"
            try:
                rota_tel = f'students/students/cpf/{cpf}?populate={{}}'
                d_tel = bater_na_api(rota_tel, headers)
                if d_tel and d_tel.get("data"):
                    dt_aluno = d_tel["data"]
                    telefone = dt_aluno.get("cellPhone") or dt_aluno.get("whatsApp") or dt_aluno.get("phone") or "N/A"
                    telefone = str(telefone).strip()
            except Exception:
                telefone = "N/A"

            return {
                "row": row_idx,
                "nome": nome,
                "telefone": telefone
            }

        TAMANHO_LOTE = 100
        concluidos = 0

        for i in range(0, total_pendentes, TAMANHO_LOTE):
            sub_lote = pendentes[i:i + TAMANHO_LOTE]
            ranges_lote = []

            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                resultados_futures = list(executor.map(obter_telefone_aluno, sub_lote))

            for res_aluno in resultados_futures:
                r_idx = res_aluno["row"]
                tel = res_aluno["telefone"]
                ranges_lote.append({
                    "range": f"N{r_idx}",
                    "values": [[tel]]
                })

            try:
                sheet.batch_update(ranges_lote, value_input_option='USER_ENTERED')
                concluidos += len(sub_lote)
                pct = int((concluidos / total_pendentes) * 100)
                log(f"💾 [TELEFONES] Lote gravado no Sheets: {concluidos}/{total_pendentes} alunos ({pct}%).")
            except Exception as e:
                log(f"❌ Erro ao gravar lote de telefones no Sheets: {e}")

            time.sleep(1.0)

        log(f"🎉 SUCESSO! {concluidos} linhas foram atualizadas com o Telefone na Coluna N!")

    except Exception as e:
        log(f"❌ ERRO CRÍTICO NA ATUALIZAÇÃO DE TELEFONES: {e}")
    finally:
        log("🏁 Processo de Telefones Concluído.")
        log("FINALIZADO_LISTADOR", tipo="SISTEMA")

if __name__ == "__main__":
    executar_rotina_automatizada()
