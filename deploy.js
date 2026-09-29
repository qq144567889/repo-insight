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
let os = /windows|win32/i.test(navigator.userAgent) ? "win" : "mac";
let beginnerReady = false;

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
    os,
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

async function downloadTailored(kind) {
  if (!analysis) return;
  try {
    const { text, filename } = await buildTailoredInstaller(kind);
    download(filename, text, kind === "win" ? "application/bat" : "text/x-shellscript");
    window.alert(
      kind === "win"
        ? `已经下载好「${filename}」。\n\n把它放到桌面，双击即可运行（Windows 会弹出蓝色窗口，一路看着就行）。`
        : `已经下载好「${filename}」。\n\n双击即可运行。\n如果提示"没有权限"或"未验证的开发者"：右键该文件 → 打开 → 再点一次「打开」。`
    );
  } catch (err) {
    window.alert("生成安装脚本失败：" + err.message);
  }
}

function showPane(name) {
  const sandbox = name === "sandbox";
  const beginner = name === "beginner";
  const local = name === "local";
  el("paneSandbox").hidden = !sandbox;
  el("paneBeginner").hidden = !beginner;
  el("paneLocal").hidden = !local;
  el("tabSandbox").classList.toggle("is-active", sandbox);
  el("tabBeginner").classList.toggle("is-active", beginner);
  el("tabLocal").classList.toggle("is-active", local);
  mode = sandbox ? "sandbox" : beginner ? "beginner" : "local";
  if (beginner) refreshBeginner();
}

/* ---------- 方案 C：新手 ---------- */

function beginnerButtonsEnabled(enabled) {
  for (const id of ["downloadBeginnerMac", "downloadBeginnerWin", "copyOneLiner", "buildBeginnerBtn"]) {
    el(id).disabled = !enabled;
  }
}

function renderOsHint() {
  el("osMac").classList.toggle("primary", os === "mac");
  el("osWin").classList.toggle("primary", os === "win");
  el("osHint").textContent =
    os === "mac"
      ? "已按 Mac 准备：下载的是「.command」文件，双击即可（第一次双击若提示权限，右键→打开）。"
      : "已按 Windows 准备：下载的是「.bat」文件，双击即可运行。";
}

async function refreshBeginner() {
  if (!analysis) return;
  renderOsHint();
  const risk = analysis.risk || {};
  const pill = el("beginnerRisk");
  pill.textContent = risk.level || "低";
  pill.className = `pill ${risk.level === "高" ? "high" : risk.level === "中" ? "medium" : "low"}`;

  const response = await chrome.runtime.sendMessage({ type: "BUILD_DEPLOY", mode: "beginner", os, port: Number(el("port").value) || 3000 });
  if (response?.ok) {
    el("oneLinerBox").value = response.oneLiner;
    beginnerReady = true;
  }
  beginnerButtonsEnabled(el("beginnerGate").checked);
}

/** 把仓库里通用的安装脚本改写成"项目已填好"的版本 */
async function buildTailoredInstaller(kind) {
  const file = kind === "win" ? "install.bat" : "install.sh";
  const raw = await fetch(chrome.runtime.getURL(file)).then((r) => r.text());
  const project = `${analysis.owner}/${analysis.repo}`;
  const port = Number(el("port").value) || 3000;

  if (kind === "win") {
    const patched = raw
      .replace('set "PROJECT=%~1"', `set "PROJECT=%~1"\r\nif "%PROJECT%"=="" set "PROJECT=${project}"\r\nif "%PORT%"=="" set "PORT=${port}"`)
      .replace(/\r?\n/g, "\r\n");
    return { text: patched, filename: `repo-insight-安装-${analysis.repo}.bat` };
  }

  const body = raw.replace(/^#!.*\r?\n/, "");
  const text = [
    "#!/bin/bash",
    `# 这是给「${project}」定制的双击安装脚本（项目已填好，双击即可运行）`,
    `# 来源作者：Yang YIZHU · 禁止商业售卖`,
    `RI_PROJECT="${project}"`,
    `RI_PORT="${port}"`,
    "",
    body,
  ].join("\n");
  return { text, filename: `repo-insight-安装-${analysis.repo}.command` };
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
  el("tabBeginner").addEventListener("click", () => showPane("beginner"));
  el("tabLocal").addEventListener("click", () => showPane("local"));

  // 方案 C：新手
  el("osMac").addEventListener("click", () => {
    os = "mac";
    renderOsHint();
    refreshBeginner();
  });
  el("osWin").addEventListener("click", () => {
    os = "win";
    renderOsHint();
    refreshBeginner();
  });
  el("beginnerGate").addEventListener("change", () => beginnerButtonsEnabled(el("beginnerGate").checked));
  el("copyOneLiner").addEventListener("click", async () => {
    const ok = await copy(el("oneLinerBox").value);
    window.alert(ok ? "已经复制好了！\n\n接下来：打开终端（Mac：Command+空格 搜「终端」／Windows：Win 键搜 PowerShell），粘贴进去按回车即可。" : "复制失败，请手动选中文本框里的内容复制");
  });
  el("downloadBeginnerMac").addEventListener("click", () => downloadTailored("mac"));
  el("downloadBeginnerWin").addEventListener("click", () => downloadTailored("win"));
  el("buildBeginnerBtn").addEventListener("click", () => build("beginner"));

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
