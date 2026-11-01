@echo off
chcp 65001 > nul
setlocal
echo.
echo 即将把「AI修图提示词 Link」装进 Photoshop 自己的 Plug-ins 目录。
echo 装完后 Photoshop 每次启动都会自动加载它，不再需要 UXP Developer Tools。
echo 会弹出一次管理员确认窗口（只是复制文件）。
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-photoshop-plugin.ps1"
if errorlevel 1 pause
endlocal
