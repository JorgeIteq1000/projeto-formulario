@echo off
cd /d "%~dp0"
title Sistema de Emissao de Certificados

echo ============================================================
echo   Iniciando Sistema de Emissao de Certificados...
echo   - Painel (Frontend): http://localhost:5180
echo   - Servidor (API):    http://localhost:3000
echo ============================================================
echo.
start "" http://localhost:5180
call npm.cmd start

if %errorlevel% neq 0 (
    echo.
    echo [AVISO] O servidor foi encerrado.
    pause
)
