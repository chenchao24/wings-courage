@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   勇气之翼 - 本地服务器启动
echo ========================================
echo.
echo 正在启动 HTTP 服务器（端口 5173）...
echo 启动后请在浏览器访问：http://localhost:5173/
echo 按 Ctrl+C 可停止服务器
echo.
start "" http://localhost:5173/
npx http-server -p 5173 -c-1 --cors
pause
