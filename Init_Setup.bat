@echo off
title CoCo Video Downloader Setup
color 0F

echo ========================================================
echo   CoCo Video Downloader Setup Tool
echo ========================================================
echo.
echo Checking Python installation...
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not added to PATH.
    echo.
    echo Opening Python download page...
    start https://www.python.org/downloads/
    echo.
    echo Install Tip: Please check "Add Python to PATH" during installation!
    echo.
    pause
    exit /b 1
)

echo.
echo Python detected. Starting initialization script...
python init_setup.py
if errorlevel 1 (
    echo.
    echo [ERROR] Setup failed.
    pause
    exit /b 1
)

echo.
echo ========================================================
echo   [OK] Setup completed successfully!
echo   Steps to use:
echo   1. Run Start_Server.bat to start Flask server.
echo   2. Load the 'extension' folder in browser extensions.
echo ========================================================
echo.
pause
