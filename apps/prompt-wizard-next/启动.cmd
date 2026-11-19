@echo off
chcp 65001 >nul
title ai修图提示词助手
cd /d "%~dp0"

if not defined PW_WEB_PORT set "PW_WEB_PORT=5173"

rem 已经在运行就直接开浏览器。否则再起一个实例会撞端口，
rem 而重复启动恰恰是最容易发生的情况（上次的窗口还开着）。
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $null = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri 'http://127.0.0.1:%PW_WEB_PORT%/api/health'; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo.
  echo 服务已经在运行，正在打开浏览器...
  echo.
  start "" "http://127.0.0.1:%PW_WEB_PORT%/"
  exit /b 0
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo 未检测到 Node.js。请先安装：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo 首次运行，正在安装依赖，可能需要几分钟...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo 依赖安装失败，请检查网络后重试。
    echo.
    pause
    exit /b 1
  )
)

echo.
echo 正在启动，就绪后会自动打开浏览器。
echo 关闭本窗口即可停止服务。
echo.

call npm run dev

echo.
echo 服务已停止。
pause
