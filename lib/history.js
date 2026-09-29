/*!
 * Repo Insight · 开源项目解读器（Chrome 扩展 / Manifest V3）
 * 来源作者：Yang YIZHU  (https://github.com/repo-lens)
 * 禁止商业售卖 —— 完整条款见仓库根目录 LICENSE 与 NOTICE.md
 * 任何再发布都必须完整保留本段署名信息，不得删除、隐藏或替换。
 */
// 历史记录：生成结果的本地归档（含全文快照）

import { redactDocument } from "./security.js";

export const HISTORY_KEY = "history";
export const HISTORY_LIMIT = 20;
const HISTORY_MAX_BYTES = 5 * 1024 * 1024;

const encoder = new TextEncoder();

function newId() {
  return `h_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toMeta(item) {
  return {
    id: item.id,
    owner: item.owner,
    repo: item.repo,
    url: item.url,
    stars: item.stars ?? null,
    timestamp: item.timestamp,
    degraded: item.degraded === true,
    isPrivate: item.isPrivate === true,
    bytes: item.bytes ?? 0,
    model: item.model ?? "",
  };
}

async function readAll() {
  const data = await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
}

/** 列表只返回元信息，正文按需再取，避免每次打开弹窗传输大对象 */
export async function listHistory() {
  return (await readAll()).map(toMeta);
}

/**
 * 写入一条历史。同仓库只保留最新一条；超出条数或体积上限时淘汰最旧。
 * @returns {Promise<string>} 新条目 id
 */
export async function addHistory(entry) {
  const markdown = String(entry.markdown ?? "");
  const item = {
    id: newId(),
    owner: entry.owner,
    repo: entry.repo,
    url: entry.url ?? "",
    stars: entry.stars ?? null,
    timestamp: Date.now(),
    degraded: entry.degraded === true,
    isPrivate: entry.isPrivate === true,
    model: entry.model ?? "",
    bytes: encoder.encode(markdown).length,
    markdown,
  };

  const existing = await readAll();
  const next = [item, ...existing.filter((x) => !(x.owner === item.owner && x.repo === item.repo))];
  while (next.length > HISTORY_LIMIT) next.pop();

  let total = next.reduce((sum, x) => sum + (x.bytes ?? 0), 0);
  while (next.length > 1 && total > HISTORY_MAX_BYTES) {
    total -= next.pop().bytes ?? 0;
  }

  await chrome.storage.local.set({ [HISTORY_KEY]: next });
  return item.id;
}

export async function getHistoryEntry(id) {
  const found = (await readAll()).find((x) => x.id === id);
  return found ? { ...toMeta(found), markdown: found.markdown ?? "" } : null;
}

export async function deleteHistory(id) {
  const next = (await readAll()).filter((x) => x.id !== id);
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
  return next.length;
}

export async function clearHistory() {
  await chrome.storage.local.remove(HISTORY_KEY);
  return 0;
}

/** 导出用：完整快照，不含任何密钥（settings 不在其中） */
export async function buildHistoryExport() {
  const items = await readAll();
  return {
    schema: "repo-insight.history/1",
    exportedAt: new Date().toISOString(),
    count: items.length,
    // 导出前再脱敏一次：即使历史上存的是未脱敏内容，也不让密钥离开本机
    items: items.map((x) => ({ ...toMeta(x), markdown: redactDocument(x.markdown ?? "") })),
  };
}

/** 存储统计：占用、条数、key 列表 */
export async function storageStats() {
  const all = await chrome.storage.local.get(null);
  const items = Array.isArray(all[HISTORY_KEY]) ? all[HISTORY_KEY] : [];
  let bytes = 0;
  for (const [key, value] of Object.entries(all)) {
    bytes += encoder.encode(key).length + encoder.encode(JSON.stringify(value) ?? "").length;
  }
  const cacheKeys = Object.keys(all).filter((k) => k.startsWith("ghcache:"));
  return {
    bytes,
    historyCount: items.length,
    historyBytes: items.reduce((sum, x) => sum + (x.bytes ?? 0), 0),
    cacheCount: cacheKeys.length,
    keys: Object.keys(all).filter((k) => !k.startsWith("ghcache:")),
    hasApiKey: Boolean(all.settings?.apiKey),
    hasGithubToken: Boolean(all.settings?.githubToken),
  };
}
