@echo off
rem Runs the Statement Sorter server on http://expensesort and restarts it if it stops.
rem Started hidden at Windows login by start-hidden.vbs (see install-autostart.ps1).
rem Listens on 127.0.0.2:80 so it can share port 80 with SoleTracker (which uses 127.0.0.1:80).

cd /d "%~dp0..\.."
set "PATH=C:\Program Files\nodejs;%PATH%"
set "HOST=127.0.0.2"
set "PORT=80"
if not exist data mkdir data

rem Already running? Don't start a second copy.
netstat -ano | findstr /r /c:"127.0.0.2:80 .*LISTENING" >nul && exit /b 0

if not exist node_modules\pdfjs-dist call npm install --omit=dev >> data\server.log 2>&1

:loop
echo [%date% %time%] starting Statement Sorter >> data\server.log
node server.js >> data\server.log 2>&1
echo [%date% %time%] server stopped, restarting in 5s >> data\server.log
timeout /t 5 /nobreak >nul
goto loop
