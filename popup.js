/*!
 * Repo Insight · 开源项目解读器（Chrome 扩展 / Manifest V3）
 * 来源作者：Yang YIZHU  (https://github.com/repo-lens)
 * 禁止商业售卖 —— 完整条款见仓库根目录 LICENSE 与 NOTICE.md
 * 任何再发布都必须完整保留本段署名信息，不得删除、隐藏或替换。
 */
// 弹窗：URL 识别、生成、预览、复制、下载

import { parseGitHubUrl } from "./lib/url.js";
import { scanRisky, sanitizeFilename } from "./lib/security.js";
import { renderMarkdown } from "./lib/markdown-view.js";

const PORT_NAME = "repo-insight";
const PING_INTERVAL_MS = 15000;

const el = (id) => document.getElementById(id);

let parsed = null;
let tabUrl = "";
let currentMarkdown = "";
let currentRepo = "";
let port = null;
let pingTimer = null;
let reqSeq = 0;
let streamBuffer = "";
let streamTimer = null;
const pending = new Map();

function openPort() {
  if (port) return port;
  port = chrome.runtime.connect({ name: PORT_NAME });
  port.onMessage.addListener((msg) => {
    if (msg?.type === "PONG") return;
    if (msg?.type === "progress") {
      const entry = pending.get(msg.reqId);
      if (entry) entry.onProgress?.(msg.text);
      return;
    }
    if (msg?.type === "delta") {
      const entry = pending.get(msg.reqId);
      if (entry) entry.onDelta?.(msg.text);
      return;
    }
    if (msg?.type === "result") {
      const entry = pending.get(msg.reqId);
      if (entry) {
        pending.delete(msg.reqId);
        entry.resolve(msg.payload);
      }
    }
  });
  port.onDisconnect.addListener(() => {
    port = null;
    // 端口断开说明后台被回收，正在等待的请求无法完成
    for (const [, entry] of pending) {
      entry.resolve(null);
    }
    pending.clear();
  });
  return port;
}

function request(message, { onProgress, onDelta } = {}) {
  const p = openPort();
  const reqId = `r${++reqSeq}`;
  return new Promise((resolve) => {
    pending.set(reqId, { resolve, onProgress, onDelta });
    try {
      p.postMessage({ ...message, reqId });
    } catch {
      pending.delete(reqId);
      resolve(null);
    }
  });
}

function startPing() {
  stopPing();
  pingTimer = setInterval(() => {
    try {
      port?.postMessage({ type: "PING" });
    } catch {
      stopPing();
    }
  }, PING_INTERVAL_MS);
}

function stopPing() {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
}

function setBusy(busy) {
  el("generateBtn").disabled = busy || !parsed;
  el("loading").hidden = !busy;
  if (busy) startPing();
  else stopPing();
}

function showError(message, hint = "", detail = "") {
  const box = el("error");
  box.textContent = message;
  if (hint) {
    const span = document.createElement("span");
    span.className = "hint";
    span.textContent = hint;
    box.appendChild(span);
  }
  if (detail) {
    const span = document.createElement("span");
    span.className = "hint";
    span.textContent = `技术细节：${detail}`;
    box.appendChild(span);
  }
  box.hidden = false;
}

function clearMessages() {
  for (const id of ["error", "consent", "degraded", "risky", "structure", "interrupted"]) el(id).hidden = true;
}

/** 预览区渲染富文本：不再显示 # 号，但 currentMarkdown 仍是原始 Markdown */
function renderPreview() {
  el("md-preview").replaceChildren(renderMarkdown(currentMarkdown));
}

/** 流式增量渲染：节流到约 120ms 一次，避免每个分片都触发重排 */
function scheduleStreamRender() {
  if (streamTimer) return;
  streamTimer = setTimeout(() => {
    streamTimer = null;
    el("md-preview").replaceChildren(renderMarkdown(streamBuffer));
    el("md-preview").scrollTop = el("md-preview").scrollHeight;
  }, 120);
}

function renderRepoMeta(info) {
  if (!info) return;
  el("repo-meta").textContent = [
    `⭐ ${info.stars ?? "?"} ｜ 🍴 ${info.forks ?? "?"}`,
    info.language ? `⚡ ${info.language}` : "",
    info.license ? `License: ${info.license}` : "未声明 License",
    info.isPrivate ? "私有仓库" : "",
    info.archived ? "已归档" : "",
  ]
    .filter(Boolean)
    .join(" ｜ ");
}

function showPane(name) {
  const isPreview = name === "preview";
  el("panePreview").hidden = !isPreview;
  el("paneHistory").hidden = isPreview;
  el("tabPreview").classList.toggle("is-active", isPreview);
  el("tabHistory").classList.toggle("is-active", !isPreview);
}

function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function loadHistory() {
  const response = await chrome.runtime.sendMessage({ type: "GET_HISTORY" }).catch(() => null);
  const items = response?.items || [];
  el("historyCount").textContent = items.length ? ` ${items.length}` : "";

  const list = el("historyList");
  list.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "暂无历史记录，生成一次解读后会自动归档";
    list.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "history-item";

    const main = document.createElement("div");
    main.className = "history-main";
    main.title = "点击恢复到预览区";

    const name = document.createElement("div");
    name.className = "history-repo";
    name.textContent = `${item.owner}/${item.repo}`;
    if (item.isPrivate) {
      const badge = document.createElement("span");
      badge.className = "badge private";
      badge.textContent = "私有";
      name.appendChild(badge);
    }
    if (item.degraded) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "降级";
      name.appendChild(badge);
    }

    const sub = document.createElement("div");
    sub.className = "history-sub";
    sub.textContent = `${formatTime(item.timestamp)} ｜ ⭐ ${item.stars ?? "?"} ｜ ${formatBytes(item.bytes)}`;

    main.append(name, sub);
    main.addEventListener("click", () => restoreHistory(item.id));

    const del = document.createElement("button");
    del.className = "history-del";
    del.textContent = "✕";
    del.title = "删除这条记录";
    del.addEventListener("click", async (event) => {
      event.stopPropagation();
      await chrome.runtime.sendMessage({ type: "DELETE_HISTORY", id: item.id });
      await loadHistory();
    });

    row.append(main, del);
    list.appendChild(row);
  }
}

async function restoreHistory(id) {
  const response = await chrome.runtime.sendMessage({ type: "GET_HISTORY_ENTRY", id }).catch(() => null);
  const entry = response?.entry;
  if (!entry) return;

  clearMessages();
  currentMarkdown = entry.markdown;
  currentRepo = entry.repo;
  renderPreview();
  el("md-preview").scrollTop = 0;
  el("copyBtn").disabled = false;
  el("downloadBtn").disabled = false;
  el("deployBtn").disabled = false;
  showPane("preview");
  if (entry.degraded) showDegraded("该记录为本地模板生成", "");
  showRisky(scanRisky(currentMarkdown));
  el("quota").textContent = `已恢复历史记录 ｜ ${entry.owner}/${entry.repo}`;
}

function showStructureWarning(structure) {
  const box = el("structure");
  if (!structure || structure.ok) {
    box.hidden = true;
    return;
  }
  const parts = [];
  if (structure.missing?.length) parts.push(`缺少章节：${structure.missing.join("、")}`);
  if (structure.orderOk === false) parts.push("章节顺序与模板不一致");
  box.textContent = `⚠️ 模型输出未完全匹配模板（${parts.join("；")}），可重新生成。`;
  box.hidden = false;
}

function showDegraded(reason, hint) {
  const box = el("degraded");
  box.textContent = `⚠️ 已使用本地模板生成（${reason}）${hint ? `　${hint}` : ""}`;
  box.hidden = false;
}

function showRisky(hits) {
  const box = el("risky");
  if (!hits?.length) {
    box.hidden = true;
    return;
  }
  box.textContent = `⚠️ 检测到 ${hits.length} 处高风险命令模式，执行前请人工确认脚本来源：`;
  const ul = document.createElement("ul");
  for (const hit of hits.slice(0, 5)) {
    const li = document.createElement("li");
    li.textContent = `第 ${hit.line} 行（${hit.label}）：${hit.text}`;
    ul.appendChild(li);
  }
  box.appendChild(ul);
  box.hidden = false;
}

function showConsent(context) {
  const box = el("consent");
  box.textContent = "";
  const title = document.createElement("div");
  title.textContent = `🔒 ${context.repo} 是私有仓库。继续生成会把 README 全文发送给 ${context.provider}。`;
  const note = document.createElement("div");
  note.textContent = "仅本地 Ollama 不会外发任何内容。";
  const actions = document.createElement("div");
  actions.className = "actions";

  const send = document.createElement("button");
  send.className = "primary";
  send.textContent = "仍然发送";
  send.addEventListener("click", () => {
    clearMessages();
    generate({ allowPrivateOnce: true });
  });

  const local = document.createElement("button");
  local.textContent = "改用本地模型";
  local.addEventListener("click", async () => {
    const data = await chrome.storage.local.get("settings");
    const settings = { ...(data.settings || {}), provider: "ollama" };
    await chrome.storage.local.set({ settings });
    clearMessages();
    generate({ allowPrivateOnce: false });
  });

  const cancel = document.createElement("button");
  cancel.textContent = "取消";
  cancel.addEventListener("click", () => {
    box.hidden = true;
  });

  actions.append(send, local, cancel);
  box.append(title, note, actions);
  box.hidden = false;
}

function renderQuota(rate, repoInfo) {
  const parts = [];
  if (rate && Number.isFinite(rate.remaining)) {
    const reset = rate.resetAt ? new Date(rate.resetAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";
    parts.push(`GitHub 配额剩余 ${rate.remaining}${rate.limit ? `/${rate.limit}` : ""}${reset ? `（${reset} 重置）` : ""}`);
  }
  if (repoInfo?.fromCache) parts.push("命中缓存");
  if (repoInfo?.readmeTruncated) parts.push("README 已截断");
  el("quota").textContent = parts.join(" ｜ ");
}

async function generate({ allowPrivateOnce = false } = {}) {
  if (!parsed) return;
  clearMessages();
  el("md-preview").replaceChildren();
  el("copyBtn").disabled = true;
  el("downloadBtn").disabled = true;
  currentMarkdown = "";
  streamBuffer = "";
  setBusy(true);
  el("loading").textContent = "正在准备…";

  let response;
  try {
    response = await request(
      { type: "GENERATE", url: tabUrl, allowPrivateOnce },
      {
        onProgress: (text) => (el("loading").textContent = text),
        onDelta: (text) => {
          streamBuffer += text;
          scheduleStreamRender();
        },
      }
    );
  } catch (err) {
    response = null;
  }

  setBusy(false);

  if (!response) {
    showError("生成被中断。", "后台服务在中途被浏览器回收或连接失败，请重试一次。");
    return;
  }
  if (!response.ok) {
    const err = response.error || {};
    if (err.code === "PRIVATE_REPO_NEEDS_CONSENT") {
      showConsent(response.context || { repo: `${parsed.owner}/${parsed.repo}`, provider: "所选模型服务" });
      return;
    }
    showError(err.message || "生成失败", err.hint || "", err.detail || "");
    return;
  }

  currentMarkdown = response.markdown;
  currentRepo = parsed.repo;
  renderPreview();
  el("md-preview").scrollTop = 0; // 生成结束回到文首，便于从头阅读
  if (streamTimer) {
    clearTimeout(streamTimer);
    streamTimer = null;
  }
  el("copyBtn").disabled = false;
  el("downloadBtn").disabled = false;
  el("deployBtn").disabled = false;
  if (response.degraded) showDegraded(response.degradedReason || "模型不可用", response.degradedHint || "");
  else {
    // 二次扫描：即使后台漏判，客户端再查一遍（防御纵深）
    const merged = [...(response.riskyHits || [])];
    for (const hit of scanRisky(currentMarkdown)) {
      if (!merged.some((m) => m.line === hit.line)) merged.push(hit);
    }
    showRisky(merged);
  }
  showStructureWarning(response.structure);
  renderRepoMeta(response.repoInfo);
  renderQuota(response.rate, response.repoInfo);
  await loadHistory();
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabUrl = tab?.url || "";
  parsed = parseGitHubUrl(tabUrl);

  if (parsed) {
    el("repo-name").textContent = `${parsed.owner}/${parsed.repo}`;
    el("repo-meta").textContent = "正在读取仓库信息…";
    el("generateBtn").disabled = false;
    // 预热：只请求元信息（命中缓存时 0 次请求），弹窗打开即显示仓库概况
    chrome.runtime
      .sendMessage({ type: "PREFETCH", url: tabUrl })
      .then((response) => {
        if (response?.ok) {
          renderRepoMeta(response.repoInfo);
          renderQuota(response.rate, response.repoInfo);
        } else if (response?.error?.code === "GITHUB_RATE_LIMIT") {
          el("repo-meta").textContent = "已识别仓库；GitHub 配额已用尽，可在设置页配置 Token";
        } else {
          el("repo-meta").textContent = "已识别到仓库，点击下方按钮生成解读";
        }
      })
      .catch(() => {
        el("repo-meta").textContent = "已识别到仓库，点击下方按钮生成解读";
      });
  } else {
    el("repo-name").textContent = "未识别到仓库";
    el("repo-meta").textContent = "请先在浏览器中打开一个 GitHub 仓库页面";
    el("generateBtn").disabled = true;
  }

  el("generateBtn").addEventListener("click", () => generate());

  el("copyBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(currentMarkdown);
      el("copyBtn").textContent = "✔ 已复制";
      setTimeout(() => (el("copyBtn").textContent = "📋 复制"), 1500);
    } catch {
      showError("复制失败，请手动选择文本复制");
    }
  });

  el("downloadBtn").addEventListener("click", () => {
    const blob = new Blob([currentMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = sanitizeFilename(`${currentRepo || parsed?.repo || "repo"}-解读.md`);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  el("deployBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("deploy.html") });
  });

  for (const id of ["openOptions", "openOptionsTop"]) {
    el(id).addEventListener("click", (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

  el("tabPreview").addEventListener("click", () => showPane("preview"));
  el("tabHistory").addEventListener("click", () => showPane("history"));
  el("clearHistoryBtn").addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "GET_HISTORY" }).catch(() => null);
    const count = response?.items?.length || 0;
    if (!count) return;
    if (!window.confirm(`确定清空全部 ${count} 条历史记录？该操作不可恢复。`)) return;
    await chrome.runtime.sendMessage({ type: "CLEAR_HISTORY" });
    await loadHistory();
  });

  await loadHistory();

  // 上次生成是否被中断
  const state = await chrome.runtime.sendMessage({ type: "GET_INFLIGHT" }).catch(() => null);
  const inflight = state?.inflight;
  if (inflight && Date.now() - inflight.startedAt > 45000) {
    const box = el("interrupted");
    box.textContent = `⚠️ 检测到一次未完成的生成（${inflight.owner}/${inflight.repo}），可能因后台被回收而中断，请重新生成。`;
    box.hidden = false;
  }
}

document.addEventListener("DOMContentLoaded", init);
