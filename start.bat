@echo off
cd /d "%~dp0"
if not exist node_modules\.bin\cross-env (
    echo Installing dependencies...
    call pnpm install
    if errorlevel 1 (
        echo Install failed. Press any key to exit.
        pause >nul
        exit /b 1
    )
)
if not exist .env (
    echo Creating .env from .env.example...
    copy .env.example .env
)
call pnpm start
