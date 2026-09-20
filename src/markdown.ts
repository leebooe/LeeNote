import { marked } from "marked";

marked.setOptions({
  breaks: true,
  gfm: true,
});

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderMarkdown(source: string): string {
  const html = marked.parse(source) as string;
  const template = document.createElement("template");
  template.innerHTML = html;

  template.content.querySelectorAll("script, iframe, object, embed, style").forEach((node) => node.remove());
  template.content.querySelectorAll("*").forEach((node) => {
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (
        name.startsWith("on") ||
        name === "style" ||
        name === "srcdoc" ||
        value.startsWith("javascript:") ||
        value.startsWith("vbscript:") ||
        value.startsWith("data:text/html")
      ) {
        node.removeAttribute(attr.name);
      }
    }
    if (node instanceof HTMLAnchorElement) {
      node.target = "_blank";
      node.rel = "noreferrer noopener";
    }
  });

  return template.innerHTML || `<p>${escapeHtml(source)}</p>`;
}
