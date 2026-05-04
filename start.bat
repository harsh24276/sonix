@echo off
echo Starting SONIX Music Player...
echo.

cd /d "%~dp0"
start "" python "%~dp0backend\app.py"
echo Backend + frontend starting on http://localhost:7842
echo.
echo Browser will open in 2 seconds...
timeout /t 2 /nobreak >nul
start "" "http://localhost:7842"
