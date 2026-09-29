@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Repo Insight 新手安装

rem ============================================================
rem  Repo Insight 新手安装脚本（Windows）
rem  来源作者：Yang YIZHU (https://github.com/repo-lens) · 禁止商业售卖
rem ------------------------------------------------------------
rem  你不需要懂命令。双击本文件，或者在 PowerShell 里运行：
rem      .\install.bat 作者名/仓库名
rem  例如：
rem      .\install.bat paperclipai/paperclip
rem
rem  它会做三件事：下载项目 → 优先用 Docker 隔离运行 → 打开浏览器
rem  想彻底删除：install.bat clean 作者名/仓库名
rem ============================================================

set "PROJECT=%~1"
set "PORT=3000"
set "ACTION=install"
if /i "%PROJECT%"=="clean" (
  set "ACTION=clean"
  set "PROJECT=%~2"
)

echo.
echo ============================================
echo   Repo Insight 新手安装脚本
echo   （来源作者 Yang YIZHU · 禁止商业售卖）
echo ============================================

if "%PROJECT%"=="" goto usage
for /f "tokens=1,2 delims=/" %%a in ("%PROJECT%") do (
  set "OWNER=%%a"
  set "NAME=%%b"
)
if "%NAME%"=="" goto usage

set "HOME_DIR=%USERPROFILE%\RepoInsight"
set "WORK_DIR=%HOME_DIR%\%NAME%"
set "CONTAINER=repo-insight-%NAME%"
set "VOLUME=repo-insight-%NAME%-data"

if /i "%ACTION%"=="clean" goto clean

echo.
echo 第 1 步 / 共 3 步：把项目下载到你的电脑
if exist "%WORK_DIR%\.repo-insight-downloaded" (
  echo   之前已经下载过，跳过下载
) else (
  if not exist "%WORK_DIR%" mkdir "%WORK_DIR%"
  echo   正在下载，请稍等……
  set "OK=0"
  powershell -NoProfile -Command "try{Invoke-WebRequest -Uri 'https://codeload.github.com/%OWNER%/%NAME%/zip/refs/heads/main' -OutFile '%TEMP%\ri.zip' -UseBasicParsing;exit 0}catch{exit 1}" >nul 2>&1
  if !errorlevel!==0 set "OK=1"
  if !OK!==0 (
    powershell -NoProfile -Command "try{Invoke-WebRequest -Uri 'https://codeload.github.com/%OWNER%/%NAME%/zip/refs/heads/master' -OutFile '%TEMP%\ri.zip' -UseBasicParsing;exit 0}catch{exit 1}" >nul 2>&1
    if !errorlevel!==0 set "OK=1"
  )
  if !OK!==0 (
    echo.
    echo   下载失败。多半是网络问题（GitHub 有时候连不上）。
    echo   建议：改用浏览器插件里的「方案 A 一键沙箱体验」，那个完全不动你的电脑。
    goto end
  )
  powershell -NoProfile -Command "Expand-Archive -Path '%TEMP%\ri.zip' -DestinationPath '%TEMP%\ri-unzip' -Force" >nul 2>&1
  for /d %%d in ("%TEMP%\ri-unzip\*") do xcopy "%%d\*" "%WORK_DIR%\" /E /I /Y /Q >nul
  rmdir /s /q "%TEMP%\ri-unzip" 2>nul
  del "%TEMP%\ri.zip" 2>nul
  echo. > "%WORK_DIR%\.repo-insight-downloaded"
  echo   下载完成：%WORK_DIR%
)

echo.
echo 第 2 步 / 共 3 步：选择怎么运行
set "USE_DOCKER=0"
where docker >nul 2>&1
if %errorlevel%==0 (
  docker info >nul 2>&1
  if !errorlevel!==0 (
    set "USE_DOCKER=1"
    echo   检测到 Docker，会用「隔离小盒子」方式运行（最安全，不碰你的系统）
  ) else (
    echo.
    echo   检测到 Docker，但它好像没启动。
    echo   请先打开 Docker Desktop（开始菜单里搜索 Docker），等它运行起来再运行一次本脚本。
    goto end
  )
) else (
  echo.
  echo   你的电脑还没有装 Docker。
  echo   Docker 是一个免费的软件，装好之后跑开源项目基本不会把电脑搞乱。
  echo   下载地址：https://www.docker.com/products/docker-desktop/
  echo.
  echo   你有两个选择：
  echo     1 - 先装 Docker，装完再运行一次本脚本（推荐）
  echo     2 - 用「简易方式」直接在电脑上跑（会用你当前的用户权限）
  set /p "ANSWER=  请输入 1 或 2 然后回车（直接回车＝打开下载页）："
  if "!ANSWER!"=="2" (
    echo   好的，用简易方式。请注意：这个项目会用你电脑的权限运行。
  ) else (
    start "" "https://www.docker.com/products/docker-desktop/"
    echo   已经帮你打开 Docker 下载页。装好后请再运行一次本脚本。
    goto end
  )
)

cd /d "%WORK_DIR%"
set "IMAGE=ubuntu:24.04"
set "SETUP_CMD="
set "RUN_CMD=bash"
set "KIND=unknown"
if exist package.json set "KIND=node"
if exist requirements.txt set "KIND=python"
if exist pyproject.toml set "KIND=python"
if exist go.mod set "KIND=go"
if exist Cargo.toml set "KIND=rust"
if exist docker-compose.yml set "KIND=compose"
if exist compose.yaml set "KIND=compose"

if "%KIND%"=="node" (
  set "IMAGE=node:20"
  set "SETUP_CMD=npm install"
  set "RUN_CMD=npm run dev || npm start"
)
if "%KIND%"=="python" (
  set "IMAGE=python:3.12"
  set "SETUP_CMD=pip install -r requirements.txt"
  set "RUN_CMD=python main.py"
  if exist app.py set "RUN_CMD=python app.py"
  if exist manage.py set "RUN_CMD=python manage.py runserver 0.0.0.0:%PORT%"
)
if "%KIND%"=="go" (
  set "IMAGE=golang:1.22"
  set "SETUP_CMD=go build ./..."
  set "RUN_CMD=go run ."
)
if "%KIND%"=="rust" (
  set "IMAGE=rust:1"
  set "SETUP_CMD=cargo build --release"
  set "RUN_CMD=cargo run --release"
)

echo.
echo 第 3 步 / 共 3 步：启动
echo   第一次运行要下载依赖，可能要几分钟，屏幕上刷很多东西是正常的。

if "%USE_DOCKER%"=="1" (
  if "%KIND%"=="compose" (
    echo   这个项目自带 Docker 配置，用它自己的方式启动
    start "" cmd /c "timeout /t 10 >nul & start http://localhost:%PORT%"
    docker compose up
  ) else (
    echo   运行方式：Docker 隔离容器（用完删掉容器即可，不动系统）
    set "INNER=%SETUP_CMD%"
    if not "%SETUP_CMD%"=="" set "INNER=%SETUP_CMD% && %RUN_CMD%"
    if "%SETUP_CMD%"=="" set "INNER=%RUN_CMD%"
    start "" cmd /c "timeout /t 10 >nul & start http://localhost:%PORT%"
    docker run --rm -it --name "%CONTAINER%" -p %PORT%:%PORT% -v "%WORK_DIR%:/app" -v "%VOLUME%:/data" -w /app -e PORT=%PORT% %IMAGE% bash -lc "!INNER!"
  )
) else (
  echo   简易方式：直接在电脑上运行（会用你当前的用户权限）
  if not "%SETUP_CMD%"=="" (
    echo   安装依赖：%SETUP_CMD%
    call %SETUP_CMD%
    if !errorlevel! neq 0 (
      echo   安装依赖失败了。可以改用「方案 A 沙箱体验」，或把报错截图发到仓库 Issue。
      goto end
    )
  )
  start "" cmd /c "timeout /t 10 >nul & start http://localhost:%PORT%"
  call %RUN_CMD%
)

echo.
echo   已经结束运行
echo.
echo 下一步：
echo   · 如果浏览器自动打开了 http://localhost:%PORT% ，那就是成功了
echo   · 想再启动一次：双击本脚本即可（已经下载过，会很快）
echo   · 想彻底删掉：install.bat clean %PROJECT%
echo   · 遇到问题：把这一屏截图发到 https://github.com/repo-lens/repo-insight/issues
goto end

:clean
echo.
echo 开始清理 %PROJECT%
where docker >nul 2>&1
if %errorlevel%==0 (
  docker rm -f "%CONTAINER%" >nul 2>&1
  docker volume rm "%VOLUME%" >nul 2>&1
  echo   已尝试删除容器与数据卷
)
if exist "%WORK_DIR%" (
  rmdir /s /q "%WORK_DIR%"
  echo   已删除项目文件夹 %WORK_DIR%
)
echo   清理完成。你的系统没有留下这个项目的内容。
goto end

:usage
echo.
echo 用法：install.bat 作者名/仓库名
echo 例如：install.bat paperclipai/paperclip
echo 清理：install.bat clean 作者名/仓库名

:end
echo.
pause
