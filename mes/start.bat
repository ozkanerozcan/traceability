@echo off
cd /d "%~dp0packages\backend"
node dist\server.js
pause