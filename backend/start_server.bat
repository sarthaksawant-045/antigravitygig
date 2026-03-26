@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
echo ========================================
echo   GIGBRIDGE SERVER STARTUP
echo ========================================
echo.
echo Starting Flask server...
echo Server will be available at: http://127.0.0.1:5000
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

python start_server.py

pause
