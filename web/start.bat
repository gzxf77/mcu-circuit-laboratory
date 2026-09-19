@echo off
netstat -ano | findstr ":5173" | findstr LISTENING >nul
if errorlevel 1 (
  start "Circuit Lab dev" /min cmd /k "cd /d E:\VSCode\MCU\web && npm run dev"
  ping -n 5 127.0.0.1 >nul
)
start "" "http://localhost:5173/?level=1"
