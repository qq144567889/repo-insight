#!/usr/bin/env node
/*!
 * Repo Insight · 开源项目解读器（Chrome 扩展 / Manifest V3）
 * 来源作者：Yang YIZHU  (https://github.com/repo-lens)
 * 禁止商业售卖 —— 完整条款见仓库根目录 LICENSE 与 NOTICE.md
 *
 * 通过 GitHub REST API 把整个仓库推送到你的账号。
 * 适用场景：本机 git/HTTPS 到 github.com 被阻断，但 api.github.com 可达。
 *
 * 用法：
 *   GITHUB_TOKEN=github_pat_xxx node tools/push-via-api.mjs
 *   GITHUB_TOKEN=xxx REPO_NAME=repo-insight node tools/push-via-api.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.github.com";
const TOKEN = process.env.GITHUB_TOKEN || process.argv[2];
const REPO = process.env.REPO_NAME || "repo-insight";
const BRANCH = process.env.BRANCH || "main";
// 提交署名固定为项目作者，避免被别人用别的账号身份覆盖（可用 MERGE=1 保留历史）
const AUTHOR = {
  name: process.env.COMMIT_NAME || "Yang YIZHU",
  email: process.env.COMMIT_EMAIL || "repo-lens@users.noreply.github.com",
};
const SQUASH = process.env.SQUASH === "1";
const DESCRIPTION =
  process.env.REPO_DESC ||
  "一键把 GitHub 仓库变成结构化解读 + 部署方案（Chrome MV3 扩展，隐私优先，支持本地 Ollama）";
const TOPICS = [
  "chrome-extension", "manifest-v3", "github-tool", "ai", "llm", "deepseek", "ollama",
  "code-analysis", "developer-tools", "markdown", "privacy", "local-first",
  "productivity", "repository-analysis", "documentation", "no-dependencies",
];

if (!TOKEN) {
  console.error("缺少 token。用法：GITHUB_TOKEN=xxx node tools/push-via-api.mjs");
  process.exit(1);
}

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "repo-insight-push",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function api(method, url, body) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON 响应 */
  }
  return { ok: res.ok, status: res.status, json, text };
}

const SKIP_DIRS = new Set([".git", "node_modules", "work"]);
const SKIP_EXT = new Set([".zip", ".crx", ".pem", ".log"]);

function collectFiles(dir, rel = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const abs = path.join(dir, entry.name);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...collectFiles(abs, relPath));
    } else {
      if (SKIP_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      out.push(relPath);
    }
  }
  return out;
}

async function main() {
  const me = await api("GET", "/user");
  if (!me.ok) {
    console.error(`token 校验失败（${me.status}）：${me.text.slice(0, 200)}`);
    process.exit(1);
  }
  const owner = me.json.login;
  console.log(`账号：${owner}`);

  const created = await api("POST", "/user/repos", {
    name: REPO,
    description: DESCRIPTION,
    homepage: `https://github.com/${owner}/${REPO}`,
    private: false,
    has_issues: true,
    has_wiki: false,
    auto_init: false,
  });
  if (created.ok) console.log(`已创建仓库：${created.json.full_name}`);
  else if (created.status === 422) console.log(`仓库已存在，继续推送：${owner}/${REPO}`);
  else {
    console.error(`创建仓库失败（${created.status}）：${created.text.slice(0, 300)}`);
    process.exit(1);
  }

  const files = collectFiles(ROOT);
  console.log(`准备上传 ${files.length} 个文件…`);

  // Git Data API 在「完全没有 commit 的空仓库」上会返回 409，
  // 所以先用 Contents API 落一个初始 commit，让仓库有 main 分支。
  let parents = [];
  const refCheck = await api("GET", `/repos/${owner}/${REPO}/git/ref/heads/${BRANCH}`);
  if (refCheck.ok) {
    parents = [refCheck.json.object.sha];
  } else {
    const init = await api("PUT", `/repos/${owner}/${REPO}/contents/.repo-insight-init`, {
      message: "chore: 初始化仓库",
      content: Buffer.from("Repo Insight · 来源作者 Yang YIZHU · 禁止商业售卖\n").toString("base64"),
      branch: BRANCH,
    });
    if (!init.ok) {
      console.error(`初始化仓库失败（${init.status}）：${init.text.slice(0, 300)}`);
      process.exit(1);
    }
    parents = [init.json.commit.sha];
    console.log("已创建初始 commit");
  }

  const tree = [];
  let index = 0;
  for (const relPath of files) {
    const content = fs.readFileSync(path.join(ROOT, relPath)).toString("base64");
    const blob = await api("POST", `/repos/${owner}/${REPO}/git/blobs`, { content, encoding: "base64" });
    if (!blob.ok) {
      console.error(`  上传失败：${relPath}（${blob.status}）${blob.text.slice(0, 160)}`);
      process.exit(1);
    }
    tree.push({ path: relPath, mode: "100644", type: "blob", sha: blob.json.sha });
    index++;
    if (index % 10 === 0 || index === files.length) console.log(`  ${index}/${files.length}`);
  }

  const treeRes = await api("POST", `/repos/${owner}/${REPO}/git/trees`, { tree });
  if (!treeRes.ok) {
    console.error(`创建 tree 失败（${treeRes.status}）：${treeRes.text.slice(0, 300)}`);
    process.exit(1);
  }

  const message = `feat: Repo Insight v${JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")).version} 首次开源\n\n来源作者：Yang YIZHU（https://github.com/${owner}）\n禁止商业售卖，详见 LICENSE 与 NOTICE.md。`;
  const commitRes = await api("POST", `/repos/${owner}/${REPO}/git/commits`, {
    message,
    tree: treeRes.json.sha,
    parents: SQUASH ? [] : parents,
    author: AUTHOR,
    committer: AUTHOR,
  });
  if (!commitRes.ok) {
    console.error(`创建 commit 失败（${commitRes.status}）：${commitRes.text.slice(0, 300)}`);
    process.exit(1);
  }

  const patch = await api("PATCH", `/repos/${owner}/${REPO}/git/refs/heads/${BRANCH}`, {
    sha: commitRes.json.sha,
    force: true,
  });
  if (!patch.ok) {
    console.error(`更新分支失败（${patch.status}）：${patch.text.slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`已推送分支：${BRANCH}`);

  const topics = await api("PUT", `/repos/${owner}/${REPO}/topics`, { names: TOPICS });
  console.log(topics.ok ? `已设置 ${TOPICS.length} 个功能标签` : `标签设置失败：${topics.text.slice(0, 160)}`);

  await api("PATCH", `/repos/${owner}/${REPO}`, { description: DESCRIPTION, homepage: `https://github.com/${owner}/${REPO}` });

  console.log(`\n完成 → https://github.com/${owner}/${REPO}`);
}

main().catch((err) => {
  console.error("执行出错：", err.message);
  process.exit(1);
});
