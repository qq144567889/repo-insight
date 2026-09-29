/*!
 * Repo Insight · 开源项目解读器（Chrome 扩展 / Manifest V3）
 * 来源作者：Yang YIZHU  (https://github.com/repo-lens)
 * 禁止商业售卖 —— 完整条款见仓库根目录 LICENSE 与 NOTICE.md
 * 任何再发布都必须完整保留本段署名信息，不得删除、隐藏或替换。
 */
// GitHub REST 抓取层：限流分流、超时、ETag 条件请求与本地缓存

import { CACHE_PREFIX, CACHE_TTL_MS } from "./settings.js";

const API = "https://api.github.com";
const JSON_ACCEPT = "application/vnd.github+json";
const RAW_ACCEPT = "application/vnd.github.raw";

export const README_MAX_CHARS = 30000;

function readRate(res) {
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (remaining === null) return null;
  const resetSeconds = Number(res.headers.get("x-ratelimit-reset") || 0);
  return {
    limit: Number(res.headers.get("x-ratelimit-limit") || 0),
    remaining: Number(remaining),
    resetAt: resetSeconds ? resetSeconds * 1000 : null,
  };
}

async function readCache(key) {
  try {
    const data = await chrome.storage.local.get(key);
    return data[key];
  } catch {
    return undefined;
  }
}

async function writeCache(key, value) {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch {
    // 配额或权限问题不应影响主流程
  }
}

async function removeCache(key) {
  try {
    await chrome.storage.local.remove(key);
  } catch {
    // 忽略
  }
}

/**
 * 统一的 GitHub 请求。
 * @returns {Promise<{data:any, rate:object|null, fromCache:boolean}>}
 */
async function ghRequest(path, { token, accept = JSON_ACCEPT, parse = "json", useCache = true, timeoutMs = 20000 } = {}) {
  const cacheKey = `${CACHE_PREFIX}${parse === "text" ? "raw:" : ""}${path}`;
  const cached = useCache ? await readCache(cacheKey) : undefined;

  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { data: cached.data, rate: cached.rate ?? null, fromCache: true };
  }

  const headers = { Accept: accept };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cached?.etag) headers["If-None-Match"] = cached.etag;

  let res;
  try {
    res = await fetch(`${API}${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const name = err?.name;
    if (name === "TimeoutError" || name === "AbortError") throw new Error("GITHUB_TIMEOUT");
    throw new Error("GITHUB_NETWORK_ERROR");
  }

  const rate = readRate(res);

  // 304 不消耗速率配额，命中缓存直接返回
  if (res.status === 304 && cached) {
    await writeCache(cacheKey, { ...cached, ts: Date.now(), rate });
    return { data: cached.data, rate, fromCache: true };
  }
  if (res.status === 404) throw new Error("GITHUB_NOT_FOUND");
  if (res.status === 401) throw new Error("GITHUB_TOKEN_INVALID");
  if (res.status === 403 || res.status === 429) {
    if (res.headers.get("x-ratelimit-remaining") === "0") throw new Error("GITHUB_RATE_LIMIT");
    if (res.headers.get("retry-after")) throw new Error("GITHUB_SECONDARY_LIMIT");
    throw new Error("GITHUB_FORBIDDEN");
  }
  if (!res.ok) throw new Error(`GITHUB_API_ERROR:${res.status}`);

  const data = parse === "text" ? await res.text() : await res.json();
  if (useCache) {
    await writeCache(cacheKey, { data, etag: res.headers.get("ETag"), ts: Date.now(), rate });
  }
  return { data, rate, fromCache: false };
}

const enc = encodeURIComponent;

/** 只取仓库元信息（1 次请求），用于打开弹窗时立即展示仓库概况 */
export async function getRepoMeta(owner, repo, { token, useCache = true } = {}) {
  const { data, rate, fromCache } = await ghRequest(`/repos/${enc(owner)}/${enc(repo)}`, { token, useCache });
  return { meta: data, rate, fromCache };
}

async function fetchReadme(owner, repo, { token, useCache }) {
  const path = `/repos/${enc(owner)}/${enc(repo)}/readme`;
  try {
    const { data, rate, fromCache } = await ghRequest(path, {
      token,
      accept: RAW_ACCEPT,
      parse: "text",
      useCache,
    });
    return { text: data || "", rate, fromCache };
  } catch (err) {
    const code = err?.message;
    if (code === "GITHUB_NOT_FOUND") return { text: "", rate: null, fromCache: false };

    // 回退路径：JSON 接口 + base64 解码（用 TextDecoder，避免 escape/atob 的编码陷阱）
    const { data, rate, fromCache } = await ghRequest(path, { token, useCache });
    let text = "";
    if (data?.encoding === "base64" && data?.content) {
      try {
        const bytes = Uint8Array.from(atob(String(data.content).replace(/\s/g, "")), (c) => c.charCodeAt(0));
        text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      } catch {
        // 解码失败时留空，绝不把 base64 原文当作正文送进模型
        text = "";
      }
    } else if (typeof data?.content === "string") {
      text = data.content;
    }
    return { text, rate, fromCache };
  }
}

/**
 * 抓取仓库数据。
 * 顺序：先取元信息（用于判定私有仓库），再并发取 README / 语言 / 根目录。
 * @param {boolean} allowPrivate 私有仓库是否允许继续（false 时抛 PRIVATE_REPO_NEEDS_CONSENT）
 */
export async function getRepoData(owner, repo, { token, useCache = true, allowPrivate = false } = {}) {
  const base = `/repos/${enc(owner)}/${enc(repo)}`;

  const metaRes = await getRepoMeta(owner, repo, { token, useCache });
  const meta = metaRes.meta;
  if (!meta || typeof meta !== "object") throw new Error("META_FETCH_FAILED");

  // 私有仓库守卫：在读取 README 之前就拦住，避免任何内容离开本机
  const isPrivate = meta.private === true;
  // 元信息是在判定可见性之前抓取的，私有仓库必须把刚写入的缓存删掉
  if (isPrivate) await removeCache(`${CACHE_PREFIX}${base}`);
  if (isPrivate && !allowPrivate) throw new Error("PRIVATE_REPO_NEEDS_CONSENT");

  // 私有仓库不写本地缓存，避免内容滞留
  const cacheForRepo = useCache && !isPrivate;

  const [readmeRes, languagesRes, contentsRes] = await Promise.allSettled([
    fetchReadme(owner, repo, { token, useCache: cacheForRepo }),
    ghRequest(`${base}/languages`, { token, useCache: cacheForRepo }),
    ghRequest(`${base}/contents`, { token, useCache: cacheForRepo }),
  ]);

  const readmeText = readmeRes.status === "fulfilled" ? readmeRes.value.text : "";
  const languages = languagesRes.status === "fulfilled" ? languagesRes.value.data : {};
  const files =
    contentsRes.status === "fulfilled" && Array.isArray(contentsRes.value.data)
      ? contentsRes.value.data.map((f) => ({ name: f?.name ?? "", type: f?.type ?? "" }))
      : [];

  return {
    owner,
    repo,
    meta,
    isPrivate,
    readmeText: readmeText.slice(0, README_MAX_CHARS),
    readmeTruncated: readmeText.length > README_MAX_CHARS,
    languages: languages && typeof languages === "object" ? languages : {},
    files,
    rate: metaRes.rate,
    fromCache: metaRes.fromCache,
  };
}
