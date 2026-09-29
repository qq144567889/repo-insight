/*!
 * Repo Insight · 开源项目解读器（Chrome 扩展 / Manifest V3）
 * 来源作者：Yang YIZHU  (https://github.com/repo-lens)
 * 禁止商业售卖 —— 完整条款见仓库根目录 LICENSE 与 NOTICE.md
 * 任何再发布都必须完整保留本段署名信息，不得删除、隐藏或替换。
 */
// Service Worker：消息路由 + 生成编排

import { parseGitHubUrl, repoFullName } from "./lib/url.js";
import { getRepoData, getRepoMeta } from "./lib/github.js";
import { callLLM, streamLLM, testConnection, providerLabel, resolveEndpoint, maxTokensFor } from "./lib/llm.js";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION, buildUserPrompt } from "./lib/prompt.js";
import {
  buildFallbackMarkdown,
  finalizeModelMarkdown,
  insertRiskyNotice,
  ensureLicenseBullet,
  checkTemplateStructure,
  detectStack,
  MODEL_TEMPLATE_HEADINGS,
  FALLBACK_TEMPLATE_HEADINGS,
} from "./lib/template.js";
import { toErrorPayload } from "./lib/errors.js";
import { scanRisky, redactDocument } from "./lib/security.js";
import { assessRisk, detectSandbox } from "./lib/risk.js";
import {
  buildDeployScript,
  buildDetectEnvScript,
  buildSandboxSection,
  buildLocalDeploySection,
  buildEnvTable,
  parseEnvJson,
  resolveRunner,
  composeDeployDocument,
  DEFAULT_PORT,
} from "./lib/deploy.js";
import {
  initStorageSecurity,
  getSettings,
  clearAllLocalData,
  clearCache,
  DEFAULT_SETTINGS,
} from "./lib/settings.js";
import {
  listHistory,
  getHistoryEntry,
  deleteHistory,
  clearHistory,
  buildHistoryExport,
  storageStats,
  addHistory,
  HISTORY_LIMIT,
} from "./lib/history.js";

const PORT_NAME = "repo-insight";
const INFLIGHT_KEY = "inflight";
const ANALYSIS_KEY = "lastAnalysis";

// 把本地存储限制为仅扩展页面可读（content script 无法读取 API Key）
initStorageSecurity();

async function setInflight(value) {
  try {
    if (value) await chrome.storage.session.set({ [INFLIGHT_KEY]: value });
    else await chrome.storage.session.remove(INFLIGHT_KEY);
  } catch {
    // session 存储不可用时忽略
  }
}

async function getInflight() {
  try {
    const data = await chrome.storage.session.get(INFLIGHT_KEY);
    return data[INFLIGHT_KEY] ?? null;
  } catch {
    return null;
  }
}

async function setAnalysis(value) {
  try {
    if (value) await chrome.storage.session.set({ [ANALYSIS_KEY]: value });
  } catch {
    // 忽略
  }
}

async function getAnalysis() {
  try {
    const data = await chrome.storage.session.get(ANALYSIS_KEY);
    return data[ANALYSIS_KEY] ?? null;
  } catch {
    return null;
  }
}

function summarizeRepo(data) {
  const meta = data.meta || {};
  return {
    fullName: repoFullName(data),
    stars: meta.stargazers_count ?? null,
    forks: meta.forks_count ?? null,
    language: meta.language ?? null,
    license: meta.license?.spdx_id ?? null,
    isPrivate: data.isPrivate === true,
    archived: meta.archived === true,
    pushedAt: meta.pushed_at ?? null,
    fromCache: data.fromCache === true,
    readmeTruncated: data.readmeTruncated === true,
  };
}

async function handleGenerate(message, report, emitDelta = null) {
  const parsed = parseGitHubUrl(message.url);
  if (!parsed) return { ok: false, error: toErrorPayload("NOT_A_REPO_PAGE") };

  const settings = await getSettings();
  const providerName = providerLabel(settings.provider);
  const allowPrivate =
    settings.provider === "ollama" || settings.allowPrivateToCloud === true || message.allowPrivateOnce === true;

  await setInflight({ owner: parsed.owner, repo: parsed.repo, startedAt: Date.now() });
  try {
    report("github", `正在抓取 ${repoFullName(parsed)} 的仓库信息…`);
    const data = await getRepoData(parsed.owner, parsed.repo, {
      token: settings.githubToken,
      useCache: settings.enableCache !== false,
      allowPrivate,
    });

    const repoInfo = summarizeRepo(data);

    let markdown = "";
    let degraded = false;
    let degradedCode = "";
    let degradedReason = "";
    let degradedHint = "";
    let modelLabel = "local-template";

    try {
      resolveEndpoint(settings); // 提前校验配置，未配置直接走本地模板
      const maxTokens = maxTokensFor(settings.detailLevel);
      const userPrompt = buildUserPrompt(data);
      let result;
      if (emitDelta) {
        // 端口通道：边生成边回传，首字通常在 1-3 秒内出现
        report("llm", `正在调用 ${providerName}（流式输出）…`);
        result = await streamLLM({
          systemPrompt: SYSTEM_PROMPT,
          userPrompt,
          settings,
          onDelta: emitDelta,
          maxTokens,
        });
      } else {
        report("llm", `正在调用 ${providerName}…`);
        result = await callLLM({ systemPrompt: SYSTEM_PROMPT, userPrompt, settings, maxTokens });
      }
      modelLabel = `${result.provider}/${result.model}`;
      markdown = finalizeModelMarkdown(result.content, data, {
        model: modelLabel,
        promptVersion: SYSTEM_PROMPT_VERSION,
        appendLicenseSection: settings.appendLicenseSection === true,
      });
      // 模板里没有独立的许可证章节，限制信息统一并入风险条目
      markdown = ensureLicenseBullet(markdown, data.meta);
    } catch (err) {
      degraded = true;
      const payload = toErrorPayload(err);
      degradedCode = payload.code;
      degradedReason = payload.message;
      degradedHint = payload.hint;
      modelLabel = "local-template";
      // 未配置属于预期降级，不算错误；其余情况在 UI 上做提示
      markdown = buildFallbackMarkdown(data, {
        reason: degradedReason,
        promptVersion: SYSTEM_PROMPT_VERSION,
        appendLicenseSection: settings.appendLicenseSection === true,
      });
    }

    // 风险提示与行号都按最终文档计算（头部插入标识会让行号整体位移）
    const preHits = scanRisky(markdown);
    if (preHits.length) markdown = insertRiskyNotice(markdown, preHits);
    // 文档级脱敏：预览 / 复制 / 下载 / 历史记录共用同一份脱敏内容
    markdown = redactDocument(markdown);
    const riskyHits = scanRisky(markdown);
    const structure = checkTemplateStructure(markdown, degraded ? FALLBACK_TEMPLATE_HEADINGS : MODEL_TEMPLATE_HEADINGS);

    // 评估部署风险与沙箱载体，供部署页使用
    const stack = detectStack(data.files);
    const risk = assessRisk({ meta: data.meta, readmeText: data.readmeText, files: data.files });
    const sandbox = detectSandbox({ owner: parsed.owner, repo: parsed.repo, files: data.files, meta: data.meta });
    await setAnalysis({
      owner: parsed.owner,
      repo: parsed.repo,
      url: `https://github.com/${repoFullName(parsed)}`,
      stack,
      files: data.files.map((f) => ({ name: f.name, type: f.type })),
      isPrivate: data.isPrivate === true,
      risk,
      sandbox,
      markdown,
      generatedAt: Date.now(),
    });

    // 归档到本地历史（私有仓库默认不落盘）
    let historyId = null;
    const historyAllowed =
      settings.historyEnabled !== false && (data.isPrivate !== true || settings.historyIncludePrivate === true);
    if (historyAllowed && markdown) {
      historyId = await addHistory({
        owner: parsed.owner,
        repo: parsed.repo,
        url: `https://github.com/${repoFullName(parsed)}`,
        stars: data.meta?.stargazers_count ?? null,
        degraded,
        isPrivate: data.isPrivate === true,
        model: modelLabel,
        markdown,
      });
    }

    return {
      ok: true,
      markdown,
      degraded,
      degradedCode,
      degradedReason,
      degradedHint,
      repoInfo,
      riskyHits,
      rate: data.rate,
      structure,
      historyId,
      historySaved: historyAllowed && Boolean(markdown),
      risk,
      sandbox,
    };
  } catch (err) {
    const payload = toErrorPayload(err);
    const response = { ok: false, error: payload };
    if (payload.code === "PRIVATE_REPO_NEEDS_CONSENT") {
      response.context = {
        repo: repoFullName(parsed),
        provider: providerName,
        localOnly: false,
      };
    }
    return response;
  } finally {
    await setInflight(null);
  }
}

async function handleTest() {
  try {
    const settings = await getSettings();
    const info = await testConnection(settings);
    return { ok: true, info };
  } catch (err) {
    return { ok: false, error: toErrorPayload(err) };
  }
}

/** 打开弹窗时预热：只取元信息（1 次请求，命中缓存则 0 次） */
async function handlePrefetch(message) {
  const parsed = parseGitHubUrl(message.url);
  if (!parsed) return { ok: false, error: toErrorPayload("NOT_A_REPO_PAGE") };
  // 弹窗已经打开，角标提示可以撤掉
  await clearActionBadge();
  const settings = await getSettings();
  try {
    const { meta, rate, fromCache } = await getRepoMeta(parsed.owner, parsed.repo, {
      token: settings.githubToken,
      useCache: settings.enableCache !== false,
    });
    return {
      ok: true,
      fromCache,
      rate,
      repoInfo: {
        fullName: `${parsed.owner}/${parsed.repo}`,
        stars: meta?.stargazers_count ?? null,
        forks: meta?.forks_count ?? null,
        language: meta?.language ?? null,
        license: meta?.license?.spdx_id ?? null,
        isPrivate: meta?.private === true,
        archived: meta?.archived === true,
        pushedAt: meta?.pushed_at ?? null,
        fromCache,
      },
    };
  } catch (err) {
    return { ok: false, error: toErrorPayload(err) };
  }
}

/** 部署页：取当前分析结果 */
async function handleGetAnalysis() {
  const analysis = await getAnalysis();
  if (!analysis) return { ok: false, error: { code: "NO_ANALYSIS", message: "还没有生成解读，请先在仓库页生成一次", hint: "", retryable: false, detail: "" } };
  return {
    ok: true,
    analysis: {
      owner: analysis.owner,
      repo: analysis.repo,
      url: analysis.url,
      stack: analysis.stack,
      files: analysis.files,
      isPrivate: analysis.isPrivate,
      risk: analysis.risk,
      sandbox: analysis.sandbox,
      generatedAt: analysis.generatedAt,
    },
    hasDocument: Boolean(analysis.markdown),
  };
}

/** 部署页：生成部署章节（含脚本与环境预检） */
async function handleBuildDeploy(message) {
  const analysis = await getAnalysis();
  if (!analysis) return { ok: false, error: toErrorPayload("UNEXPECTED") };

  const port = Number(message?.port) > 0 ? Number(message.port) : DEFAULT_PORT;
  const runner = resolveRunner(analysis.stack, analysis.files);
  const files = analysis.files;
  const scripts = {
    deploy: buildDeployScript({ owner: analysis.owner, repo: analysis.repo, stack: analysis.stack, files, port }),
    detectEnv: buildDetectEnvScript({ port }),
  };

  const envResult = parseEnvJson(message?.envJson);
  const envRows = envResult.ok ? buildEnvTable(envResult.data, { port }) : null;

  const section =
    message?.mode === "sandbox"
      ? buildSandboxSection({ owner: analysis.owner, repo: analysis.repo, sandbox: analysis.sandbox })
      : buildLocalDeploySection({
          owner: analysis.owner,
          repo: analysis.repo,
          stack: analysis.stack,
          risk: analysis.risk,
          envRows,
          runner,
          port,
        });

  return {
    ok: true,
    mode: message?.mode === "sandbox" ? "sandbox" : "local",
    section,
    scripts,
    envRows,
    envError: envResult.ok ? "" : envResult.error,
    document: analysis.markdown ? composeDeployDocument(analysis.markdown, section) : "",
  };
}

async function route(message, report = () => {}, emitDelta = null) {
  switch (message?.type) {
    case "GENERATE":
      return handleGenerate(message, report, emitDelta);
    case "PREFETCH":
      return handlePrefetch(message);
    case "GET_ANALYSIS":
      return handleGetAnalysis();
    case "BUILD_DEPLOY":
      return handleBuildDeploy(message);
    case "TEST_LLM":
      return handleTest();
    case "GET_INFLIGHT":
      return { ok: true, inflight: await getInflight() };
    case "CLEAR_ALL":
      await clearAllLocalData();
      return { ok: true };
    case "CLEAR_CACHE": {
      const removed = await clearCache();
      return { ok: true, removed };
    }
    case "GET_HISTORY":
      return { ok: true, items: await listHistory(), limit: HISTORY_LIMIT };
    case "GET_HISTORY_ENTRY": {
      const entry = await getHistoryEntry(message.id);
      return entry ? { ok: true, entry } : { ok: false, error: toErrorPayload("UNEXPECTED") };
    }
    case "DELETE_HISTORY":
      return { ok: true, remaining: await deleteHistory(message.id) };
    case "CLEAR_HISTORY":
      await clearHistory();
      return { ok: true };
    case "EXPORT_HISTORY":
      return { ok: true, payload: await buildHistoryExport() };
    case "STORAGE_STATS":
      return { ok: true, stats: await storageStats() };
    case "GET_DEFAULTS":
      return { ok: true, defaults: DEFAULT_SETTINGS };
    default:
      return { ok: false, error: toErrorPayload("UNEXPECTED") };
  }
}

// 长任务通道：popup 建立端口，端口期间周期性 PING 以降低 SW 被回收的概率
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  port.onMessage.addListener((message) => {
    if (message?.type === "PING") {
      port.postMessage({ type: "PONG", at: Date.now() });
      return;
    }
    const report = (phase, text) => port.postMessage({ type: "progress", reqId: message?.reqId, phase, text });
    route(message, report, (text) => port.postMessage({ type: "delta", reqId: message?.reqId, text }))
      .then((payload) => port.postMessage({ type: "result", reqId: message?.reqId, payload }))
      .catch((err) => port.postMessage({ type: "result", reqId: message?.reqId, payload: { ok: false, error: toErrorPayload(err) } }));
  });
});

// ---------- 打开仓库页自动弹出弹窗 ----------
// 说明：Chrome 不允许扩展凭空弹窗，只能用 chrome.action.openPopup()；
// 该调用在窗口未聚焦等情况下会失败，此时退化为设置角标提示。
const autoPopupSeen = new Map();

async function clearActionBadge(tabId) {
  try {
    await chrome.action.setBadgeText(tabId ? { tabId, text: "" } : { text: "" });
  } catch {
    // 忽略：标签页可能已关闭
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab?.url || "";
  if (!url) return;
  if (!parseGitHubUrl(url)) return;
  if (changeInfo.status && changeInfo.status !== "complete" && !changeInfo.url) return;

  const settings = await getSettings();
  if (settings.autoPopup === false) {
    await clearActionBadge(tabId);
    return;
  }
  if (autoPopupSeen.get(tabId) === url) return;
  autoPopupSeen.set(tabId, url);

  let result = "opened";
  try {
    // openPopup 在弹窗已存在等情况下可能长时间不返回，加超时避免后续逻辑被卡住
    const raced = await Promise.race([
      chrome.action.openPopup().then(() => "resolved"),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 1500)),
    ]);
    if (raced === "timeout") result = "opened-timeout";
  } catch {
    result = "badge";
    try {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#0969da" });
      await chrome.action.setBadgeText({ tabId, text: "✦" });
    } catch {
      // 无法提示时静默
    }
  }
  // 记录一次结果，便于排查（仅会话内有效）
  try {
    await chrome.storage.session.set({ lastAutoPopup: { url, at: Date.now(), result } });
  } catch {
    // 忽略
  }
});

chrome.tabs.onRemoved.addListener((tabId) => autoPopupSeen.delete(tabId));

// 兼容通道：设置页测试连接等短请求
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender?.id && sender.id !== chrome.runtime.id) return false;
  route(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: toErrorPayload(err) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  initStorageSecurity();
});
