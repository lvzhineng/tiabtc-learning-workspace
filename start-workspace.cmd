@echo off
chcp 65001 >nul
title TiaBTC Learning Workspace
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-workspace.ps1" -Page learning
if errorlevel 1 (
  echo.
  echo 启动失败，请查看上方错误信息或 .run 目录中的日志。
  pause
)
