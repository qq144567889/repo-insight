/*!
 * Repo Insight · 开源项目解读器（Chrome 扩展 / Manifest V3）
 * 来源作者：Yang YIZHU  (https://github.com/repo-lens)
 * 禁止商业售卖 —— 完整条款见仓库根目录 LICENSE 与 NOTICE.md
 * 任何再发布都必须完整保留本段署名信息，不得删除、隐藏或替换。
 */
import { redact } from "./security.js";

// 错误码 → 用户可读信息。hint 用于 UI 上的下一步动作提示。
export const ERROR_TABLE = {
  NOT_A_REPO_PAGE: { message: "当前页面不是 GitHub 仓库页面", retryable: false },
  GITHUB_RATE_LIMIT: {
    message: "GitHub API 速率限制已用尽（未认证 60 次/小时）",
    hint: "在设置页配置 GitHub Token 可提升至 5000 次/小时；Token 不需要任何写权限",
    retryable: true,
  },
  GITHUB_SECONDARY_LIMIT: { message: "GitHub 触发二级限流，请稍后重试", retryable: true },
  GITHUB_FORBIDDEN: {
    message: "GitHub 拒绝了这次请求（403，但不是配额用尽）",
    hint: "可能是仓库被限制访问，或当前网络出口被 GitHub 拦截",
    retryable: true,
  },
  GITHUB_NOT_FOUND: {
    message: "仓库不存在，或为私有仓库且未提供有权限的 Token",
    retryable: false,
  },
  GITHUB_TOKEN_INVALID: { message: "GitHub Token 无效或已过期", hint: "请在设置页更新", retryable: false },
  GITHUB_TIMEOUT: { message: "GitHub 请求超时", retryable: true },
  GITHUB_NETWORK_ERROR: { message: "无法连接 GitHub，请检查网络", retryable: true },
  META_FETCH_FAILED: { message: "仓库信息获取失败，请确认网络后重试", retryable: true },
  PRIVATE_REPO_NEEDS_CONSENT: {
    message: "这是私有仓库，README 会被发送给你选择的模型服务商",
    hint: "仅本地模型（Ollama）不会外发；确认后再继续",
    retryable: false,
  },
  LLM_NOT_CONFIGURED: { message: "尚未配置模型服务，已使用本地模板生成基础解读", retryable: false },
  LLM_AUTH_FAILED: { message: "模型 API Key 无效（401）", hint: "请在设置页检查 Key", retryable: false },
  LLM_FORBIDDEN: { message: "模型服务拒绝访问（403）", hint: "检查 Key 权限、余额或区域限制", retryable: false },
  LLM_RATE_LIMIT: { message: "模型服务限流（429）", hint: "稍后重试或更换模型", retryable: true },
  LLM_TIMEOUT: { message: "模型响应超时", hint: "可换更快的模型，或先使用本地模板", retryable: true },
  LLM_NETWORK_ERROR: { message: "无法连接模型服务", hint: "检查 Base URL 与网络，自定义域名需授权", retryable: true },
  LLM_PERMISSION_MISSING: {
    message: "尚未授予该域名的访问权限",
    hint: "到设置页点「保存」触发授权，或改用内置提供商",
    retryable: false,
  },
  LLM_EMPTY_RESPONSE: { message: "模型返回内容为空", hint: "重试或更换模型", retryable: true },
  LLM_BAD_REQUEST: { message: "模型服务拒绝了请求参数", hint: "检查模型名是否被该服务支持", retryable: false },
  TIMEOUT: { message: "请求超时", retryable: true },
  UNEXPECTED: { message: "生成失败", retryable: true },
};

/** 把任意错误对象规范化为 UI 可用的结构 */
export function toErrorPayload(err) {
  const raw = typeof err === "string" ? err : err?.message ?? "";
  const code = ERROR_TABLE[raw] ? raw : raw.startsWith("GITHUB_API_ERROR:") || raw.startsWith("LLM_API_ERROR:") ? raw : "UNEXPECTED";
  const [base, detail] = code.split(":");
  const entry = ERROR_TABLE[base] ?? ERROR_TABLE.UNEXPECTED;

  let message = entry.message;
  if (base === "GITHUB_API_ERROR") message = `GitHub 接口异常（HTTP ${detail}）`;
  if (base === "LLM_API_ERROR") message = `模型服务异常（HTTP ${detail}）`;

  return {
    code,
    message,
    hint: entry.hint ?? "",
    retryable: entry.retryable ?? true,
    detail: raw === code || !raw ? "" : redact(raw),
  };
}
