/*!
 * Repo Insight · 开源项目解读器（Chrome 扩展 / Manifest V3）
 * 来源作者：Yang YIZHU  (https://github.com/repo-lens)
 * 禁止商业售卖 —— 完整条款见仓库根目录 LICENSE 与 NOTICE.md
 * 任何再发布都必须完整保留本段署名信息，不得删除、隐藏或替换。
 */
// 设置读写、本地存储加固、数据清除

export const SETTINGS_KEY = "settings";
export const CACHE_PREFIX = "ghcache:";
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时

export const DEFAULT_SETTINGS = {
  provider: "deepseek",
  customBaseUrl: "",
  apiKey: "",
  model: "",
  githubToken: "",
  // 私有仓库内容是否允许发送到云端模型（默认关闭，需用户显式开启或单次确认）
  allowPrivateToCloud: false,
  // 是否启用 GitHub 响应缓存（ETag 条件请求 + 本地缓存）
  enableCache: true,
  // 是否在文档末尾附加独立的「许可证与使用限制」章节（默认关闭，保持与输出模板一致的章节结构）
  appendLicenseSection: false,
  // 是否把生成结果存入本地历史记录
  historyEnabled: true,
  // 历史记录是否包含私有仓库内容（默认关闭，避免私密内容落盘）
  historyIncludePrivate: false,
  // 打开 GitHub 仓库页时自动弹出扩展弹窗（默认开启，可在设置页关闭）
  autoPopup: true,
  // 输出详细度：brief（精简，约 2000 tokens）/ standard（标准，约 4000 tokens）
  detailLevel: "standard",
};

/**
 * 把 storage.local 从 content script 可读改为仅信任上下文可读。
 * API Key / Token 都存在这里，必须限制读取面。
 */
export async function initStorageSecurity() {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch {
    // 老版本浏览器不支持该 API，忽略即可（Chrome 102+ 均支持）
  }
}

export async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/** 一键清除全部本地数据：设置、缓存、进行中状态 */
export async function clearAllLocalData() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all);
  if (keys.length) await chrome.storage.local.remove(keys);
  try {
    await chrome.storage.session.clear();
  } catch {
    // 无 session 权限时忽略
  }
}

/** 只清缓存，保留设置 */
export async function clearCache() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
  return keys.length;
}
