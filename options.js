/*!
 * Repo Insight · 开源项目解读器（Chrome 扩展 / Manifest V3）
 * 来源作者：Yang YIZHU  (https://github.com/repo-lens)
 * 禁止商业售卖 —— 完整条款见仓库根目录 LICENSE 与 NOTICE.md
 * 任何再发布都必须完整保留本段署名信息，不得删除、隐藏或替换。
 */
// 设置页：配置读写、密码字段、权限申请、连接测试、数据清除

import { PROVIDERS } from "./lib/llm.js";
import { validateBaseUrl, maskSecret } from "./lib/security.js";
import { DEFAULT_SETTINGS, getSettings, saveSettings } from "./lib/settings.js";

const el = (id) => document.getElementById(id);
let stored = {};

function setStatus(text, kind = "") {
  const node = el("status");
  node.className = kind;
  node.textContent = text;
}

function updateProviderUI() {
  const provider = el("provider").value;
  el("customBaseField").hidden = provider !== "custom";
  const preset = PROVIDERS[provider];
  el("model").placeholder = preset?.model ? `默认：${preset.model}` : "例如 gpt-4o-mini";

  const hint = el("providerHint");
  if (provider === "ollama") {
    hint.textContent = "本地模型：仓库内容不会离开本机，适合私有仓库与敏感项目。需要本机已运行 Ollama。";
  } else if (provider === "custom") {
    hint.textContent = "自建或第三方 OpenAI 兼容网关，保存时会请求域名访问权限。";
  } else {
    hint.textContent = `仓库元信息与 README 将发送至 ${preset?.label ?? provider}。`;
  }
}

function collect() {
  const apiKeyInput = el("apiKey").value.trim();
  const tokenInput = el("githubToken").value.trim();
  return {
    provider: el("provider").value,
    customBaseUrl: el("customBaseUrl").value.trim(),
    // 输入框留空＝保持已保存的值；点过「清除」才真正置空
    apiKey: apiKeyInput || (el("apiKey").dataset.clear === "1" ? "" : stored.apiKey || ""),
    model: el("model").value.trim(),
    githubToken: tokenInput || (el("githubToken").dataset.clear === "1" ? "" : stored.githubToken || ""),
    allowPrivateToCloud: el("allowPrivateToCloud").checked,
    enableCache: el("enableCache").checked,
    appendLicenseSection: el("appendLicenseSection").checked,
    historyEnabled: el("historyEnabled").checked,
    historyIncludePrivate: el("historyIncludePrivate").checked,
    autoPopup: el("autoPopup").checked,
    detailLevel: el("detailLevel").value,
  };
}

/** 自定义 Provider 必须先拿到域名权限，否则请求会被 CORS 拦掉 */
async function ensureHostPermission(settings) {
  if (settings.provider !== "custom") return { ok: true };
  const check = validateBaseUrl(settings.customBaseUrl);
  if (!check.ok) return { ok: false, reason: check.reason };

  // 直接 request：已授权时不会弹窗，且避免 await 之后丢失用户手势上下文
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [check.origin] });
  } catch (err) {
    return { ok: false, reason: `该域名不在可申请范围内（${check.origin}）：${err.message}` };
  }
  if (!granted) {
    return { ok: false, reason: `未授予 ${check.origin} 的访问权限，模型调用会失败` };
  }
  return { ok: true };
}

async function persist() {
  const settings = collect();
  const perm = await ensureHostPermission(settings);
  if (!perm.ok) return { ok: false, reason: perm.reason };
  await saveSettings(settings);
  return { ok: true, settings };
}

async function load() {
  const settings = await getSettings();
  stored = settings;
  el("provider").value = settings.provider || DEFAULT_SETTINGS.provider;
  el("customBaseUrl").value = settings.customBaseUrl || "";
  // 密钥不回显明文，只显示掩码
  el("apiKey").value = "";
  delete el("apiKey").dataset.clear;
  el("apiKey").placeholder = settings.apiKey ? `已保存：${maskSecret(settings.apiKey)}（留空表示不修改）` : "sk-...";
  el("model").value = settings.model || "";
  el("githubToken").value = "";
  delete el("githubToken").dataset.clear;
  el("githubToken").placeholder = settings.githubToken ? `已保存：${maskSecret(settings.githubToken)}（留空表示不修改）` : "ghp_... 或 github_pat_...";
  el("allowPrivateToCloud").checked = settings.allowPrivateToCloud === true;
  el("enableCache").checked = settings.enableCache !== false;
  el("appendLicenseSection").checked = settings.appendLicenseSection === true;
  el("historyEnabled").checked = settings.historyEnabled !== false;
  el("historyIncludePrivate").checked = settings.historyIncludePrivate === true;
  el("autoPopup").checked = settings.autoPopup !== false;
  el("detailLevel").value = settings.detailLevel === "brief" ? "brief" : "standard";
  updateProviderUI();
}

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function refreshStats() {
  const response = await chrome.runtime.sendMessage({ type: "STORAGE_STATS" }).catch(() => null);
  const stats = response?.stats;
  if (!stats) {
    el("storageStats").textContent = "统计失败";
    return;
  }
  const parts = [
    `历史 ${stats.historyCount} 条（${formatBytes(stats.historyBytes)}）`,
    `缓存 ${stats.cacheCount} 条`,
    `合计占用约 ${formatBytes(stats.bytes)}`,
    `存储项：${stats.keys.join(", ") || "无"}`,
    `模型 Key：${stats.hasApiKey ? "已保存" : "未配置"}`,
    `GitHub Token：${stats.hasGithubToken ? "已保存" : "未配置"}`,
  ];
  el("storageStats").textContent = parts.join("　｜　");
}

document.addEventListener("DOMContentLoaded", async () => {
  await load();

  el("provider").addEventListener("change", updateProviderUI);

  el("clearApiKeyBtn").addEventListener("click", () => {
    el("apiKey").value = "";
    el("apiKey").dataset.clear = "1";
    el("apiKey").placeholder = "已标记清除，点「保存」生效";
    setStatus("已标记清除 API Key，点「保存」生效", "warn");
  });
  el("clearTokenBtn").addEventListener("click", () => {
    el("githubToken").value = "";
    el("githubToken").dataset.clear = "1";
    el("githubToken").placeholder = "已标记清除，点「保存」生效";
    setStatus("已标记清除 GitHub Token，点「保存」生效", "warn");
  });

  el("saveBtn").addEventListener("click", async () => {
    setStatus("保存中…");
    const result = await persist();
    if (result.ok) setStatus("✔ 已保存", "ok");
    else setStatus(`✖ ${result.reason}`, "err");
  });

  el("testBtn").addEventListener("click", async () => {
    setStatus("保存配置…");
    const result = await persist();
    if (!result.ok) {
      setStatus(`✖ ${result.reason}`, "err");
      return;
    }
    setStatus("⏳ 正在测试连接…");
    const response = await chrome.runtime.sendMessage({ type: "TEST_LLM" }).catch(() => null);
    if (response?.ok) {
      const { model, elapsedMs, sample } = response.info;
      setStatus(`✔ 连接成功：${model}（${elapsedMs} ms）${sample ? `，返回：${sample}` : ""}`, "ok");
    } else {
      const err = response?.error;
      setStatus(`✖ ${err?.message || "连接失败"}${err?.hint ? `\n${err.hint}` : ""}`, "err");
    }
  });

  el("clearCacheBtn").addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "CLEAR_CACHE" }).catch(() => null);
    if (response?.ok) setStatus(`✔ 已清除 ${response.removed} 条缓存`, "ok");
    else setStatus("✖ 清除失败", "err");
  });

  el("clearAllBtn").addEventListener("click", async () => {
    const confirmed = window.confirm("将删除本机保存的设置（含 API Key / Token）、缓存与进行中状态，确定继续？");
    if (!confirmed) return;
    await chrome.runtime.sendMessage({ type: "CLEAR_ALL" });
    await load();
    setStatus("✔ 已清除所有本地数据", "ok");
    await refreshStats();
  });

  el("exportBtn").addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "EXPORT_HISTORY" }).catch(() => null);
    const payload = response?.payload;
    if (!payload) {
      setStatus("✖ 导出失败", "err");
      return;
    }
    if (!payload.count) {
      setStatus("没有可导出的历史记录", "warn");
      return;
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `repo-insight-history-backup-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`✔ 已导出 ${payload.count} 条历史（不含 API Key / Token）`, "ok");
  });

  el("clearHistoryBtn").addEventListener("click", async () => {
    const list = await chrome.runtime.sendMessage({ type: "GET_HISTORY" }).catch(() => null);
    const count = list?.items?.length || 0;
    if (!count) {
      setStatus("当前没有历史记录", "warn");
      return;
    }
    if (!window.confirm(`确定清空全部 ${count} 条历史记录？该操作不可恢复。`)) return;
    await chrome.runtime.sendMessage({ type: "CLEAR_HISTORY" });
    setStatus(`✔ 已清空 ${count} 条历史记录（保留设置）`, "ok");
    await refreshStats();
  });

  await refreshStats();
});
