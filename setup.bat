@echo off
echo Setting up Codemia AI...

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js is not installed. Please install Node.js from https://nodejs.org/
    echo After installing Node.js, run this script again.
    pause
    exit /b 1
)

echo Node.js found. Installing dependencies...
npm install

if %errorlevel% neq 0 (
    echo Failed to install dependencies. Please check your internet connection and try again.
    pause
    exit /b 1
)

echo.
echo Creating environment file...
if not exist .env (
    copy .env.example .env
    echo Please edit .env file and add your API keys:
    echo - OPENAI_API_KEY=your_openai_key
    echo - ANTHROPIC_API_KEY=your_anthropic_key
    echo.
)

echo.
echo Setup complete! To start the server:
echo npm run dev
echo.
echo Then open http://localhost:3000 in your browser
pause
