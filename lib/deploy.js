/*!
 * Repo Insight · 开源项目解读器（Chrome 扩展 / Manifest V3）
 * 来源作者：Yang YIZHU  (https://github.com/repo-lens)
 * 禁止商业售卖 —— 完整条款见仓库根目录 LICENSE 与 NOTICE.md
 * 任何再发布都必须完整保留本段署名信息，不得删除、隐藏或替换。
 */
// 部署方案：沙箱链接、本地部署脚本、只读环境检测脚本、Markdown 章节

import { redactDocument } from "./security.js";
import { isolationAdvice } from "./risk.js";

export const DEFAULT_PORT = 3000;

/** 仓库自带的通用安装脚本（新手方案 C 用它，避免逻辑出现两份） */
export const INSTALLER_FILES = { mac: "install.sh", win: "install.bat" };
export const REPO_SLUG = "repo-lens/repo-insight";

const STACK_RUNNER = {
  node: { image: "node:20", setup: "npm install", run: "npm run dev || npm start", port: 3000, needs: ["node", "npm"] },
  "python-poetry": { image: "python:3.12", setup: "pip install poetry && poetry install", run: "poetry run python main.py", port: 8000, needs: ["python3"] },
  python: { image: "python:3.12", setup: "pip install -r requirements.txt", run: "python main.py", port: 8000, needs: ["python3"] },
  go: { image: "golang:1.22", setup: "go build ./...", run: "go run .", port: 8080, needs: ["go"] },
  rust: { image: "rust:1", setup: "cargo build --release", run: "cargo run --release", port: 8080, needs: ["cargo"] },
  make: { image: "debian:stable", setup: "make", run: "make run || make", port: 8080, needs: ["make"] },
  "docker-compose": { image: "", setup: "", run: "docker compose up -d", port: 3000, needs: ["docker"] },
  unknown: { image: "ubuntu:24.04", setup: "", run: "bash", port: 3000, needs: ["docker"] },
};

const PY_ENTRIES = ["main.py", "app.py", "manage.py", "server.py", "run.py", "bot.py"];

/** 按技术栈与根目录文件推断容器镜像与启动命令 */
export function resolveRunner(stack, files = []) {
  const runner = { ...(STACK_RUNNER[stack] ?? STACK_RUNNER.unknown) };
  const names = files.map((f) => String(f.name || "").toLowerCase());

  if (stack === "python" || stack === "python-poetry") {
    const entry = PY_ENTRIES.find((e) => names.includes(e));
    if (entry) runner.run = runner.run.replace("main.py", entry);
    else runner.run = "bash   # 未识别到入口文件，请按 README 指定";
  }
  if (stack === "node" && names.includes("pnpm-lock.yaml")) {
    runner.setup = "corepack enable && pnpm install";
    runner.run = "pnpm run dev || pnpm start";
  }
  return runner;
}

const sh = (lines) => lines.join("\n");

/** 一键本地部署脚本：默认容器隔离，支持 --dry-run / --host / --clean */
export function buildDeployScript({ owner, repo, stack = "unknown", files = [], port = DEFAULT_PORT }) {
  const runner = resolveRunner(stack, files);
  const container = `repo-insight-${repo}`.replace(/[^A-Za-z0-9_.-]/g, "-");
  const volume = `${container}-data`;
  const workDir = `$HOME/.repo-insight/${repo}`;
  const inner = runner.setup ? `${runner.setup} && ${runner.run}` : runner.run;

  const lines = [
    "#!/usr/bin/env bash",
    "# ============================================================",
    "# Repo Insight 生成的部署脚本",
    `# 仓库：${owner}/${repo}`,
    `# 生成时间：${new Date().toISOString()}`,
    "# 默认行为：在 Docker 容器内运行，不改动宿主机系统",
    "#",
    "# 参数：",
    "#   --dry-run   只打印将要执行的命令，不做任何修改（建议先跑一次）",
    "#   --host      直接在宿主机运行（不推荐，需输入 yes 二次确认）",
    "#   --clean     删除容器、数据卷与克隆目录",
    "#   --port N    指定端口（默认 " + port + "）",
    "#   --help      查看帮助",
    "#",
    "# 执行前请通读本脚本。仓库内的安装脚本拥有你赋予它的权限。",
    "# ============================================================",
    "set -euo pipefail",
    "",
    `REPO_URL="https://github.com/${owner}/${repo}"`,
    `WORK_DIR="${workDir}"`,
    `IMAGE="${runner.image || "ubuntu:24.04"}"`,
    `PORT="${port}"`,
    `CONTAINER="${container}"`,
    `VOLUME="${volume}"`,
    'MODE="docker"',
    "DRY_RUN=0",
    "",
    "log()  { printf '[repo-insight] %s\\n' \"$*\"; }",
    'warn() { printf "[repo-insight][警告] %s\\n" "$*" >&2; }',
    'run()  { if [ "$DRY_RUN" = "1" ]; then log "DRY-RUN: $*"; else "$@"; fi; }',
    "",
    "usage() {",
    "  sed -n '2,17p' \"$0\" | sed 's/^# \\{0,1\\}//'",
    "  exit 0",
    "}",
    "",
    'for arg in "$@"; do',
    '  case "$arg" in',
    "    --dry-run) DRY_RUN=1 ;;",
    '    --host)    MODE="host" ;;',
    '    --clean)   MODE="clean" ;;',
    "    --port=*)  PORT=\"${arg#--port=}\" ;;",
    "    --help|-h) usage ;;",
    '    *) warn "未知参数：$arg（用 --help 查看用法）"; exit 2 ;;',
    "  esac",
    "done",
    "",
    "need() {",
    '  command -v "$1" >/dev/null 2>&1 || {',
    '    warn "缺少 $1，请先安装后再运行（示例：https://docs.docker.com/get-docker/）"',
    "    exit 1",
    "  }",
    "}",
    "",
    "cleanup() {",
    '  log "清理容器与数据卷…"',
    '  if command -v docker >/dev/null 2>&1; then',
    '    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true',
    '    docker volume rm "$VOLUME" >/dev/null 2>&1 || true',
    "  fi",
    '  rm -rf "$WORK_DIR"',
    '  log "已清理：容器、数据卷、$WORK_DIR"',
    "}",
    "",
    "fetch_repo() {",
    '  run mkdir -p "$WORK_DIR"',
    '  if [ ! -d "$WORK_DIR/.git" ]; then',
    '    log "克隆仓库到 $WORK_DIR"',
    '    run git clone --depth 1 "$REPO_URL" "$WORK_DIR"',
    "  else",
    '    log "复用已有克隆目录 $WORK_DIR"',
    "  fi",
    "}",
    "",
    "deploy_docker() {",
    '  need docker',
    "  fetch_repo",
    '  log "启动容器（首次会拉取镜像并安装依赖，耗时较长）"',
    '  log "访问地址：http://localhost:$PORT"',
    `  run docker run --rm -it --name "$CONTAINER" -p "$PORT:$PORT" \\`,
    '    -v "$WORK_DIR:/app" -v "$VOLUME:/data" -w /app \\',
    '    -e "PORT=$PORT" "$IMAGE" bash -lc ' + JSON.stringify(inner),
    "}",
    "",
    "deploy_host() {",
    '  warn "宿主机模式：仓库脚本将以你的用户权限运行，可能读写本机文件。"',
    '  printf "确认继续？输入 yes 回车："',
    '  read -r answer',
    '  [ "$answer" = "yes" ] || { log "已取消。"; exit 1; }',
    "  fetch_repo",
    '  cd "$WORK_DIR"',
  ];

  if (runner.setup) lines.push(`  log "安装依赖：${runner.setup}"`, `  run bash -lc ${JSON.stringify(runner.setup)}`);
  lines.push(
    `  log "启动：${runner.run}"`,
    `  run bash -lc ${JSON.stringify(runner.run)}`,
    "}",
    "",
    'case "$MODE" in',
    '  clean) cleanup ;;',
    "  host)  deploy_host ;;",
    "  *)     deploy_docker ;;",
    "esac",
    ""
  );
  return sh(lines);
}

/** 只读环境检测脚本：不安装、不修改任何配置，仅输出 JSON */
export function buildDetectEnvScript({ port = DEFAULT_PORT } = {}) {
  return sh([
    "#!/usr/bin/env bash",
    "# Repo Insight 只读环境检测脚本",
    "# 只做检测并输出一行 JSON：不安装依赖、不修改任何文件或配置。",
    "# 用法：bash repo-insight-detect-env.sh",
    "# 把输出的 JSON 整行复制回插件即可。",
    "set -u",
    "",
    "ver() {",
    '  if command -v "$1" >/dev/null 2>&1; then',
    '    "$1" --version 2>/dev/null | head -1 | tr -d "\\n"',
    "  else",
    "    printf '未安装'",
    "  fi",
    "}",
    "",
    `port_state() {`,
    `  if (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; then`,
    '    exec 3>&- 2>/dev/null || true',
    "    printf '占用'",
    "  else",
    "    printf '空闲'",
    "  fi",
    "}",
    "",
    'disk_free() { df -k "$HOME" 2>/dev/null | awk \'NR==2 {printf "%d GB", $4/1048576}\'; }',
    "net_check() {",
    '  code=$(curl -sS -m 6 -o /dev/null -w "%{http_code}" "$1" 2>/dev/null) || code="fail"',
    '  [ "$code" = "200" ] || [ "$code" = "301" ] || [ "$code" = "302" ] && printf "通" || printf "不通"',
    "}",
    "",
    "printf '{'",
    'printf \'"node":"%s",\' "$(ver node)"',
    'printf \'"npm":"%s",\' "$(ver npm)"',
    'printf \'"python3":"%s",\' "$(ver python3)"',
    'printf \'"docker":"%s",\' "$(ver docker)"',
    'printf \'"git":"%s",\' "$(ver git)"',
    `printf '"port_${port}":"%s",' "$(port_state)"`,
    'printf \'"disk_free":"%s",\' "$(disk_free)"',
    'printf \'"net_github":"%s",\' "$(net_check https://api.github.com)"',
    'printf \'"net_llm":"%s"\' "$(net_check https://api.deepseek.com)"',
    "printf '}\\n'",
    ""
  ]);
}

export const ENV_FIELDS = [
  { key: "node", label: "Node.js", require: "18+", install: "https://nodejs.org 或 nvm install 20" },
  { key: "npm", label: "npm", require: "9+", install: "随 Node 安装；升级：npm i -g npm" },
  { key: "python3", label: "Python", require: "3.9+", install: "https://www.python.org/downloads/" },
  { key: "docker", label: "Docker", require: "20+", install: "https://docs.docker.com/get-docker/" },
  { key: "git", label: "git", require: "任意版本", install: "https://git-scm.com/downloads" },
];

export function parseEnvJson(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return { ok: false, error: "请先粘贴检测脚本输出的 JSON" };
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return { ok: false, error: "没找到 JSON 结构，请粘贴完整一行输出" };
  try {
    const data = JSON.parse(raw.slice(start, end + 1));
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: `JSON 解析失败：${err.message}` };
  }
}

/** 生成环境预检表格行 */
export function buildEnvTable(envJson, { port = DEFAULT_PORT } = {}) {
  const rows = ENV_FIELDS.map((field) => {
    const got = envJson?.[field.key] || "未检测";
    const ok = got !== "未安装" && got !== "未检测";
    return { dep: field.label, require: field.require, result: ok ? `✅ ${got}` : `❌ ${got}`, install: ok ? "" : field.install, ok };
  });
  const portState = envJson?.[`port_${port}`];
  rows.push({
    dep: `端口 ${port}`,
    require: "空闲",
    result: portState === "占用" ? "❌ 占用" : portState ? "✅ 空闲" : "❌ 未检测",
    install: "释放端口或修改 .env 中的 PORT",
    ok: portState !== "占用",
  });
  const netGithub = envJson?.net_github;
  rows.push({ dep: "网络 GitHub", require: "可访问", result: netGithub === "通" ? "✅ 通" : "❌ 不通", install: "检查网络或代理设置", ok: netGithub === "通" });
  return rows;
}

function riskList(risk) {
  if (!risk?.hits?.length) return "未命中已知风险规则。";
  return risk.hits.map((h) => `- **${h.level}风险｜${h.rule}**${h.evidence ? `：${h.evidence}` : ""}`).join("\n");
}

/** 方案 A：沙箱体验章节 */
export function buildSandboxSection({ owner, repo, sandbox }) {
  const links = (sandbox?.links || []).map((l) => `- [${l.label}](${l.url})`).join("\n");
  return `## 🧪 方案 A：一键沙箱体验（推荐）

> 在云端隔离容器或浏览器 WebContainer 中运行，**不修改本机任何文件**，用完即销毁。

- 沙箱载体：${sandbox?.label ?? "未识别"}
${sandbox?.supported ? links : "- 直达链接：不支持浏览器沙箱"}
- 说明：${sandbox?.note ?? ""}

### ⚠️ 沙箱使用限制

1. 无法操控本地硬件（如 ESP32 烧录、本机 GUI 程序）；
2. 免费实例闲置会自动休眠，不适合 7×24 常驻；
3. 沙箱内的密钥请用平台 Secret 环境变量注入，不要硬编码；
4. 公共沙箱里不要粘贴你自己的 API Key 到代码文件或日志。`;
}

/** 方案 B：本地部署章节（受控执行） */
export function buildLocalDeploySection({ owner, repo, stack, risk, envRows, runner, port = DEFAULT_PORT }) {
  const deploy = runner?.setup ? `1. 安装依赖（容器内）\n\n\`\`\`bash\n${runner.setup}\n\`\`\`\n\n2. 启动\n\n\`\`\`bash\n${runner.run}\n\`\`\`` : `1. 启动\n\n\`\`\`bash\n${runner?.run ?? "bash"}\n\`\`\``;
  const envTable = envRows?.length
    ? `| 依赖 | 要求 | 检测结果 | 缺失时的安装指引 |
|---|---|---|---|
${envRows.map((r) => `| ${r.dep} | ${r.require} | ${r.result} | ${r.install || "—"} |`).join("\n")}`
    : "尚未运行环境预检脚本。";

  return `## 💻 方案 B：一键本地部署（受控执行）

> ⚠️ 本方案没有沙箱隔离，仓库脚本将拥有你授予的本机权限。部署前请完成预检并确认风险。

### 🔍 自动风险评估结果

风险等级：**${risk?.level ?? "未评估"}**

${riskList(risk)}

### 🧾 本机环境预检

${envTable}

> 检测方式：运行插件提供的只读脚本 \`repo-insight-detect-env.sh\`，把输出的 JSON 粘贴回插件。脚本只做检测，不安装、不修改任何配置。

### 📝 本地部署步骤

${deploy}

### ✅ 部署验证

- 容器方式：\`docker ps\` 中能看到 ${`repo-insight-${repo}`} 容器
- 浏览器访问 \`http://localhost:${port}\` 能打开界面
- 查看日志确认无报错：\`docker logs -f ${`repo-insight-${repo}`}\`

### 🧹 卸载与清理

插件生成的部署脚本自带清理参数：

\`\`\`bash
bash repo-insight-deploy.sh --clean   # 删除容器、数据卷与克隆目录
\`\`\`

手工清理：\`docker rm -f ${`repo-insight-${repo}`}\`、\`docker volume rm ${`repo-insight-${repo}`}-data\`、\`rm -rf ~/.repo-insight/${repo}\`

### 🛡 隔离建议

${isolationAdvice(risk?.level ?? "中").map((s) => `- ${s}`).join("\n")}

> 生成时间：${new Date().toISOString()}　｜　仓库：https://github.com/${owner}/${repo}
> 本段由规则引擎生成，不构成安全承诺；插件无法验证脚本运行时的真实行为。`;
}

/** 完整文档（解读 + 部署章节） */
export function composeDeployDocument(baseMarkdown, section) {
  const base = redactDocument(String(baseMarkdown ?? "").trimEnd());
  return `${base}\n\n---\n\n${section}\n`;
}

/* ============================================================
   方案 C：新手快捷本地部署（面向完全零基础用户，口语化）
   ============================================================ */

/** 一行命令：下载官方安装脚本→运行（两步写在同一行，避免 curl | bash 这种不安全写法） */
export function buildBeginnerOneLiner({ owner, repo, port = DEFAULT_PORT, os = "mac" }) {
  const project = `${owner}/${repo}`;
  if (os === "win") {
    return `powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr https://raw.githubusercontent.com/${REPO_SLUG}/main/install.bat -OutFile $env:TEMP\\ri-install.bat; & $env:TEMP\\ri-install.bat ${project} ${port}"`;
  }
  return `curl -fsSL -o ~/Downloads/repo-insight-install.sh https://raw.githubusercontent.com/${REPO_SLUG}/main/install.sh && bash ~/Downloads/repo-insight-install.sh ${project} ${port}`;
}

/** 清理命令（与安装脚本配套） */
export function buildBeginnerCleanCommand({ owner, repo, os = "mac" }) {
  const project = `${owner}/${repo}`;
  if (os === "win") return `install.bat clean ${project}`;
  return `bash install.sh --clean ${project}`;
}

/**
 * 面向零基础用户的部署章节（口语化，不出现 Docker/Node/git 之类的名词轰炸）
 */
export function buildBeginnerSection({ owner, repo, risk, os = "mac", port = DEFAULT_PORT }) {
  const project = `${owner}/${repo}`;
  const oneLiner = buildBeginnerOneLiner({ owner, repo, port, os });
  const cleanCmd = buildBeginnerCleanCommand({ owner, repo, os });
  const level = risk?.level ?? "未评估";
  const plainRisk =
    level === "高"
      ? "⚠️ 这个项目的安装脚本里有一些**比较危险的操作**（比如下载东西直接执行、读写系统配置）。新手强烈建议先用「方案 A 沙箱体验」。"
      : level === "中"
        ? "这个项目需要联网下载依赖、还要填一些配置，属于**中等麻烦**，照下面做基本没问题。"
        : "没扫到什么危险操作，照着下面做就行。";

  const openTerminal =
    os === "win"
      ? "- **Windows**：按一下键盘左下角的 `Win` 键，输入 `PowerShell`，按回车，会跳出一个蓝色窗口"
      : "- **Mac**：同时按 `Command ⌘` 和空格键，输入「终端」，按回车，会跳出一个白底或黑底的小窗口";

  return `## 🐣 方案 C：新手快捷本地部署（照着抄就行）

> 这一套是给**没接触过命令行**的朋友准备的：不用懂 Docker，不用懂 Node，也不用懂 git。
> 你只需要「打开一个窗口 → 复制一行字 → 等它跑完」。

### 先看一眼：这个项目装了会不会有风险

${plainRisk}

风险等级：**${level}**（这是插件提前帮你扫的，扫的是项目里的安装脚本有没有危险动作）

> 怕出问题？直接选 **方案 A 一键沙箱体验**——它把项目跑在云端，完全不碰你的电脑，连装都不用装。

### 你要做的只有三件事

> 一点命令行都不想碰？也行——在插件里点「下载双击安装脚本」，拿到文件后**双击**它，效果和下面三步完全一样（项目已经替你填好了）。

**第 1 件：打开那个「黑窗口」**
${openTerminal}
- （打开以后出现一大堆看不懂的英文也没关系，不用管它）

**第 2 件：把下面这一整行复制进去，然后按回车**

\`\`\`bash
${oneLiner}
\`\`\`

**第 3 件：等着，别关窗口**
- 屏幕上会一直刷英文，这是**正常的**，它在下载东西；
- 第一次大概要 **2～10 分钟**，看网速；
- 等你看到 \`http://localhost:${port}\` 而且浏览器自己弹出页面，就成功了 🎉。

### 想关掉它

回到那个黑窗口，按 \`Control + C\`（Mac）或 \`Ctrl + C\`（Windows），或者直接把窗口关掉。项目就停了。

### 想彻底删干净

把这一行复制到黑窗口里按回车，它会把下载的文件、运行用的容器、数据全部删掉：

\`\`\`bash
${cleanCmd}
\`\`\`

### 中途卡住了怎么办

| 你看到的 | 意思 | 怎么办 |
|---|---|---|
| \`没装 Docker\` / \`command not found\` | 电脑缺一个免费小软件 | 脚本会给你下载地址，装完再跑一次就行 |
| \`port is already allocated\` / 端口被占用 | ${port} 端口被别的程序占了 | 把命令最后面的 \`${port}\` 改成 \`${port + 1}\` 再跑一次 |
| 一直卡在下载 | 网速问题（GitHub 在国内偶尔抽风） | 换「方案 A 沙箱体验」，最省事 |
| 一堆红字看不懂 | 大概率是依赖装失败 | 把整屏截图发到 [Issues](https://github.com/${REPO_SLUG}/issues)，我看到会回 |

### 为什么可以放心

- 安装脚本是**开源可查看**的（仓库根目录 \`install.sh\` / \`install.bat\`），你可以直接点开看它做了什么；
- 它只做三件事：下载项目到你个人文件夹、用 Docker 隔离运行、打开浏览器；**不会改系统设置**；
- 没有 Docker 时它会先问你，而不是偷偷直接装东西；
- 项目文件只放在 \`~/RepoInsight/\`（Windows 是 \`%USERPROFILE%\\RepoInsight\\\`），想删就删。`;
}
