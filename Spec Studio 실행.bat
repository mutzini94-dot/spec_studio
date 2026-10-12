@echo off
rem Spec Studio: start the local server (PPTX/PDF import + screenshot auto-implement) and open the editor.
rem Double-click this file. Close this window to stop the server.
chcp 65001 >nul
cd /d "%~dp0.."
set PY=python
where python >nul 2>nul || set PY=py
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:5180/api/ping | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  echo Spec Studio server is already running.
  start "" http://localhost:5180/spec-studio/
  exit /b 0
)
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 2; Start-Process 'http://localhost:5180/spec-studio/'"
%PY% spec-studio\tools\serve.py --port 5180
pause
