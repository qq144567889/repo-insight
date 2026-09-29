/*!
 * Repo Insight · 开源项目解读器（Chrome 扩展 / Manifest V3）
 * 来源作者：Yang YIZHU  (https://github.com/repo-lens)
 * 禁止商业售卖 —— 完整条款见仓库根目录 LICENSE 与 NOTICE.md
 * 任何再发布都必须完整保留本段署名信息，不得删除、隐藏或替换。
 */
// 部署方案页：沙箱体验 / 本地部署（受控执行）

import { renderMarkdown } from "./lib/markdown-view.js";
import { sanitizeFilename } from "./lib/security.js";

const el = (id) => document.getElementById(id);

let analysis = null;
let result = null;
let mode = "sandbox";

function download(filename, text, type = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = sanitizeFilename(filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function renderSandbox(analysis) {
  const sandbox = analysis.sandbox || {};
  el("sandboxMeta").textContent = `载体判定：${sandbox.label || "未识别"}　｜　${sandbox.note || ""}`;
  const box = el("sandboxLinks");
  box.replaceChildren();
  for (const link of sandbox.links || []) {
    const a = document.createElement("a");
    a.href = link.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = `🔗 ${link.label}`;
    a.style.display = "block";
    a.style.marginBottom = "6px";
    box.appendChild(a);
  }
  if (!sandbox.links?.length) {
    const p = document.createElement("div");
    p.className = "muted";
    p.textContent = sandbox.supported === false ? "该项目类型不支持浏览器沙箱，请走方案 B 并优先使用容器隔离。" : "未识别到可用的沙箱载体。";
    box.appendChild(p);
  }
}

function renderRisk(risk) {
  const level = risk?.level || "未评估";
  const pill = el("riskLevel");
  pill.textContent = level;
  pill.className = `pill ${level === "高" ? "high" : level === "中" ? "medium" : "low"}`;

  const box = el("riskHits");
  box.replaceChildren();
  if (!risk?.hits?.length) {
    const p = document.createElement("div");
    p.className = "muted";
    p.textContent = "未命中已知高风险规则。注意：静态规则无法覆盖运行时行为，仍建议容器隔离。";
    box.appendChild(p);
  }
  for (const hit of risk?.hits || []) {
    const div = document.createElement("div");
    div.className = `hit ${hit.level === "高" ? "high" : "medium"}`;
    const title = document.createElement("div");
    title.textContent = `${hit.level}风险｜${hit.rule}`;
    div.appendChild(title);
    if (hit.evidence) {
      const code = document.createElement("code");
      code.textContent = hit.evidence;
      div.appendChild(code);
    }
    box.appendChild(div);
  }

  const high = level === "高";
  el("gateExtra").textContent = high ? "我已知晓高风险，仍要继续（强烈建议先用沙箱或容器）" : "自愿继续生成部署方案";
}

function renderEnvRows(rows) {
  const box = el("envResult");
  box.replaceChildren();
  if (!rows) return;
  const table = document.createElement("table");
  table.style.cssText = "border-collapse:collapse;width:100%;font-size:12.5px";
  const head = document.createElement("tr");
  for (const label of ["依赖", "要求", "检测结果", "缺失时的安装指引"]) {
    const th = document.createElement("th");
    th.textContent = label;
    th.style.cssText = "border:1px solid var(--border);padding:5px 8px;background:var(--surface-sub);color:var(--text-1);text-align:left";
    head.appendChild(th);
  }
  table.appendChild(head);
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const value of [row.dep, row.require, row.result, row.install || "—"]) {
      const td = document.createElement("td");
      td.textContent = value;
      td.style.cssText = "border:1px solid var(--border);padding:5px 8px;color:var(--text-1)";
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  box.appendChild(table);
}

async function build(selectedMode) {
  mode = selectedMode;
  const response = await chrome.runtime.sendMessage({
    type: "BUILD_DEPLOY",
    mode: selectedMode,
    envJson: el("envJson").value,
    port: Number(el("port").value) || 3000,
  }).catch(() => null);

  if (!response?.ok) {
    window.alert("生成失败，请先完成一次解读生成。");
    return;
  }
  result = response;
  renderEnvRows(response.envRows);
  if (response.envError && selectedMode === "local" && el("envJson").value.trim()) {
    window.alert(response.envError);
  }
  el("resultCard").hidden = false;
  el("resultPreview").replaceChildren(renderMarkdown(response.section));
  el("resultCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

function showPane(name) {
  const sandbox = name === "sandbox";
  el("paneSandbox").hidden = !sandbox;
  el("paneLocal").hidden = sandbox;
  el("tabSandbox").classList.toggle("is-active", sandbox);
  el("tabLocal").classList.toggle("is-active", !sandbox);
  mode = sandbox ? "sandbox" : "local";
}

document.addEventListener("DOMContentLoaded", async () => {
  const response = await chrome.runtime.sendMessage({ type: "GET_ANALYSIS" }).catch(() => null);
  if (!response?.ok) {
    el("empty").hidden = false;
    el("repo-line").textContent = "暂无分析结果";
    return;
  }

  analysis = response.analysis;
  el("workspace").hidden = false;
  el("repo-line").textContent = `仓库：${analysis.owner}/${analysis.repo}　｜　技术栈：${analysis.stack}　｜　文件数：${analysis.files.length}${
    analysis.isPrivate ? "　｜　私有仓库" : ""
  }`;
  renderSandbox(analysis);
  renderRisk(analysis.risk);

  el("tabSandbox").addEventListener("click", () => showPane("sandbox"));
  el("tabLocal").addEventListener("click", () => showPane("local"));

  el("riskGate").addEventListener("change", () => {
    el("buildLocalBtn").disabled = !el("riskGate").checked;
  });

  el("buildSandboxBtn").addEventListener("click", () => build("sandbox"));
  el("buildLocalBtn").addEventListener("click", () => build("local"));
  el("parseEnvBtn").addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "BUILD_DEPLOY", mode: "local", envJson: el("envJson").value, port: Number(el("port").value) || 3000 });
    if (!response?.ok) return;
    if (response.envError) {
      window.alert(response.envError);
      return;
    }
    renderEnvRows(response.envRows);
  });

  el("copyLinksBtn").addEventListener("click", async () => {
    const text = (analysis.sandbox?.links || []).map((l) => `${l.label}: ${l.url}`).join("\n");
    window.alert((await copy(text)) ? "沙箱链接已复制" : "复制失败，请手动选择");
  });
  el("copyDetectBtn").addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "BUILD_DEPLOY", mode: "local", port: Number(el("port").value) || 3000 });
    if (response?.ok) window.alert((await copy(response.scripts.detectEnv)) ? "检测脚本已复制" : "复制失败");
  });
  el("downloadDetectBtn").addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "BUILD_DEPLOY", mode: "local", port: Number(el("port").value) || 3000 });
    if (response?.ok) download("repo-insight-detect-env.sh", response.scripts.detectEnv, "text/x-shellscript");
  });

  el("copySectionBtn").addEventListener("click", async () => {
    if (!result) return;
    window.alert((await copy(result.section)) ? "章节已复制" : "复制失败");
  });
  el("downloadDocBtn").addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "BUILD_DEPLOY", mode, envJson: el("envJson").value, port: Number(el("port").value) || 3000 });
    if (!response?.ok) return;
    if (!response.document) {
      window.alert("没有可用的解读正文，请先重新生成一次解读。");
      return;
    }
    download(`${analysis.repo}-解读（含部署方案）.md`, response.document, "text/markdown;charset=utf-8");
  });
  el("downloadDeployScriptBtn").addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "BUILD_DEPLOY", mode: "local", port: Number(el("port").value) || 3000 });
    if (response?.ok) download(`repo-insight-deploy-${analysis.repo}.sh`, response.scripts.deploy, "text/x-shellscript");
  });
  el("downloadDetectScriptBtn").addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "BUILD_DEPLOY", mode: "local", port: Number(el("port").value) || 3000 });
    if (response?.ok) download("repo-insight-detect-env.sh", response.scripts.detectEnv, "text/x-shellscript");
  });
});
