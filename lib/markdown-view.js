/*!
 * Repo Insight · 开源项目解读器（Chrome 扩展 / Manifest V3）
 * 来源作者：Yang YIZHU  (https://github.com/repo-lens)
 * 禁止商业售卖 —— 完整条款见仓库根目录 LICENSE 与 NOTICE.md
 * 任何再发布都必须完整保留本段署名信息，不得删除、隐藏或替换。
 */
// 轻量 Markdown 渲染器：解析成结构块，再用 DOM API + textContent 构建节点。
// 全程不使用 innerHTML，因此模型输出中的任何 HTML/脚本都只会被当成纯文本。

const FENCE_RE = /^\s*(?:```|~~~)\s*(\S*)\s*$/;
const CLOSE_FENCE_RE = /^\s*(?:```|~~~)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?/;
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const LIST_RE = /^\s*(?:[-*+]|\d+\.)\s+/;
const ORDERED_RE = /^\s*\d+\.\s+/;

function isTableSeparator(line) {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");
}

function isTableRow(line) {
  return line.trim().startsWith("|") && line.trim().endsWith("|");
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

function dedent(lines) {
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join("\n");
}

function startsBlock(line, next) {
  return (
    HEADING_RE.test(line) ||
    FENCE_RE.test(line) ||
    QUOTE_RE.test(line) ||
    HR_RE.test(line) ||
    LIST_RE.test(line) ||
    (isTableRow(line) && !!next && isTableSeparator(next))
  );
}

/**
 * 把 Markdown 文本解析为结构块数组（纯函数，不依赖 DOM，可单测）。
 * 支持：# 标题、> 引用、- / 1. 列表、``` 代码块、| 表格、--- 分隔线、段落。
 */
export function parseMarkdown(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = line.match(FENCE_RE);
    if (fence) {
      const lang = fence[1] || "";
      const body = [];
      i++;
      while (i < lines.length && !CLOSE_FENCE_RE.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // 跳过结束围栏
      blocks.push({ type: "code", lang, text: dedent(body) });
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      i++;
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const quoted = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        quoted.push(lines[i].replace(QUOTE_RE, ""));
        i++;
      }
      blocks.push({ type: "quote", lines: quoted });
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    if (LIST_RE.test(line)) {
      const ordered = ORDERED_RE.test(line);
      const items = [];
      while (i < lines.length && LIST_RE.test(lines[i]) && ORDERED_RE.test(lines[i]) === ordered) {
        items.push(lines[i].replace(LIST_RE, ""));
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const paragraph = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) {
      paragraph.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

const INLINE_RE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(https?:\/\/[^\s<>()「」，。]+)/g;

/** 行内元素：`代码`、**加粗**、裸链接。文本一律走 textContent */
export function appendInline(parent, text, doc) {
  const source = String(text ?? "");
  let last = 0;
  let match;
  INLINE_RE.lastIndex = 0;

  while ((match = INLINE_RE.exec(source))) {
    if (match.index > last) parent.appendChild(doc.createTextNode(source.slice(last, match.index)));
    const token = match[0];
    if (token.startsWith("`")) {
      const code = doc.createElement("code");
      code.textContent = token.slice(1, -1);
      parent.appendChild(code);
    } else if (token.startsWith("**")) {
      const strong = doc.createElement("strong");
      strong.textContent = token.slice(2, -2);
      parent.appendChild(strong);
    } else {
      const link = doc.createElement("a");
      link.href = token;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = token;
      parent.appendChild(link);
    }
    last = match.index + token.length;
  }
  if (last < source.length) parent.appendChild(doc.createTextNode(source.slice(last)));
}

function buildTable(block, doc) {
  const table = doc.createElement("table");
  const thead = doc.createElement("thead");
  const headRow = doc.createElement("tr");
  for (const cell of block.header) {
    const th = doc.createElement("th");
    appendInline(th, cell, doc);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = doc.createElement("tbody");
  for (const row of block.rows) {
    const tr = doc.createElement("tr");
    for (let c = 0; c < block.header.length; c++) {
      const cell = doc.createElement("td");
      appendInline(cell, row[c] ?? "", doc);
      tr.appendChild(cell);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

/** 结构块 → DOM 片段 */
export function renderBlocks(blocks, doc = globalThis.document) {
  const frag = doc.createDocumentFragment();

  for (const block of blocks) {
    switch (block.type) {
      case "heading": {
        const level = Math.min(block.level, 3);
        const h = doc.createElement(`h${level}`);
        appendInline(h, block.text, doc);
        frag.appendChild(h);
        break;
      }
      case "paragraph": {
        const p = doc.createElement("p");
        appendInline(p, block.text, doc);
        frag.appendChild(p);
        break;
      }
      case "quote": {
        const quote = doc.createElement("blockquote");
        for (const line of block.lines) {
          if (!line.trim()) continue;
          const p = doc.createElement("p");
          appendInline(p, line, doc);
          quote.appendChild(p);
        }
        frag.appendChild(quote);
        break;
      }
      case "list": {
        const list = doc.createElement(block.ordered ? "ol" : "ul");
        for (const item of block.items) {
          const li = doc.createElement("li");
          appendInline(li, item, doc);
          list.appendChild(li);
        }
        frag.appendChild(list);
        break;
      }
      case "code": {
        const pre = doc.createElement("pre");
        const code = doc.createElement("code");
        code.textContent = block.text;
        pre.appendChild(code);
        frag.appendChild(pre);
        break;
      }
      case "table":
        frag.appendChild(buildTable(block, doc));
        break;
      case "hr":
        frag.appendChild(doc.createElement("hr"));
        break;
      default:
        break;
    }
  }

  return frag;
}

export function renderMarkdown(markdown, doc = globalThis.document) {
  return renderBlocks(parseMarkdown(markdown), doc);
}
