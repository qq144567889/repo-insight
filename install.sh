#!/bin/bash
# ============================================================
# Repo Insight 新手安装脚本（macOS / Linux）
# 来源作者：Yang YIZHU  (https://github.com/repo-lens) · 禁止商业售卖
# ------------------------------------------------------------
# 你不需要懂命令。把下面这行交给它，它会替你把项目跑起来：
#     bash install.sh 作者名/仓库名
# 例如：
#     bash install.sh paperclipai/paperclip
#
# 它会做三件事：
#   1. 把项目下载到 ~/RepoInsight/ 里（只动这一个文件夹）
#   2. 优先用 Docker 的隔离小盒子运行；没装 Docker 会给你选择
#   3. 启动后自动打开浏览器
#
# 它不会修改系统设置，也不会装系统级软件。
# 想停止：在这个窗口按 Control + C，或直接关掉窗口。
# 想彻底删除：bash install.sh --clean 作者名/仓库名
# ============================================================
set -u

# 支持两种用法：
#   1) bash install.sh 作者名/仓库名 [端口]
#   2) 扩展生成的「双击安装脚本」会在开头写入 RI_PROJECT / RI_PORT，然后带上本文件全文
PROJECT="${RI_PROJECT:-${1:-}}"
PORT="${RI_PORT:-3000}"
ACTION="install"

if [ "${1:-}" = "--clean" ]; then
  ACTION="clean"
  PROJECT="${RI_PROJECT:-${2:-}}"
  PORT="${RI_PORT:-${3:-3000}}"
fi

say()  { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '\n\033[1;33m⚠️  %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✘ %s\033[0m\n' "$*"; printf '\n按回车关闭…'; read -r _ || true; exit 1; }

clear 2>/dev/null || true
printf '\033[1m欢迎使用 Repo Insight 新手安装脚本\033[0m\n'
info "（来源作者 Yang YIZHU · 禁止商业售卖；本脚本开源可自行查看）"

if [ -z "$PROJECT" ] || [ "${PROJECT#*/}" = "$PROJECT" ]; then
  die "用法：bash install.sh 作者名/仓库名
例如：bash install.sh paperclipai/paperclip"
fi

OWNER="${PROJECT%%/*}"
NAME="${PROJECT#*/}"
SAFE_NAME="$(printf '%s' "$NAME" | tr -c 'A-Za-z0-9._-' '-')"
HOME_DIR="$HOME/RepoInsight"
WORK_DIR="$HOME_DIR/$SAFE_NAME"
CONTAINER="repo-insight-$SAFE_NAME"
VOLUME="repo-insight-$SAFE_NAME-data"

# ---------- 清理模式 ----------
if [ "$ACTION" = "clean" ]; then
  say "开始清理 $PROJECT"
  if command -v docker >/dev/null 2>&1; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 && ok "已删除容器 $CONTAINER" || info "没有找到容器（可能已经删过）"
    docker volume rm "$VOLUME" >/dev/null 2>&1 && ok "已删除数据卷 $VOLUME" || info "没有找到数据卷"
  fi
  if [ -d "$WORK_DIR" ]; then
    rm -rf "$WORK_DIR" && ok "已删除项目文件夹 $WORK_DIR"
  else
    info "项目文件夹不存在：$WORK_DIR"
  fi
  [ -d "$HOME_DIR" ] && rmdir "$HOME_DIR" 2>/dev/null
  say "清理完成。你的系统没有留下这个项目的内容。"
  printf '\n按回车关闭…'; read -r _ || true
  exit 0
fi

# ---------- 第 1 步：下载 ----------
say "第 1 步 / 共 3 步：把项目下载到你的电脑"
if [ -d "$WORK_DIR/.repo-insight-downloaded" ]; then
  ok "之前已经下载过，跳过下载（想重新下载请先运行 --clean）"
else
  mkdir -p "$WORK_DIR" || die "创建文件夹失败：$WORK_DIR"
  cd "$WORK_DIR" || die "进入文件夹失败：$WORK_DIR"
  info "正在下载，请稍等……"
  OK_DOWNLOAD=0
  for BRANCH in main master; do
    if curl -fsSL "https://codeload.github.com/$OWNER/$NAME/zip/refs/heads/$BRANCH" -o project.zip 2>/dev/null; then
      if unzip -oq project.zip 2>/dev/null; then
        for D in */; do [ -d "$D" ] && cp -R "$D". . && rm -rf "$D"; done
        rm -f project.zip
        touch .repo-insight-downloaded
        OK_DOWNLOAD=1
        break
      fi
    fi
  done
  [ "$OK_DOWNLOAD" = "1" ] || die "下载失败。多半是网络问题（GitHub 有时候会连不上）。
建议：改用插件里的「方案 A 一键沙箱体验」——那个完全不动你的电脑。"
  ok "下载完成：$WORK_DIR"
fi

# ---------- 第 2 步：选择运行方式 ----------
say "第 2 步 / 共 3 步：选择怎么运行"
USE_DOCKER=0
if command -v docker >/dev/null 2>&1; then
  USE_DOCKER=1
  if docker info >/dev/null 2>&1; then
    ok "检测到 Docker，会用「隔离小盒子」方式运行（最安全，不碰你的系统）"
  else
    warn "检测到 Docker，但它好像没启动。"
    info "请先打开 Docker Desktop（在启动台里找到那只小鲸鱼），等它运行起来。"
    printf '\n装好了/启动了以后，再运行一次本脚本就行。按回车关闭…'; read -r _ || true
    exit 1
  fi
else
  warn "你的电脑还没有装 Docker。"
  printf '  Docker 是一个免费的软件，装好之后跑开源项目基本不会把电脑搞乱。\n'
  printf '  下载地址：https://www.docker.com/products/docker-desktop/\n\n'
  printf '  现在你有两个选择：\n'
  printf '    1) 先装 Docker，装完再运行一次本脚本（推荐）\n'
  printf '    2) 用「简易方式」直接在电脑上跑（会用你当前的用户权限）\n'
  printf '\n  请输入 1 或 2，然后按回车（直接回车＝帮我打开下载页）：'
  read -r ANSWER || ANSWER="1"
  case "$ANSWER" in
    2)
      printf '  好的，用简易方式。请记住：这个项目会用你电脑的权限运行。\n'
      ;;
    *)
      (command -v open >/dev/null 2>&1 && open "https://www.docker.com/products/docker-desktop/") 2>/dev/null || \
      (command -v xdg-open >/dev/null 2>&1 && xdg-open "https://www.docker.com/products/docker-desktop/") 2>/dev/null || true
      die "已经帮你打开 Docker 下载页。装好后请再运行一次本脚本。"
      ;;
  esac
fi

cd "$WORK_DIR" || die "进入项目文件夹失败"

# 自动猜启动方式
RUN_CMD=""
SETUP_CMD=""
if [ -f package.json ]; then
  IMAGE="node:20"
  if [ -f pnpm-lock.yaml ]; then
    SETUP_CMD="corepack enable && pnpm install"
    RUN_CMD="pnpm run dev || pnpm start"
  elif [ -f yarn.lock ]; then
    yarn --version >/dev/null 2>&1 || SETUP_CMD="corepack enable"
    SETUP_CMD="${SETUP_CMD:+$SETUP_CMD && }yarn install"
    RUN_CMD="yarn dev || yarn start"
  else
    SETUP_CMD="npm install"
    RUN_CMD="npm run dev || npm start"
  fi
elif [ -f requirements.txt ] || [ -f pyproject.toml ]; then
  IMAGE="python:3.12"
  ENTRY=""
  for F in main.py app.py manage.py server.py run.py bot.py; do
    [ -f "$F" ] && ENTRY="$F" && break
  done
  if [ -f requirements.txt ]; then SETUP_CMD="pip install -r requirements.txt"; fi
  if [ -n "$ENTRY" ]; then RUN_CMD="python $ENTRY"; else RUN_CMD="python -c \"print('请查看 README 指定的启动命令')\""; fi
elif [ -f go.mod ]; then
  IMAGE="golang:1.22"; SETUP_CMD="go build ./..."; RUN_CMD="go run ."
elif [ -f Cargo.toml ]; then
  IMAGE="rust:1"; SETUP_CMD="cargo build --release"; RUN_CMD="cargo run --release"
elif [ -f docker-compose.yml ] || [ -f docker-compose.yaml ] || [ -f compose.yaml ]; then
  IMAGE=""; RUN_CMD="docker compose up"
else
  IMAGE="ubuntu:24.04"; RUN_CMD="bash"
fi

# ---------- 第 3 步：启动 ----------
say "第 3 步 / 共 3 步：启动"
info "第一次运行需要下载依赖，可能要几分钟，屏幕上刷很多东西是正常的。"
if [ "$USE_DOCKER" = "1" ] && [ -n "$IMAGE" ]; then
  info "运行方式：Docker 隔离容器（用完删掉容器即可，不动系统）"
  INNER="${SETUP_CMD:+$SETUP_CMD && }$RUN_CMD"
  ( sleep 10; (command -v open >/dev/null 2>&1 && open "http://localhost:$PORT") || (command -v xdg-open >/dev/null 2>&1 && xdg-open "http://localhost:$PORT") ) >/dev/null 2>&1 &
  docker run --rm -it --name "$CONTAINER" -p "$PORT:$PORT" \
    -v "$WORK_DIR:/app" -v "$VOLUME:/data" -w /app \
    -e "PORT=$PORT" "$IMAGE" bash -lc "$INNER"
elif [ "$USE_DOCKER" = "1" ]; then
  info "这个项目自带 Docker 配置，直接用它的方式启动"
  ( sleep 10; (command -v open >/dev/null 2>&1 && open "http://localhost:$PORT") || true ) >/dev/null 2>&1 &
  docker compose up
else
  warn "简易方式：直接在电脑上运行（会用你当前的用户权限）"
  if [ -n "$SETUP_CMD" ]; then
    info "安装依赖：$SETUP_CMD"
    bash -lc "$SETUP_CMD" || die "安装依赖失败了。可以改用「方案 A 沙箱体验」，或者把报错截图发到仓库 Issue。"
  fi
  ( sleep 10; (command -v open >/dev/null 2>&1 && open "http://localhost:$PORT") || true ) >/dev/null 2>&1 &
  info "启动：$RUN_CMD"
  bash -lc "$RUN_CMD"
fi

printf '\n'
printf '\033[1;32m  ✔ 已经结束运行\033[0m\n'
printf '\n下一步：\n'
printf '  · 如果刚才浏览器自动打开了 http://localhost:%s ，那就是成功了\n' "$PORT"
printf '  · 想再启动一次：重新运行本脚本（已经下载过，会很快）\n'
printf '  · 想彻底删掉（容器、数据、文件夹全清）：\n'
printf '        bash install.sh --clean %s\n' "$PROJECT"
printf '  · 遇到问题：把这一整屏截图，发到 https://github.com/repo-lens/repo-insight/issues\n'
printf '\n按回车关闭…'; read -r _ || true
