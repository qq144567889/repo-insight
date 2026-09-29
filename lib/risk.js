/*!
 * Repo Insight · 开源项目解读器（Chrome 扩展 / Manifest V3）
 * 来源作者：Yang YIZHU  (https://github.com/repo-lens)
 * 禁止商业售卖 —— 完整条款见仓库根目录 LICENSE 与 NOTICE.md
 * 任何再发布都必须完整保留本段署名信息，不得删除、隐藏或替换。
 */
// 部署前风险评估：纯规则扫描（不依赖模型），以及沙箱载体识别

import { scanSecrets, redactDocument } from "./security.js";

export const HIGH_RISK_RULES = [
  { name: "curl 管道执行 shell", pattern: /\bcurl\b[^\n|]{0,120}\|\s*(sudo\s+)?(ba|z|k)?sh\b/i },
  { name: "wget 管道执行 shell", pattern: /\bwget\b[^\n|]{0,120}\|\s*(sudo\s+)?(ba|z|k)?sh\b/i },
  { name: "读取本机凭据文件", pattern: /(\.aws\/credentials|\.ssh\/|id_rsa|id_ed25519|\.netrc|credentials\.json)/i },
  { name: "修改 PATH / 启动项 / 计划任务", pattern: /(export\s+PATH=|\.bashrc|\.zshrc|systemctl\s+enable|launchctl\s+load|crontab\s+-)/i },
  { name: "提权或危险删除", pattern: /(chmod\s+777|sudo\s+rm\s+-rf\s+\/|rm\s+-rf\s+\/(?:\s|$))/i },
  { name: "关闭安全校验", pattern: /(--insecure|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*0|verify\s*=\s*false)/i },
  { name: "编码载荷执行", pattern: /(powershell[^\n]*\s-e(nc(odedcommand)?)?\s+[A-Za-z0-9+/=]{16,}|base64\s+-d[^\n]*\|\s*(ba)?sh)/i },
  { name: "全局静默安装依赖", pattern: /(npm\s+(?:i|install)\s+(?:-g|--global)|pip\s+install\s+(?:-U|--upgrade))/i },
];

export const MEDIUM_RISK_RULES = [
  { name: "需要第三方 API Key（可能产生费用）", pattern: /(OPENAI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK|api[_-]?key|LLM_API_KEY)/i },
  { name: "依赖大量第三方包", test: ({ files }) => files.some((f) => /^(package\.json|requirements\.txt|pyproject\.toml|Cargo\.toml|go\.mod)$/i.test(f.name)) },
  { name: "实验性项目（Star 少于 50）", test: ({ meta }) => Number(meta?.stargazers_count ?? 0) < 50 },
  { name: "涉及宿主机端口监听", pattern: /(0\.0\.0\.0:|EXPOSE\s+\d+|ports:\s*\n?\s*-\s*"?\d+:)/i },
];

function firstEvidence(text, pattern) {
  if (!pattern) return "";
  const line = String(text)
    .split("\n")
    .find((l) => pattern.test(l));
  return line ? redactDocument(line.trim()).slice(0, 120) : "";
}

/**
 * 仓库级风险评估（纯规则，不做模型推理）。
 * @returns {{level:"高"|"中"|"低", hits:Array, secrets:Array, envCommitted:boolean}}
 */
export function assessRisk({ meta = {}, readmeText = "", files = [] } = {}) {
  const text = `${readmeText}\n${files.map((f) => f.name).join("\n")}`;
  const hits = [];

  for (const rule of HIGH_RISK_RULES) {
    if (rule.pattern.test(text)) {
      hits.push({ level: "高", rule: rule.name, evidence: firstEvidence(text, rule.pattern) });
    }
  }
  for (const rule of MEDIUM_RISK_RULES) {
    const matched = rule.test ? rule.test({ meta, files, readmeText }) : rule.pattern.test(text);
    if (matched) hits.push({ level: "中", rule: rule.name, evidence: firstEvidence(text, rule.pattern) });
  }

  const secrets = scanSecrets(readmeText);
  if (secrets.length) {
    hits.push({
      level: "高",
      rule: `仓库内容含 ${secrets.length} 处疑似硬编码密钥`,
      evidence: secrets.map((s) => `${s.name}：${s.preview}`).join("；"),
    });
  }

  const envCommitted = files.some((f) => /^\.env(\.|$)/i.test(f.name) && !/^\.env\.(example|sample|template)$/i.test(f.name));
  if (envCommitted) {
    hits.push({ level: "高", rule: "仓库疑似提交了真实 .env 文件", evidence: files.filter((f) => /^\.env/i.test(f.name)).map((f) => f.name).join(", ") });
  }

  const level = hits.some((h) => h.level === "高") ? "高" : hits.length ? "中" : "低";
  return { level, hits, secrets, envCommitted };
}

const EMBEDDED_RE = /(\.ino$|idf\.py$|platformio\.ini$|sdkconfig|\.uf2$|\.hex$)/i;

/**
 * 沙箱载体识别。注意：嵌入式项目优先判定（PlatformIO 项目也带 package.json）。
 * @returns {{kind, label, supported, links:Array<{label,url}>, note}}
 */
export function detectSandbox({ owner, repo, files = [], meta = {} } = {}) {
  const names = files.map((f) => String(f.name || "").toLowerCase());
  const has = (n) => names.includes(n);
  const repoUrl = `https://github.com/${owner}/${repo}`;

  if (names.some((n) => EMBEDDED_RE.test(n))) {
    return {
      kind: "embedded",
      label: "嵌入式 / 固件项目",
      supported: false,
      links: [],
      note: "需要本地工具链（如 ESP-IDF / PlatformIO）与真实硬件烧录，浏览器沙箱无法替代。",
    };
  }

  const links = [];
  if (has(".devcontainer.json")) {
    links.push({ label: "一键创建 Codespace", url: `https://codespaces.new/${owner}/${repo}` });
    links.push({ label: "Gitpod", url: `https://gitpod.io/#${repoUrl}` });
    return {
      kind: "codespaces",
      label: "GitHub Codespaces",
      supported: true,
      links,
      note: "仓库自带 devcontainer 配置，云端环境最贴合原开发者意图；也可在仓库页 Code → Codespaces 手动创建。",
    };
  }

  if (has("package.json")) {
    links.push({ label: "StackBlitz（纯浏览器运行）", url: `https://stackblitz.com/github/${owner}/${repo}` });
    links.push({ label: "Gitpod", url: `https://gitpod.io/#${repoUrl}` });
    links.push({ label: "GitHub Codespaces", url: `https://codespaces.new/${owner}/${repo}` });
    return {
      kind: "web",
      label: "StackBlitz / Gitpod / Codespaces",
      supported: true,
      links,
      note: "Node / 前端项目可直接在浏览器里跑起来，不写本机磁盘。",
    };
  }

  if (has("dockerfile") || has("docker-compose.yml") || has("docker-compose.yaml") || has("compose.yaml")) {
    links.push({ label: "Gitpod", url: `https://gitpod.io/#${repoUrl}` });
    links.push({ label: "GitHub Codespaces", url: `https://codespaces.new/${owner}/${repo}` });
    return {
      kind: "docker",
      label: "Gitpod / Codespaces",
      supported: true,
      links,
      note: "容器化项目在云端构建更省事；注意部分沙箱对 Docker-in-Docker 支持有限。",
    };
  }

  links.push({ label: "Gitpod", url: `https://gitpod.io/#${repoUrl}` });
  links.push({ label: "GitHub Codespaces", url: `https://codespaces.new/${owner}/${repo}` });
  const starNote = Number(meta?.stargazers_count ?? 0) === 0 ? "该项目 Star 很少，沙箱只用于试跑，不要在里面填真实密钥。" : "";
  return {
    kind: "generic",
    label: "Gitpod / GitHub Codespaces",
    supported: true,
    links,
    note: `通用 Linux 沙箱，可运行任意语言栈。${starNote}`,
  };
}

/** 隔离强度建议（由强到弱） */
export function isolationAdvice(level) {
  const base = [
    "**云端沙箱**（Codespaces / Gitpod / StackBlitz）：隔离最强，完全不碰本机，适合先试跑。",
    "**容器隔离**（推荐用于本地部署）：`docker run --rm` 运行、只挂载专用数据卷、API Key 走环境变量传入，用完删除容器。",
    "**虚拟机隔离**：高风险项目或需要系统级测试时使用（Parallels / UTM / VirtualBox）。",
    "**最小权限运行**：非 root 用户、专用目录、只授予必要权限。",
  ];
  if (level === "高") {
    return [
      "🔴 该仓库命中高风险规则，**强烈建议先用云端沙箱或容器跑通再考虑本机**；不要在宿主机直接执行其安装脚本。",
      ...base,
    ];
  }
  if (level === "中") {
    return ["🟠 存在中等风险项，建议优先容器隔离，本机部署时注意先备份再操作。", ...base];
  }
  return ["🟢 未命中已知高风险规则；仍建议容器隔离运行，用完即销毁。", ...base];
}
