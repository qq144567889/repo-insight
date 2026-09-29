#!/usr/bin/env node
/*!
 * Repo Insight · 开源项目解读器（Chrome 扩展 / Manifest V3）
 * 来源作者：Yang YIZHU  (https://github.com/repo-lens)
 * 禁止商业售卖 —— 完整条款见仓库根目录 LICENSE 与 NOTICE.md
 *
 * GitHub 账号改名后，把仓库里所有引用旧账号名的地方一键替换。
 * 用法：
 *   node tools/rename-owner.mjs                    # 默认：旧名 qq144567889 → 新名 repo-lens
 *   node tools/rename-owner.mjs <旧用户名> <新用户名>
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OLD = process.argv[2] || "repo-lens";
const NEW = process.argv[3] || "repo-lens";

const SKIP_DIRS = new Set([".git", "node_modules", "work"]);
const TEXT_EXT = new Set([".md", ".js", ".mjs", ".json", ".html", ".css", ".sh", ".txt", ".yml", ".yaml", ""]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".DS_Store" || SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (TEXT_EXT.has(path.extname(entry.name).toLowerCase())) out.push(abs);
  }
  return out;
}

if (OLD === NEW) {
  console.error("新旧名字相同，无需处理");
  process.exit(1);
}

let changed = 0;
const touched = [];
for (const file of walk(ROOT)) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(OLD)) continue;
  const next = text.split(OLD).join(NEW);
  fs.writeFileSync(file, next, "utf8");
  changed++;
  touched.push(path.relative(ROOT, file));
}

console.log(`已替换 ${changed} 个文件：${OLD} → ${NEW}`);
for (const f of touched) console.log("  ·", f);
if (!changed) console.log("（没有找到需要替换的内容，确认旧用户名是否正确）");

console.log("\n下一步：");
console.log(`  1) 确认 GitHub 仓库地址已是 https://github.com/${NEW}/repo-insight`);
console.log(`  2) 重新推送：GITHUB_TOKEN=新token node tools/push-via-api.mjs`);
