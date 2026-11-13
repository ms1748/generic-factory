// @ts-nocheck -- ported from the old dashboard: everything is escaped first, then a few tags are added back.
// A small, safe Markdown renderer for issue descriptions: everything is escaped first, then a few
// constructs are turned back into tags (headings, bold, italics, code, links, lists, quotes, tables
// as plain rows). Only https links are kept; nothing from the text can add attributes or scripts.

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function inline(s, repo) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])#(\d+)\b/g, (_, pre, n) => `${pre}<a href="https://github.com/${repo}/issues/${n}" target="_blank" rel="noopener">#${n}</a>`);
}

export function md(text: string, repo: string): string {
  const lines = esc(text.replace(/\r/g, "").replace(/<!--[\s\S]*?-->/g, "")).split("\n");
  const out = [];
  let list = null;
  let code = false;
  let para = [];
  let tableOpen = false;
  const closeTable = () => {
    if (tableOpen) out.push("</table></div>");
    tableOpen = false;
  };
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "), repo)}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("```")) {
      flushPara();
      flushList();
      out.push(code ? "</code></pre>" : "<pre><code>");
      code = !code;
      continue;
    }
    if (code) {
      out.push(raw + "\n");
      continue;
    }
    // <details><summary>X</summary> folds (trial reports): a heading for X, the tags dropped.
    const fold = line.match(/^&lt;details&gt;\s*(?:&lt;summary&gt;(.*?)&lt;\/summary&gt;)?\s*$|^&lt;\/details&gt;$/);
    if (fold) {
      flushPara();
      flushList();
      closeTable();
      if (fold[1]) out.push(`<h4>${inline(fold[1], repo)}</h4>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const li = line.match(/^\s*(?:[-*]|\d+\.)\s+(?:\[( |x)\]\s+)?(.*)$/);
    if (!line.trim()) {
      flushPara();
      flushList();
      closeTable();
    } else if (h) {
      flushPara();
      flushList();
      out.push(`<h4>${inline(h[2], repo)}</h4>`);
    } else if (li) {
      flushPara();
      const kind = /^\s*\d+\./.test(line) ? "ol" : "ul";
      if (list !== kind) {
        flushList();
        out.push(`<${kind}>`);
        list = kind;
      }
      const box = li[1] === undefined ? "" : li[1] === "x" ? "☑ " : "☐ ";
      out.push(`<li>${box}${inline(li[2], repo)}</li>`);
    } else if (line.startsWith("&gt;")) {
      flushPara();
      flushList();
      out.push(`<blockquote>${inline(line.replace(/^&gt;\s?/, ""), repo)}</blockquote>`);
    } else if (line.startsWith("|")) {
      flushPara();
      flushList();
      if (/^\|[\s:|-]+\|$/.test(line)) continue; // the separator row
      const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim(), repo));
      const head = out.at(-1) !== "</tr>" && !String(out.at(-1)).startsWith("<tr>");
      if (head) out.push('<div class="tbl"><table>');
      out.push("<tr>" + cells.map((c) => (head ? `<th>${c}</th>` : `<td>${c}</td>`)).join("") + "</tr>");
      tableOpen = true;
    } else {
      closeTable();
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  closeTable();
  if (code) out.push("</code></pre>");
  return out.join("\n");
}
