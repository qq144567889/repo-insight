/*!
 * Repo Insight · 开源项目解读器（Chrome 扩展 / Manifest V3）
 * 来源作者：Yang YIZHU  (https://github.com/repo-lens)
 * 禁止商业售卖 —— 完整条款见仓库根目录 LICENSE 与 NOTICE.md
 * 任何再发布都必须完整保留本段署名信息，不得删除、隐藏或替换。
 */
// 唯一的 GitHub 仓库 URL 解析实现（popup 与 background 共用，避免两份正则漂移）

// github.com 的一级路径保留字：这些不是用户名，遇到即判定为非仓库页
export const GH_RESERVED_PATHS = new Set([
  "settings", "features", "login", "logout", "about", "pricing", "topics",
  "collections", "search", "marketplace", "sponsors", "orgs", "explore",
  "notifications", "users", "apps", "issues", "pulls", "discussions",
  "dashboard", "new", "codespaces", "account", "organizations", "site",
  "home", "trending", "events", "stars", "watching", "security", "enterprise",
]);

const NAME_RE = /^[A-Za-z0-9._-]+$/;

/**
 * 从 URL 解析出 { owner, repo }；不是仓库页返回 null。
 * 注意：这里只做解析，稳定性由后续 api.github.com 请求保证。
 */
export function parseGitHubUrl(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return null;

  const seg = u.pathname.split("/").filter(Boolean);
  if (seg.length < 2) return null;

  const owner = seg[0];
  const repoRaw = seg[1];
  if (GH_RESERVED_PATHS.has(owner.toLowerCase())) return null;
  if (!NAME_RE.test(owner)) return null;

  const repo = repoRaw.replace(/\.git$/i, "");
  if (!repo || !NAME_RE.test(repo)) return null;

  return { owner, repo };
}

export function repoFullName({ owner, repo }) {
  return `${owner}/${repo}`;
}
