import fs from "node:fs";
import path from "node:path";
import { translations, type Locale } from "@/lib/i18n";

/**
 * Legal documents are published verbatim from content/legal/<slug>.<locale>.md.
 *
 * The parser deliberately supports only the Markdown the approved texts use:
 * one "# " title, "## " headings, top-level "- " bullets, paragraphs and **bold**.
 * Anything else throws at build time, so a new version of a text can never be
 * rendered silently wrong.
 */

export const LEGAL_SLUGS = ["terms", "privacy", "waiver", "informed-consent", "marketing-consent"] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export type LegalInline = { text: string; bold: boolean };
export type LegalBlock =
  | { type: "h2"; content: LegalInline[] }
  | { type: "p"; content: LegalInline[] }
  | { type: "ul"; items: LegalInline[][] };
export type LegalDocumentData = { title: string; blocks: LegalBlock[] };

const LOCALES: Locale[] = ["ru", "en"];

function fail(file: string, lineNo: number, message: string): never {
  throw new Error(`[legal] ${file}:${lineNo}: ${message}`);
}

function parseInline(text: string, file: string, lineNo: number): LegalInline[] {
  const parts = text.split("**");
  if (parts.length % 2 === 0) fail(file, lineNo, "unmatched ** (bold marker)");

  const runs: LegalInline[] = [];
  parts.forEach((part, index) => {
    if (part.length === 0) return;
    runs.push({ text: part, bold: index % 2 === 1 });
  });
  return runs;
}

const UNSUPPORTED = [
  { re: /^#{3,}\s/, what: "heading level 3+" },
  { re: /^\s+\S/, what: "indented line (nested list or code block)" },
  { re: /^\d+[.)]\s/, what: "numbered list" },
  { re: /^[*+]\s/, what: "'*' or '+' bullet" },
  { re: /^(>|\||```|~~~|---|\*\*\*|___)/, what: "quote, table, code fence or horizontal rule" },
  { re: /<[a-zA-Z/!]/, what: "raw HTML" },
  { re: /\]\(|`|\\/, what: "link, inline code or backslash escape" },
  { re: /(^|[^*])\*([^*]|$)/, what: "single '*' (italic)" },
  { re: /(^|[^\p{L}\p{N}])_|_($|[^\p{L}\p{N}])/u, what: "'_' emphasis" },
];

export function parseLegalMarkdown(source: string, file: string): LegalDocumentData {
  const lines = source.split(/\r?\n/);
  let title: string | null = null;
  const blocks: LegalBlock[] = [];
  let paragraph: { lineNo: number; text: string } | null = null;
  let list: LegalInline[][] | null = null;

  const flush = () => {
    if (paragraph) {
      blocks.push({ type: "p", content: parseInline(paragraph.text, file, paragraph.lineNo) });
      paragraph = null;
    }
    if (list) {
      blocks.push({ type: "ul", items: list });
      list = null;
    }
  };

  for (const [index, line] of lines.entries()) {
    const lineNo = index + 1;

    if (line.trim() === "") {
      flush();
      continue;
    }

    for (const rule of UNSUPPORTED) {
      if (rule.re.test(line)) fail(file, lineNo, `unsupported Markdown: ${rule.what}`);
    }

    if (line.startsWith("# ")) {
      if (title !== null) fail(file, lineNo, "second '# ' title");
      if (blocks.length > 0 || paragraph || list) fail(file, lineNo, "'# ' title must come first");
      title = line.slice(2);
      continue;
    }

    if (line.startsWith("## ")) {
      flush();
      blocks.push({ type: "h2", content: parseInline(line.slice(3), file, lineNo) });
      continue;
    }

    if (line.startsWith("- ")) {
      if (paragraph) fail(file, lineNo, "bullet directly after a paragraph line (needs a blank line)");
      list ??= [];
      list.push(parseInline(line.slice(2), file, lineNo));
      continue;
    }

    if (list) fail(file, lineNo, "paragraph text directly after a bullet (lazy continuation is not supported)");
    if (paragraph) fail(file, lineNo, "soft line break inside a paragraph is not supported");
    paragraph = { lineNo, text: line };
  }

  flush();

  if (title === null) fail(file, 1, "missing '# ' title");
  return { title, blocks };
}

const contentDir = path.join(process.cwd(), "content", "legal");

export function loadLegalDocument(slug: LegalSlug): Record<Locale, LegalDocumentData> {
  const result = {} as Record<Locale, LegalDocumentData>;

  for (const locale of LOCALES) {
    const file = `${slug}.${locale}.md`;
    const doc = parseLegalMarkdown(fs.readFileSync(path.join(contentDir, file), "utf8"), file);

    const footerTitle = translations[locale].footer.legal.find((link) => link.href === `/${slug}`)?.title;
    if (footerTitle !== doc.title) {
      throw new Error(
        `[legal] ${file}: title "${doc.title}" does not match footer label "${footerTitle}" in lib/i18n.ts`,
      );
    }

    result[locale] = doc;
  }

  return result;
}

export function legalPageTitle(slug: LegalSlug): string {
  return `${loadLegalDocument(slug).en.title} | Pilates Space`;
}
