@echo off
title YT-DLP Bridge Server
color 0B
cls

echo ================================================
echo      YT-DLP Bridge Server
echo ================================================
echo.

cd /d "%~dp0"

echo [Auto-Update 1] Checking project updates via Git (git pull)...
git pull 2>nul
echo [OK] Project code check finished.
echo.

echo [Auto-Update 2] Checking yt-dlp updates (yt-dlp -U)...
if exist "%~dp0backend\yt-dlp.exe" (
    "%~dp0backend\yt-dlp.exe" -U 2>nul
)
yt-dlp -U 2>nul
python -m pip install -U yt-dlp --no-warn-script-location 2>nul
echo [OK] yt-dlp update check finished.
echo.

cd /d "%~dp0backend"

echo [Check] Ensuring Flask is installed...
python -c "import flask" 2>nul
if %errorlevel% neq 0 (
    echo [Install] Flask not found. Installing flask + flask-cors...
    python -m pip install -r requirements.txt
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install Flask. Run: python -m pip install flask flask-cors
        pause
        exit /b 1
    )
)
echo [OK] Flask ready.
echo.

echo [Launch] Starting server on http://127.0.0.1:18080
echo [Info] Keep this window open while using the extension.
echo.

python yt-dlp-bridge.py

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server crashed with code %errorlevel%.
    pause
)
