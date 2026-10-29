@echo off
chcp 65001 >nul
title 打开 ai修图提示词助手
cd /d "%~dp0"

if not defined PW_WEB_PORT set "PW_WEB_PORT=5173"

rem 服务在运行就直接开浏览器，没运行就先拉起来（启动器会在就绪后自己打开）
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $null = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri 'http://127.0.0.1:%PW_WEB_PORT%/api/health'; exit 0 } catch { exit 1 }"

if errorlevel 1 (
  echo.
  echo 服务尚未运行，正在启动，就绪后会自动打开浏览器...
  echo.
  start "" "%~dp0启动.cmd"
  exit /b 0
)

start "" "http://127.0.0.1:%PW_WEB_PORT%/"
