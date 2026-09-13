@echo off
title vulkan launcher
cd /d "%~dp0"

rem Берём рантайм под разрядность системы. В 32-битном командном окне на
rem 64-битной Windows PROCESSOR_ARCHITECTURE показывает x86, а настоящая
rem разрядность лежит в PROCESSOR_ARCHITEW6432 - поэтому проверяем обе.
set "RT=runtime-x86"
if /i "%PROCESSOR_ARCHITECTURE%"=="AMD64" set "RT=runtime-x64"
if /i "%PROCESSOR_ARCHITEW6432%"=="AMD64" set "RT=runtime-x64"

if not exist "%RT%\bin\java.exe" (
  echo.
  echo   Рядом нет папки %RT% - архив распакован не целиком.
  echo   Распакуйте его полностью и запустите этот файл заново.
  echo.
  pause
  exit /b 1
)

if not exist "vulkan-launcher.jar" (
  echo.
  echo   Рядом нет файла vulkan-launcher.jar - архив распакован не целиком.
  echo.
  pause
  exit /b 1
)

echo.
echo   Запускаю vulkan launcher.
echo   Откроется браузер с интерфейсом - это и есть лаунчер.
echo.
echo   Чёрное окно свернётся вниз и должно остаться открытым:
echo   закрыть его значит выключить лаунчер.
echo   Если ничего не открылось - разверните это окно и прочтите текст.
echo.

start "vulkan launcher" /min "%RT%\bin\java.exe" -jar "vulkan-launcher.jar"
