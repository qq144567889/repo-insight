/*!
 * Repo Insight · 开源项目解读器（Chrome 扩展 / Manifest V3）
 * 来源作者：Yang YIZHU  (https://github.com/repo-lens)
 * 禁止商业售卖 —— 完整条款见仓库根目录 LICENSE 与 NOTICE.md
 * 任何再发布都必须完整保留本段署名信息，不得删除、隐藏或替换。
 */
// 本地降级模板、技术栈探测、许可证风险分级、文档标识

export const EXTENSION_VERSION = "0.6.0";
const FENCE = "```";

export const AI_LABEL_LINE =
  `> 🤖 本文档由 AI 生成（Repo Insight v${EXTENSION_VERSION}），可能存在错误或过时信息，执行任何命令前请以仓库原始 README 为准。`;

/** 输出模板要求的章节（顺序即要求顺序），来源：GitHub项目解读-输出模板.md */
export const MODEL_TEMPLATE_HEADINGS = [
  "## ✅ 项目定位 & 核心功能",
  "## 🧩 架构说明",
  "## ⚠️ 短板、坑点与风险（重点）",
  "## 📌 适合 / 不适合人群",
  "## 📝 一键部署工作流",
  "## 📌 总结",
];

export const FALLBACK_TEMPLATE_HEADINGS = [
  "## ✅ 项目定位 & 核心功能",
  "## 🧩 架构与运行原理",
  "## ⚠️ 短板、坑点与风险",
  "## 📌 适合 / 不适合人群",
  "## 📝 一键部署工作流",
  "## 📌 总结",
];

/**
 * 检查文档是否符合模板章节要求。
 * 只报告不修改：章节缺失属于模型输出问题，应由用户决定是否重新生成。
 */
export function checkTemplateStructure(markdown, headings = MODEL_TEMPLATE_HEADINGS) {
  const present = [...String(markdown).matchAll(/^## .+$/gm)].map((m) => m[0].trim());
  const missing = headings.filter((h) => !present.includes(h));
  const requiredInOrder = present.filter((h) => headings.includes(h));
  const orderOk = JSON.stringify(requiredInOrder) === JSON.stringify(headings.filter((h) => present.includes(h)));
  return { ok: missing.length === 0, missing, orderOk, present };
}

export function buildMetaComment({ model = "local-template", promptVersion = "-", generatedAt = new Date().toISOString() } = {}) {
  return `<!-- generated-by: repo-insight v${EXTENSION_VERSION} | prompt: ${promptVersion} | model: ${model} | at: ${generatedAt} | author: Yang YIZHU | license: 禁止商业售卖（见项目 LICENSE / NOTICE.md） -->`;
}

/**
 * 文档内的风险提示：只写数量与类型，不复述命令本身。
 * 两点原因：命令行随文档头部插入会位移，行号交给 UI 按最终文档计算；
 * 复述命令还会让二次扫描把提示行本身当成命中项，产生重复条目。
 */
export function buildRiskyNotice(hits = []) {
  if (!hits.length) return "";
  const kinds = [...new Set(hits.map((h) => h.label))].join("、");
  return `> ⚠️ 本文档含 ${hits.length} 处高风险命令模式（${kinds}），执行前请人工确认脚本来源，详见插件预览区的高亮提示。`;
}

/** 把风险提示插到 AI 标识之后（保持标识始终是文档第一行） */
export function insertRiskyNotice(markdown, hits = []) {
  const notice = buildRiskyNotice(hits);
  if (!notice) return markdown;
  const [first, ...rest] = String(markdown).split("\n");
  return `${first}\n${notice}\n${rest.join("\n")}`;
}

/** 技术栈探测：全部按小写比较（原规格里 Makefile 一项因大小写比较错误永远命中不了） */
export function detectStack(files = []) {
  const names = files.map((f) => String(f.name || "").toLowerCase());
  const has = (n) => names.includes(n);
  if (has("docker-compose.yml") || has("docker-compose.yaml") || has("compose.yml") || has("compose.yaml")) return "docker-compose";
  if (has("package.json")) return "node";
  if (has("pyproject.toml")) return "python-poetry";
  if (has("requirements.txt")) return "python";
  if (has("go.mod")) return "go";
  if (has("cargo.toml")) return "rust";
  if (has("makefile")) return "make";
  return "unknown";
}

const LICENSE_LEVELS = {
  permissive: {
    label: "宽松许可",
    advice: "可商用与再分发，须保留版权声明与许可证原文。",
  },
  weakCopyleft: {
    label: "弱著佐权",
    advice: "修改本项目的文件需以同许可开源；静态链接与动态链接的义务不同，商用前请确认。",
  },
  strongCopyleft: {
    label: "强著佐权",
    advice: "分发衍生作品时须以相同许可证开源。",
  },
  networkCopyleft: {
    label: "网络著佐权",
    advice: "除分发衍生作品须开源外，以网络服务形式对外提供也会触发开源义务，SaaS 化前必须确认。",
  },
  none: {
    label: "未声明许可证",
    advice: "未声明许可证等于默认保留所有权利：不得商用、不得再分发，仅可用于本地研究与评估。",
  },
  unknown: {
    label: "许可证需人工确认",
    advice: "无法从元信息判定许可类型，使用前请阅读仓库 LICENSE 文件与商业授权说明。",
  },
};

const PERMISSIVE = new Set(["MIT", "APACHE-2.0", "BSD-2-CLAUSE", "BSD-3-CLAUSE", "ISC", "0BSD", "UNLICENSE", "CC0-1.0", "WTFPL", "ZLIB", "BSL-1.0"]);
const WEAK = new Set(["MPL-2.0", "LGPL-2.1", "LGPL-3.0", "EPL-2.0", "CDDL-1.0", "EUPL-1.2"]);

/** 许可证风险分级（只做提示，不构成法律意见） */
export function licenseInfo(meta) {
  const spdxRaw = meta?.license?.spdx_id || meta?.license?.name || "";
  const spdx = String(spdxRaw).toUpperCase();

  if (!spdx || spdx === "NOASSERTION" || spdx === "NONE") {
    if (!meta) return { spdx: "未知", ...LICENSE_LEVELS.unknown, level: "unknown" };
    return { spdx: "未声明", ...LICENSE_LEVELS.none, level: "none" };
  }
  if (spdx.startsWith("AGPL")) return { spdx, ...LICENSE_LEVELS.networkCopyleft, level: "networkCopyleft" };
  if (spdx.startsWith("GPL")) return { spdx, ...LICENSE_LEVELS.strongCopyleft, level: "strongCopyleft" };
  if (WEAK.has(spdx)) return { spdx, ...LICENSE_LEVELS.weakCopyleft, level: "weakCopyleft" };
  if (PERMISSIVE.has(spdx)) return { spdx, ...LICENSE_LEVELS.permissive, level: "permissive" };
  return { spdx, ...LICENSE_LEVELS.unknown, level: "unknown" };
}

export function buildLicenseSection(meta) {
  const info = licenseInfo(meta);
  const icon = info.level === "permissive" ? "✅" : info.level === "unknown" ? "❓" : "⚠️";
  return `## ⚖️ 许可证与使用限制

${icon} **${info.spdx} ｜ ${info.label}**

${info.advice}

> 以上为基于仓库元信息的自动提示，不构成法律意见；商用或再分发前请查阅 LICENSE 原文并咨询法务。`;
}

export function buildDeployBlock(stack) {
  // 代码块缩进 3 空格，才能嵌在「1. xxx」这样的有序列表项下，渲染时不会脱离列表
  const indent = (text) => text.split("\n").map((l) => (l ? `   ${l}` : "")).join("\n");
  const CLI = (cmd) => `   ${FENCE}bash\n${indent(cmd)}\n   ${FENCE}`;
  const clone = CLI("git clone <仓库地址>\ncd <仓库目录>");
  const blocks = {
    "docker-compose": `### 环境依赖
- Docker 20+ 与 Docker Compose v2

### 部署步骤
1. 克隆仓库（需查看 .env.example 并复制为 .env，按需填写配置）
${clone}
2. 启动服务
${CLI("docker compose up -d")}

### 验证部署是否成功
- 执行 \`docker compose ps\` 查看容器状态，应为 running
- 访问 README 中标注的端口或地址

### 常见部署踩坑
- 端口冲突：修改 compose 文件中的端口映射
- 环境变量缺失导致启动失败：确认 .env 完整`,

    node: `### 环境依赖
- Node.js 18+（建议 LTS）、npm / pnpm / yarn（以 README 为准）

### 部署步骤
1. 克隆仓库并安装依赖
${clone}
${CLI("npm install")}
2. 按 .env.example 配置环境变量
3. 启动（以 package.json 的 scripts 为准）
${CLI("npm run dev\n# 或\nnpm run build && npm start")}

### 验证部署是否成功
- 终端无报错并输出监听地址（常见为 localhost:3000）
- 浏览器访问该地址

### 常见部署踩坑
- Node 版本过低：用 nvm 切换到 README 要求的版本
- 依赖安装失败：确认所用镜像源可信后再切换`,

    python: `### 环境依赖
- Python 3.9+，建议使用 venv

### 部署步骤
1. 克隆仓库并创建虚拟环境
${clone}
${CLI("python3 -m venv .venv\nsource .venv/bin/activate   # Windows: .venv\\Scripts\\activate")}
2. 安装依赖
${CLI("pip install -r requirements.txt")}
3. 配置环境变量后按 README 的入口运行（常见为 python main.py）

### 验证部署是否成功
- 程序无报错启动，日志正常输出

### 常见部署踩坑
- 系统依赖缺失：按 README 安装对应的 lib 包
- 入口文件不明确：以 README 或 pyproject 的配置为准`,

    "python-poetry": `### 环境依赖
- Python 3.9+ 与 Poetry

### 部署步骤
1. 克隆仓库
${clone}
2. 安装依赖
${CLI("poetry install")}
3. 运行入口命令（以 pyproject 中的 scripts 为准）
${CLI("poetry run <入口命令>")}

### 验证部署是否成功
- 按 README 的验证方式执行

### 常见部署踩坑
- Poetry 建议按官方文档安装，避免使用「下载即执行」的安装方式`,

    go: `### 环境依赖
- Go 1.20+

### 部署步骤
1. 克隆仓库
${clone}
2. 构建或直接运行
${CLI("go build ./...\n# 或\ngo run .")}

### 验证部署是否成功
- 二进制或进程正常启动

### 常见部署踩坑
- 依赖拉取慢：配置可信的 GOPROXY`,

    rust: `### 环境依赖
- Rust 工具链（rustup）

### 部署步骤
1. 克隆仓库
${clone}
2. 构建发布版本
${CLI("cargo build --release")}

### 验证部署是否成功
- 执行 \`cargo run --release\` 正常启动

### 常见部署踩坑
- 首次编译需拉取并编译大量依赖，耗时属正常`,

    make: `### 环境依赖
- make 与对应语言工具链（见 Makefile 头部注释）

### 部署步骤
1. 克隆仓库
${clone}
2. 执行构建目标（以 Makefile 中的目标为准）
${CLI("make build")}

### 验证部署是否成功
- 产物正常生成，或服务正常启动`,

    unknown: `### 环境依赖
- 未识别到主流技术栈标记文件，需查阅 README 确认

### 部署步骤
1. 克隆仓库
${clone}
2. 阅读 README 的 Installation / Quick Start 章节
3. 按 README 执行

### 验证部署是否成功
- 按 README 的验证方式执行

### 常见部署踩坑
- 若为嵌入式或硬件项目，需要对应的工具链（如 ESP-IDF）`,
  };
  return blocks[stack] || blocks.unknown;
}

function pickMainLanguage(languages, meta) {
  const top = Object.entries(languages || {}).sort((a, b) => b[1] - a[1])[0];
  return top?.[0] || meta?.language || "未知";
}

/**
 * 本地降级文档（未接入模型或模型调用失败时使用）。
 */
/**
 * 在「短板、坑点与风险」章节内补一条许可证风险。
 * 用于代替独立章节，保持与用户模板一致的章节结构（不增删章节）。
 */
export function ensureLicenseBullet(markdown, meta) {
  const info = licenseInfo(meta);
  if (info.level === "permissive") return markdown;

  const lines = String(markdown).split("\n");
  const riskIndex = lines.findIndex((l) => /^##\s*⚠️/.test(l));
  if (riskIndex === -1) return markdown;

  const nextSection = lines.findIndex((l, i) => i > riskIndex && /^##\s/.test(l));
  const end = nextSection === -1 ? lines.length : nextSection;
  const sectionText = lines.slice(riskIndex + 1, end).join("\n");
  if (/许可|License|AGPL|GPL|Apache|MIT/i.test(sectionText)) return markdown;

  // 插到该章节最后一个列表项之后；没有列表项则紧跟标题
  let insertAt = riskIndex + 1;
  for (let i = riskIndex + 1; i < end; i++) {
    if (/^\s*([-*]|\d+\.)\s/.test(lines[i])) insertAt = i + 1;
  }
  const bullet = `- **许可证风险（${info.spdx}｜${info.label}）**：${info.advice}`;
  lines.splice(insertAt, 0, bullet);
  return lines.join("\n");
}

export function buildFallbackMarkdown(data, { reason = "未配置模型服务", promptVersion = "-", appendLicenseSection = false } = {}) {
  const meta = data.meta || {};
  const stack = detectStack(data.files);
  const lang = pickMainLanguage(data.languages, meta);
  const license = licenseInfo(meta);
  // updated_at 会被 star/元信息变动刷新，最近一次代码提交应看 pushed_at
  const lastCommit = meta.pushed_at || meta.updated_at;
  const updated = lastCommit ? String(lastCommit).slice(0, 10) : "未知";
  const desc = meta.description || "（仓库未填写描述）";
  const readmeSnippet = data.readmeText ? data.readmeText.slice(0, 2000) : "（未获取到 README 内容）";

  const licenseBullet = license.level === "permissive"
    ? ""
    : `- **许可证风险（${license.spdx}｜${license.label}）**：${license.advice}\n`;

  return `${AI_LABEL_LINE}

# ${data.repo} 项目深度解读（本地模板 · 未接入 LLM）

> 仓库地址：https://github.com/${data.owner}/${data.repo}
> ⭐ Star：${meta.stargazers_count ?? "未知"} ｜ 🍴 Fork：${meta.forks_count ?? "未知"}
> 主要语言：${lang} ｜ License：${license.spdx} ｜ 最近更新：${updated}
> 一句话定位：${desc}
> ⚠️ 本解读由本地规则模板生成（原因：${reason}），未经过模型分析，内容有限。

## ✅ 项目定位 & 核心功能

- **定位**：${desc}
- **技术栈探测**：${stack === "unknown" ? "未识别到主流技术栈标记文件，需查看仓库文件确认" : stack}
- **说明**：本地模板不产出功能清单，请在设置页配置模型服务后重新生成。

## 🧩 架构与运行原理

本地模板不生成架构分析。README 摘要如下：

${readmeSnippet}

## ⚠️ 短板、坑点与风险

${licenseBullet}- 本模板未做风险分析，建议配置模型服务后重新生成。
- Star / Fork 等指标仅反映关注度，不代表代码质量与维护活跃度。
- 部署前请确认运行环境与依赖版本符合 README 要求。

## 📌 适合 / 不适合人群

✅ 适合：需要快速了解该仓库用途、并希望后续用模型产出完整解读的用户

❌ 不适合：需要生产级评估结论的场景（请配置模型服务或人工评审）

## 📝 一键部署工作流

${buildDeployBlock(stack)}

## 📌 总结

本文件为降级产物，仅提供仓库基础信息与部署骨架。评级：待评估。

${appendLicenseSection ? `${buildLicenseSection(meta)}\n` : ""}${buildMetaComment({ model: "local-template", promptVersion })}
`;
}

/** 给模型输出补齐 AI 标识、可选的许可证章节与溯源注释 */
export function finalizeModelMarkdown(content, data, { model, promptVersion, appendLicenseSection = false }) {
  const body = String(content).trim();
  const hasLicenseSection = /##\s*⚖️\s*许可证/.test(body);
  const licenseSection = appendLicenseSection && !hasLicenseSection ? `\n${buildLicenseSection(data.meta)}\n` : "";

  return `${AI_LABEL_LINE}

${body}
${licenseSection}
${buildMetaComment({ model, promptVersion })}
`;
}
