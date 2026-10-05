// @vitest-environment jsdom
import rehypeStringify from "rehype-stringify";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it } from "vite-plus/test";
import {
  chatMarkdownClipboardPayload,
  serializeRenderedMarkdownFragment,
} from "./markdown-clipboard";
import { normalizeLatexMathDelimiters } from "./markdown-math";

function renderedFragment(source: string): HTMLElement {
  const processor = unified()
    .use(remarkParse)
    .use(remarkMath, { singleDollarTextMath: false })
    .use(remarkRehype)
    .use(rehypeKatex)
    .use(rehypeStringify);
  const container = document.createElement("div");
  container.innerHTML = String(processor.processSync(normalizeLatexMathDelimiters(source)));
  return container;
}

describe("math clipboard", () => {
  it("copies inline math once as reusable LaTeX", () => {
    const source = String.raw`Energy is \(K=\frac{p^2}{2m}\).`;
    expect(serializeRenderedMarkdownFragment(renderedFragment(source))).toBe(source);
  });

  it("copies display math with its display delimiters", () => {
    const source = String.raw`\[
K=\frac{p^2}{2m}
\]`;
    expect(serializeRenderedMarkdownFragment(renderedFragment(source))).toBe(source);
  });

  it("copies one visual equation for rich paste while retaining the original accessible math", () => {
    const source = String.raw`Energy is \(K=\frac{p^2}{2m}\).`;
    const container = renderedFragment(source);
    document.body.appendChild(container);
    const range = document.createRange();
    range.selectNodeContents(container);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    try {
      const payload = chatMarkdownClipboardPayload(selection);
      expect(payload?.text).toBe(source);
      const copied = document.createElement("div");
      copied.innerHTML = payload?.html ?? "";
      expect(copied.querySelectorAll(".katex-html")).toHaveLength(1);
      expect(copied.querySelector(".katex-mathml")).toBeNull();
      expect(container.querySelector("annotation")?.textContent).toBe(String.raw`K=\frac{p^2}{2m}`);
    } finally {
      selection.removeAllRanges();
      container.remove();
    }
  });

  it("retains invalid math source instead of dropping it from copied text", () => {
    expect(serializeRenderedMarkdownFragment(renderedFragment(String.raw`Broken: \(x^\)`))).toBe(
      "Broken: x^",
    );
  });
});
