// Minimal Markdown → HTML for the guide (headings, paragraphs, lists, tables, code, images, bold, code spans, links).
import fs from "node:fs";
import path from "node:path";
const [src, out] = process.argv.slice(2);
const dir = path.dirname(path.resolve(src));
const md = fs.readFileSync(src, "utf8").split("\n");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slug = (s) => s.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s).replace(/\\\|/g, "|");
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, a, u) => {
    const data = fs.readFileSync(path.join(dir, u)).toString("base64");
    return `<img alt="${a}" src="data:image/png;base64,${data}">`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(https?:\/\/[^\s<)]+)(?![^<]*<\/a>)/g, (m) => m);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
}
const html = [];
let i = 0;
while (i < md.length) {
  const line = md[i];
  if (line.startsWith("```")) {
    const buf = []; i++;
    while (i < md.length && !md[i].startsWith("```")) buf.push(md[i++]);
    i++; html.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`); continue;
  }
  const h = /^(#{1,4}) (.*)/.exec(line);
  if (h) { html.push(`<h${h[1].length} id="${slug(h[2])}">${inline(h[2])}</h${h[1].length}>`); i++; continue; }
  if (line.startsWith("|")) {
    const rows = [];
    while (i < md.length && md[i].startsWith("|")) rows.push(md[i++]);
    const cells = (r) => r.replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
    html.push("<table><thead><tr>" + cells(rows[0]).map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>" +
      rows.slice(2).map((r) => "<tr>" + cells(r).map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") + "</tbody></table>");
    continue;
  }
  if (/^(\d+\.|-) /.test(line)) {
    const ordered = /^\d+\./.test(line);
    const items = [];
    while (i < md.length && (/^(\d+\.|-) /.test(md[i]) || /^ {2,}- /.test(md[i]))) {
      if (/^ {2,}- /.test(md[i])) items.at(-1).sub.push(md[i].replace(/^ +- /, ""));
      else items.push({ text: md[i].replace(/^(\d+\.|-) /, ""), sub: [] });
      i++;
    }
    const tag = ordered ? "ol" : "ul";
    html.push(`<${tag}>` + items.map((it) => `<li>${inline(it.text)}${it.sub.length ? "<ul>" + it.sub.map((s) => `<li>${inline(s)}</li>`).join("") + "</ul>" : ""}</li>`).join("") + `</${tag}>`);
    continue;
  }
  if (!line.trim()) { i++; continue; }
  const buf = [];
  while (i < md.length && md[i].trim() && !/^(#|\||```|\d+\. |- )/.test(md[i])) buf.push(md[i++]);
  html.push(`<p>${inline(buf.join(" "))}</p>`);
}
const css = `
@page { size: A4; margin: 16mm 14mm 18mm; }
body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1b1433; font-size: 10.5pt; line-height: 1.5; }
h1 { font-size: 22pt; margin: 0 0 4px; color: #7c3aed; padding-bottom: 6px; border-bottom: 4px solid; border-image: linear-gradient(90deg,#7c3aed,#ec4899 55%,#06b6d4) 1; }
h1 + p { color: #6b6488; margin-top: 0; }
h2 { font-size: 15pt; color: #7c3aed; border-bottom: 2px solid #ece6ff; padding-bottom: 4px; margin: 26px 0 8px; break-after: avoid; }
h3 { font-size: 11.5pt; margin: 16px 0 6px; break-after: avoid; }
table { border-collapse: collapse; width: 100%; margin: 8px 0 12px; font-size: 9pt; break-inside: auto; }
th, td { border: 1px solid #e2dbf7; padding: 5px 7px; text-align: left; vertical-align: top; }
th { background: #f4f0ff; }
tr { break-inside: avoid; }
code { font-family: ui-monospace, Menlo, monospace; font-size: 8.8pt; background: #f4f0ff; padding: 1px 4px; border-radius: 4px; }
pre { background: #f7f5fc; border: 1px solid #e2dbf7; border-radius: 6px; padding: 8px 10px; white-space: pre-wrap; word-break: break-all; break-inside: avoid; }
pre code { background: none; padding: 0; }
img { width: 100%; border: 1px solid #ece6ff; border-radius: 8px; margin: 6px 0; break-inside: avoid; }
a { color: #7c3aed; text-decoration: none; }
li { margin: 2px 0; }
h2#contents + ol { columns: 2; }
`;
fs.writeFileSync(out, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>TelemuneSmartAi — Product & Technical Guide</title><style>${css}</style></head><body>${html.join("\n")}</body></html>`);
console.log("ok", html.length, "blocks");
