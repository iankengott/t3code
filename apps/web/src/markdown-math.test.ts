import rehypeStringify from "rehype-stringify";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified, type Plugin } from "unified";
import type { Root } from "mdast";
import { describe, expect, it } from "vite-plus/test";

import { remarkNormalizeListItemIndentation } from "./markdown-list-indentation";
import {
  MARKDOWN_MATH_CODE_CLASS_NAMES,
  normalizeLatexMathDelimiters,
  rehypeStripKatexErrorTitle,
  remarkPromoteBracketDisplayMath,
} from "./markdown-math";

const MATH_SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []).filter(
        (attribute) => !Array.isArray(attribute) || attribute[0] !== "className",
      ),
      ["className", /^language-./, ...MARKDOWN_MATH_CODE_CLASS_NAMES],
    ],
  },
} satisfies Parameters<typeof rehypeSanitize>[0];

function renderMarkdown(source: string, sanitize = false): string {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath, { singleDollarTextMath: false })
    .use(remarkPromoteBracketDisplayMath, { source })
    .use(remarkNormalizeListItemIndentation as Plugin<[], Root>)
    .use(remarkRehype);
  if (sanitize) processor.use(rehypeSanitize, MATH_SANITIZE_SCHEMA);
  processor
    .use(rehypeKatex, { output: "htmlAndMathml", errorColor: "var(--destructive)", trust: false })
    .use(rehypeStripKatexErrorTitle)
    .use(rehypeStringify);
  const markdown = normalizeLatexMathDelimiters(source);
  return String(processor.processSync(markdown));
}

describe("normalizeLatexMathDelimiters", () => {
  it.each([
    String.raw`\sum_{i=1}^{n} x_i`,
    String.raw`\int_0^\infty e^{-x^2}\,dx`,
    String.raw`\begin{pmatrix}a & b \\ c & d\end{pmatrix}`,
    String.raw`\begin{aligned}K &= \tfrac12 mv^2 \\ p &= mv\end{aligned}`,
  ])("renders scientific notation: %s", (formula) => {
    const html = renderMarkdown(`\\[${formula}\\]`, true);
    expect(html).toContain('class="katex-display"');
    expect(html).not.toContain('class="katex-error"');
  });

  it("renders double-dollar display math", () => {
    const html = renderMarkdown(
      String.raw`$$
K=\frac{p^2}{2m}
$$`,
      true,
    );
    expect(html).toContain('class="katex-display"');
    expect(html).toContain("<mfrac>");
  });

  it("renders normalized delimiters through KaTeX", () => {
    const html = renderMarkdown("Euler: \\(e^{i\\pi} + 1 = 0\\)");
    expect(html).toContain('class="katex"');
    expect(html).toContain("mathml");
  });

  it("renders same-line bracket delimiters as display math", () => {
    const html = renderMarkdown("Before \\[E=mc^2\\] after", true);
    expect(html).toContain('class="katex-display"');
  });

  it("uses the theme error color without a native parse-error title", () => {
    const html = renderMarkdown("Broken: \\(x^\\)", true);
    expect(html).toContain('class="katex-error"');
    expect(html).toContain('style="color:var(--destructive)"');
    expect(html).not.toContain("title=");
  });

  it("keeps parenthesized delimiters inline", () => {
    const html = renderMarkdown("Before \\(E=mc^2\\) after");
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('class="katex-display"');
  });

  it("leaves ordinary dollar amounts as text", () => {
    const html = renderMarkdown("Costs rose from $20,000 to USD$30,000");
    expect(html).not.toContain('class="katex"');
    expect(html).toContain("$20,000 to USD$30,000");
  });

  it("rewrites paired inline and display delimiters", () => {
    expect(normalizeLatexMathDelimiters("inline \\(a+b\\)\n\n\\[\nE=mc^2\n\\]")).toBe(
      "inline $$a+b$$\n\n$$\nE=mc^2\n$$",
    );
  });

  it("preserves source length and task-list offsets", () => {
    const source = "Display \\[a+b\\]\n\n- [ ] task with \\(c+d\\) inline";
    const normalized = normalizeLatexMathDelimiters(source);
    expect(normalized).toHaveLength(source.length);
    expect(normalized.indexOf("[ ]")).toBe(source.indexOf("[ ]"));
  });

  it("leaves unmatched and escaped delimiters unchanged", () => {
    expect(
      normalizeLatexMathDelimiters("\\(open only and a stray \\] plus \\\\(literal\\\\)"),
    ).toBe("\\(open only and a stray \\] plus \\\\(literal\\\\)");
  });

  it("recovers valid pairs after unmatched or mismatched delimiters", () => {
    const cases = [
      ["Mention \\( literally, then \\(a+b\\)", "Mention \\( literally, then $$a+b$$"],
      ["Mention \\[ literally, then \\(a+b\\)", "Mention \\[ literally, then $$a+b$$"],
      ["Mention \\( literally, then \\[a+b\\]", "Mention \\( literally, then $$a+b$$"],
      ["Mismatched \\( text \\] then \\[a+b\\]", "Mismatched \\( text \\] then $$a+b$$"],
    ] as const;

    for (const [source, expected] of cases) {
      expect(normalizeLatexMathDelimiters(source)).toBe(expected);
    }
  });

  it("continues to rewrite adjacent valid pairs", () => {
    expect(normalizeLatexMathDelimiters("\\(a\\) and \\[b\\]")).toBe("$$a$$ and $$b$$");
  });

  it("renders inline math recovered from over-indented list content", () => {
    const source = "-       formula \\(a+b\\)";
    expect(normalizeLatexMathDelimiters(source)).toBe(source);
    expect(renderMarkdown(source)).toContain('class="katex"');
  });

  it("renders display math recovered from over-indented list content", () => {
    expect(renderMarkdown("-       formula \\[a+b\\]", true)).toContain('class="katex-display"');
  });

  it("preserves markdown structure when recovering over-indented list content", () => {
    const html = renderMarkdown(
      '-       `\\(code\\)` [link](https://example.com/\\(path\\)) <https://example.com/\\(path\\)> <span title="\\(attr\\)">html</span> and \\(math\\)',
    );
    expect(html.match(/class="katex"/g)).toHaveLength(1);
    expect(html).toContain("\\(code\\)");
    expect(html).toContain("https://example.com/%5C(path%5C)");
    expect(html).toContain("html and");
  });

  it("scans long backslash runs without repeatedly rescanning the prefix", () => {
    const prefix = "\\".repeat(100_000);
    expect(normalizeLatexMathDelimiters(`${prefix} then \\(a+b\\)`)).toBe(`${prefix} then $$a+b$$`);
  });

  it("leaves inline, fenced, quoted fenced, and indented code unchanged", () => {
    const source = [
      "`\\(inline\\)`",
      "```md",
      "\\(fenced\\)",
      "```",
      "> ~~~",
      "> \\(quoted\\)",
      "> ~~~",
      "    \\(indented\\)",
      "prose \\(math\\)",
    ].join("\n");
    expect(normalizeLatexMathDelimiters(source)).toBe(
      source.replace("prose \\(math\\)", () => "prose $$math$$"),
    );
  });

  it("leaves link destinations, autolinks, and HTML attributes unchanged", () => {
    const source = [
      "[file](file:///tmp/foo\\(bar\\).ts)",
      "<https://example.com/foo\\(bar\\)>",
      '<span title="\\(attribute\\)">text</span>',
      "[label \\(x\\)](https://example.com)",
    ].join("\n");
    expect(normalizeLatexMathDelimiters(source)).toBe(
      source.replace("label \\(x\\)", () => "label $$x$$"),
    );
  });

  it("does not pair delimiters across separate text nodes", () => {
    const source = "\\(open **bold** close\\)";
    expect(normalizeLatexMathDelimiters(source)).toBe(source);
  });

  it("leaves unrelated escapes and dollar amounts unchanged", () => {
    const source = "just \\* escapes, \\_underscores\\_ and $5 dollars";
    expect(normalizeLatexMathDelimiters(source)).toBe(source);
  });
});
