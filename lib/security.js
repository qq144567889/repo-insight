/*!
 * Repo Insight · 开源项目解读器（Chrome 扩展 / Manifest V3）
 * 来源作者：Yang YIZHU  (https://github.com/repo-lens)
 * 禁止商业售卖 —— 完整条款见仓库根目录 LICENSE 与 NOTICE.md
 * 任何再发布都必须完整保留本段署名信息，不得删除、隐藏或替换。
 */
// 安全相关纯函数：脱敏、命令风险扫描、文件名清洗、Base URL 校验

// 敏感信息的统一识别规则（掩码、扫描、泄露检测共用一份）
export const SECRET_PATTERNS = [
  { name: "OpenAI/DeepSeek 风格 Key", regex: /\bsk-[A-Za-z0-9_-]{12,}\b/g },
  { name: "GitHub Token", regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: "GitHub 细粒度 Token", regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: "AWS Access Key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "Telegram Bot Token", regex: /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g },
  { name: "Slack Token", regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "私有密钥文件", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  // group 指明「要打码的是第几个捕获组」，0 表示整段命中
  { name: "Bearer Token", regex: /\bBearer\s+([A-Za-z0-9._-]{20,})/gi, group: 1 },
];

/** 统一掩码：任何日志、UI、导出中出现密钥时都走这里 */
export function maskSecret(value) {
  if (!value) return "";
  const s = String(value);
  if (s.length <= 8) return `${s.slice(0, 2)}****`;
  if (s.length <= 16) return `${s.slice(0, 4)}****`;
  return `${s.slice(0, 6)}****${s.slice(-4)}`;
}

const SENSITIVE_PARAM = /[?&](token|access_token|api_?key|key|secret|password|sig|signature|auth)=[^&\s]*/gi;

function maskAll(text) {
  let out = text;
  for (const { regex, group = 0 } of SECRET_PATTERNS) {
    out = out.replace(regex, (match, ...args) => {
      if (!group) return maskSecret(match);
      const captured = args[group - 1];
      return typeof captured === "string" ? match.replace(captured, maskSecret(captured)) : maskSecret(match);
    });
  }
  return out;
}

/**
 * 抹掉文本中的密钥。
 * @param {object} [opts]
 * @param {number} [opts.maxLength] 截断长度（错误信息用）
 * @param {boolean} [opts.aggressiveQuery] true 时把完整 query 都打码（错误信息用）；false 只处理敏感参数名（文档用）
 */
export function redact(input, { maxLength = 500, aggressiveQuery = true } = {}) {
  let text = typeof input === "string" ? input : String(input?.message ?? input ?? "");
  text = maskAll(text);
  text = aggressiveQuery
    ? text.replace(/(https?:\/\/[^\s?#]+)\?[^\s]*/g, "$1?***")
    : text.replace(SENSITIVE_PARAM, (m, key) => m.replace(/=.*$/, "=***"));
  return Number.isFinite(maxLength) ? text.slice(0, maxLength) : text;
}

/** 文档级脱敏：保留正文与普通链接，只打码密钥与敏感查询参数 */
export function redactDocument(text) {
  return redact(text, { maxLength: Infinity, aggressiveQuery: false });
}

/** 扫描文本中的疑似密钥，返回去重后的命中清单（预览已掩码） */
export function scanSecrets(text) {
  const source = String(text ?? "");
  const seen = new Set();
  const hits = [];
  for (const { name, regex } of SECRET_PATTERNS) {
    const re = new RegExp(regex.source, regex.flags);
    let match;
    while ((match = re.exec(source))) {
      const pattern = SECRET_PATTERNS.find((p) => p.name === name);
      const raw = pattern?.group ? match[pattern.group] : match[0];
      const masked = maskSecret(raw);
      if (seen.has(masked)) continue;
      seen.add(masked);
      const lineStart = source.lastIndexOf("\n", match.index) + 1;
      const lineEnd = source.indexOf("\n", match.index);
      const line = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd).trim();
      hits.push({ name, preview: masked, context: redactDocument(line).slice(0, 120) });
    }
  }
  return hits;
}

// 「下载即执行」等需要人工确认的模式。命中只提示、不阻断（避免误伤正常 README）
export const RISKY_RULES = [
  { id: "pipe-to-shell", label: "下载即执行", re: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|k)?sh\b/i },
  { id: "iex-download", label: "PowerShell 远程执行", re: /(invoke-expression|iex)\s*\(?\s*(new-object|iwr|invoke-webrequest)/i },
  { id: "enc-payload", label: "编码载荷执行", re: /powershell[^\n]*-e(nc(odedcommand)?)?\s+[A-Za-z0-9+/=]{16,}/i },
  { id: "chmod-exec", label: "下载后赋权执行", re: /chmod\s+\+x[^\n]{0,80}(&&|;)\s*\.?\/?\S+/i },
  { id: "remote-installer", label: "第三方远程安装脚本", re: /https?:\/\/(?!github\.com|raw\.githubusercontent\.com|api\.github\.com)[^\s"')]+\/(install|setup|bootstrap)\.(sh|ps1|bat)/i },
  { id: "npm-global-unknown", label: "全局安装未知包", re: /\bnpm\s+(i|install)\s+(-\w+\s+)*-g\s+\S+/i },
  { id: "disable-tls", label: "关闭证书校验", re: /(--insecure|verify\s*=\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*0)/i },
  { id: "exfil-env", label: "读取环境变量外发", re: /(printenv|env)\b[^\n]{0,60}\|\s*(curl|nc|ncat)\b/i },
];

/**
 * 扫描生成内容中的高风险命令行。
 * @returns {{line:number, text:string, rule:string, label:string}[]}
 */
export function scanRisky(text) {
  if (!text) return [];
  const hits = [];
  const lines = String(text).split("\n");
  lines.forEach((line, i) => {
    for (const rule of RISKY_RULES) {
      if (rule.re.test(line)) {
        hits.push({ line: i + 1, text: line.trim().slice(0, 200), rule: rule.id, label: rule.label });
        break;
      }
    }
  });
  return hits;
}

/** 清洗下载文件名：去掉路径分隔符、控制字符，限制长度 */
export function sanitizeFilename(name, maxLength = 100) {
  let out = String(name ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "");
  if (!out) out = "repo";
  if (out.length > maxLength) out = out.slice(0, maxLength);
  return out;
}

export function isLocalOrigin(origin) {
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "http:" && protocol !== "https:") return false;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
  } catch {
    return false;
  }
}

/**
 * 校验用户自填的 Base URL。
 * 规则：必须是 http(s)，非本机地址必须是 https（否则 API Key 会明文传输）。
 * @returns {{ok:true, origin:string, baseUrl:string} | {ok:false, reason:string}}
 */
export function validateBaseUrl(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, reason: "请填写 Base URL" };
  let u;
  try {
    u = new URL(value);
  } catch {
    return { ok: false, reason: "URL 格式不正确，需要形如 https://api.example.com/v1" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, reason: "只支持 http/https 协议" };
  }
  if (u.protocol === "http:" && !isLocalOrigin(u.origin)) {
    return { ok: false, reason: "非本机地址必须使用 https，否则 API Key 会以明文传输" };
  }
  const baseUrl = value.replace(/\/+$/, "");
  // Chrome 匹配模式不支持端口：去掉端口后申请权限，即可覆盖该主机的任意端口
  const origin = `${u.protocol}//${u.hostname}/*`;
  return { ok: true, origin, baseUrl };
}
