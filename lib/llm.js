/*!
 * Repo Insight · 开源项目解读器（Chrome 扩展 / Manifest V3）
 * 来源作者：Yang YIZHU  (https://github.com/repo-lens)
 * 禁止商业售卖 —— 完整条款见仓库根目录 LICENSE 与 NOTICE.md
 * 任何再发布都必须完整保留本段署名信息，不得删除、隐藏或替换。
 */
// OpenAI 兼容模型的统一调用层

import { validateBaseUrl, redact } from "./security.js";

export const PROVIDERS = {
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", requiresKey: true },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", requiresKey: true },
  zhipu: { label: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash", requiresKey: true },
  moonshot: { label: "Moonshot Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", requiresKey: true },
  qwen: { label: "阿里通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", requiresKey: true },
  ollama: { label: "Ollama（本地，不外发）", baseUrl: "http://localhost:11434/v1", model: "qwen2.5:7b", requiresKey: false },
  custom: { label: "自定义（OpenAI 兼容）", baseUrl: "", model: "", requiresKey: true },
};

export function providerLabel(provider) {
  return PROVIDERS[provider]?.label ?? provider;
}

/** 解析出实际使用的 baseUrl / model，并做配置校验 */
export function resolveEndpoint(settings) {
  const provider = PROVIDERS[settings.provider] ? settings.provider : "custom";
  const preset = PROVIDERS[provider];
  const rawBase = provider === "custom" ? settings.customBaseUrl : preset.baseUrl;
  const model = (settings.model || "").trim() || preset.model;

  if (!rawBase) throw new Error("LLM_NOT_CONFIGURED");
  const check = validateBaseUrl(rawBase);
  if (!check.ok) throw new Error("LLM_NOT_CONFIGURED");
  if (!model) throw new Error("LLM_NOT_CONFIGURED");
  if (preset.requiresKey && !settings.apiKey) throw new Error("LLM_NOT_CONFIGURED");

  return { provider, baseUrl: check.baseUrl, model, requiresKey: preset.requiresKey };
}

function buildHeaders({ requiresKey, apiKey }) {
  const headers = { "Content-Type": "application/json" };
  if (requiresKey && apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

/** 输出详细度 → max_tokens。精简模式能显著缩短生成时间 */
export function maxTokensFor(detailLevel) {
  return detailLevel === "brief" ? 2000 : 4000;
}

async function postChat(endpoint, settings, body, timeoutMs) {
  let res;
  try {
    res = await fetch(`${endpoint.baseUrl}/chat/completions`, {
      method: "POST",
      headers: buildHeaders({ ...endpoint, apiKey: settings.apiKey }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = err?.name;
    if (name === "TimeoutError" || name === "AbortError") throw new Error("LLM_TIMEOUT");
    // 未授权域名时 fetch 直接 reject，给出可操作的提示
    throw new Error("LLM_PERMISSION_MISSING");
  }
  return res;
}

function buildPayload(endpoint, systemPrompt, userPrompt, { maxTokens = 4000, temperature = 0.4, stream = false } = {}) {
  return {
    model: endpoint.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature,
    max_tokens: maxTokens,
    ...(stream ? { stream: true } : {}),
  };
}

/** 统一发请求 + 状态码映射（含 max_tokens → max_completion_tokens 的一次自动重试） */
async function sendChat(endpoint, settings, payload, timeoutMs) {
  let res = await postChat(endpoint, settings, payload, timeoutMs);

  if (res.status === 400) {
    const bodyText = await res.text().catch(() => "");
    if (/max_tokens/i.test(bodyText)) {
      const retry = { ...payload };
      delete retry.max_tokens;
      retry.max_completion_tokens = payload.max_tokens ?? 4000;
      if (/temperature/i.test(bodyText)) delete retry.temperature;
      res = await postChat(endpoint, settings, retry, timeoutMs);
    } else {
      throw new Error("LLM_BAD_REQUEST");
    }
  }

  if (res.status === 401) throw new Error("LLM_AUTH_FAILED");
  if (res.status === 403) throw new Error("LLM_FORBIDDEN");
  if (res.status === 429) throw new Error("LLM_RATE_LIMIT");
  if (res.status === 400) throw new Error("LLM_BAD_REQUEST");
  if (!res.ok) throw new Error(`LLM_API_ERROR:${res.status}`);
  return res;
}

/**
 * 调用模型生成 Markdown。
 * 对 OpenAI 新模型的参数差异（max_tokens → max_completion_tokens）做一次自动重试。
 */
export async function callLLM({ systemPrompt, userPrompt, settings, maxTokens = 4000, temperature = 0.4, timeoutMs = 90000 }) {
  const endpoint = resolveEndpoint(settings);
  const payload = buildPayload(endpoint, systemPrompt, userPrompt, { maxTokens, temperature });
  const res = await sendChat(endpoint, settings, payload, timeoutMs);

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("LLM_EMPTY_RESPONSE");
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("LLM_EMPTY_RESPONSE");
  return { content, model: endpoint.model, provider: endpoint.provider };
}

/**
 * 流式调用：按 SSE 分片回调，边生成边显示，显著降低感知等待时间。
 * 供应商不支持流式时自动退回一次性读取。
 */
export async function streamLLM({
  systemPrompt,
  userPrompt,
  settings,
  onDelta = () => {},
  maxTokens = 4000,
  temperature = 0.4,
  timeoutMs = 150000,
}) {
  const endpoint = resolveEndpoint(settings);
  const payload = buildPayload(endpoint, systemPrompt, userPrompt, { maxTokens, temperature, stream: true });
  const res = await sendChat(endpoint, settings, payload, timeoutMs);

  const finish = (content, streamed) => {
    if (!String(content).trim()) throw new Error("LLM_EMPTY_RESPONSE");
    return { content, model: endpoint.model, provider: endpoint.provider, streamed };
  };

  if (!res.body?.getReader) {
    const data = await res.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content ?? "";
    if (content) onDelta(content);
    return finish(content, false);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let raw = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    raw += text;
    buffer += text;

    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line || !line.startsWith("data:")) continue;
      const chunk = line.slice(5).trim();
      if (!chunk || chunk === "[DONE]") continue;
      try {
        const json = JSON.parse(chunk);
        const delta = json?.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        // 忽略无法解析的心跳/注释行
      }
    }
  }

  // 兼容「忽略 stream 参数、直接返回普通 JSON」的服务商
  if (!full.trim() && raw.trim()) {
    try {
      const json = JSON.parse(raw);
      const content = json?.choices?.[0]?.message?.content ?? "";
      if (content) {
        onDelta(content);
        full = content;
      }
    } catch {
      // 不是 JSON，按空响应处理
    }
  }

  return finish(full, true);
}

/** 设置页「测试连接」：最小请求，验证 Key / 域名 / 模型三件事 */
export async function testConnection(settings) {
  const started = Date.now();
  const result = await callLLM({
    systemPrompt: "你只需回复两个字：正常",
    userPrompt: "连接测试",
    settings,
    maxTokens: 16,
    temperature: 0,
    timeoutMs: 20000,
  });
  return { model: result.model, provider: result.provider, elapsedMs: Date.now() - started, sample: redact(result.content).slice(0, 40) };
}
