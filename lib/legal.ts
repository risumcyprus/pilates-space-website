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
 *
 * Mentions of the other legal documents become links (LINK_PHRASES below). Links
 * are only added around existing words: loadLegalDocument() serialises the result
 * back to Markdown and throws unless it is byte-identical to the source file.
 */

export const LEGAL_SLUGS = ["terms", "privacy", "waiver", "informed-consent", "marketing-consent"] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export type LegalInline = { text: string; bold: boolean; href?: string };
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

/**
 * Exact phrases (as written in the texts, including Russian case forms) that link
 * to another document. Never applied to the title or "## " headings, and a
 * document never links to itself.
 */
const LINK_PHRASES: Record<Locale, { phrase: string; href: `/${LegalSlug}` }[]> = {
  en: [
    { phrase: "Terms & Conditions", href: "/terms" },
    { phrase: "Privacy Policy", href: "/privacy" },
    { phrase: "Liability Waiver", href: "/waiver" },
    { phrase: "Informed Consent", href: "/informed-consent" },
    { phrase: "Marketing Communications Consent", href: "/marketing-consent" },
  ],
  ru: [
    { phrase: "Условия обслуживания", href: "/terms" },
    { phrase: "Условиях обслуживания", href: "/terms" },
    { phrase: "Политикой конфиденциальности", href: "/privacy" },
    { phrase: "Политике конфиденциальности", href: "/privacy" },
    { phrase: "Отказ от ответственности", href: "/waiver" },
    { phrase: "Отказе от ответственности", href: "/waiver" },
    { phrase: "Отказом от ответственности", href: "/waiver" },
    { phrase: "Информированное согласие", href: "/informed-consent" },
    { phrase: "Информированного согласия", href: "/informed-consent" },
    { phrase: "Согласие на маркетинговые сообщения", href: "/marketing-consent" },
  ],
};

function linkMatcher(locale: Locale): RegExp {
  const alternatives = [...LINK_PHRASES[locale]]
    .sort((a, b) => b.phrase.length - a.phrase.length) // longest match wins
    .map(({ phrase }) => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // Whole phrases only: no letter or digit directly before or after.
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}])`, "gu");
}

function addLinks(runs: LegalInline[], locale: Locale, slug: LegalSlug): LegalInline[] {
  const matcher = linkMatcher(locale);
  const hrefFor = new Map(LINK_PHRASES[locale].map(({ phrase, href }) => [phrase, href]));

  return runs.flatMap((run) => {
    const out: LegalInline[] = [];
    let last = 0;
    for (const match of run.text.matchAll(matcher)) {
      const href = hrefFor.get(match[0]);
      if (!href || href === `/${slug}`) continue;
      const start = match.index;
      if (start > last) out.push({ text: run.text.slice(last, start), bold: run.bold });
      out.push({ text: match[0], bold: run.bold, href });
      last = start + match[0].length;
    }
    if (last < run.text.length) out.push({ text: run.text.slice(last), bold: run.bold });
    return out;
  });
}

function withLinks(doc: LegalDocumentData, locale: Locale, slug: LegalSlug): LegalDocumentData {
  return {
    title: doc.title,
    blocks: doc.blocks.map((block): LegalBlock => {
      if (block.type === "p") return { type: "p", content: addLinks(block.content, locale, slug) };
      if (block.type === "ul") return { type: "ul", items: block.items.map((item) => addLinks(item, locale, slug)) };
      return block; // headings are never linked
    }),
  };
}

/** Serialises a parsed document back to Markdown (links are ignored: they add no text). */
export function serializeLegalMarkdown(doc: LegalDocumentData): string {
  const inline = (runs: LegalInline[]) => {
    let out = "";
    let bold = false;
    for (const run of runs) {
      if (run.bold !== bold) {
        out += "**";
        bold = run.bold;
      }
      out += run.text;
    }
    return bold ? `${out}**` : out;
  };

  const parts = [`# ${doc.title}`];
  for (const block of doc.blocks) {
    if (block.type === "h2") parts.push(`## ${inline(block.content)}`);
    else if (block.type === "p") parts.push(inline(block.content));
    else parts.push(block.items.map((item) => `- ${inline(item)}`).join("\n"));
  }
  return parts.join("\n\n");
}

const contentDir = path.join(process.cwd(), "content", "legal");

export function loadLegalDocument(slug: LegalSlug): Record<Locale, LegalDocumentData> {
  const result = {} as Record<Locale, LegalDocumentData>;

  for (const locale of LOCALES) {
    const file = `${slug}.${locale}.md`;
    const source = fs.readFileSync(path.join(contentDir, file), "utf8").replace(/\r\n/g, "\n");
    const doc = withLinks(parseLegalMarkdown(source, file), locale, slug);

    // The published text must be exactly the source text.
    if (serializeLegalMarkdown(doc) !== source.replace(/\n$/, "")) {
      throw new Error(`[legal] ${file}: rendered text differs from the source file`);
    }

    // Every document must be in the footer. Russian footer labels are the document
    // titles; English footer labels are separate short names.
    const footerLabel = translations[locale].footer.legal.find((link) => link.href === `/${slug}`)?.label;
    if (!footerLabel) {
      throw new Error(`[legal] ${file}: no footer link for /${slug} in lib/i18n.ts (${locale})`);
    }
    if (locale === "ru" && footerLabel !== doc.title) {
      throw new Error(
        `[legal] ${file}: title "${doc.title}" does not match Russian footer label "${footerLabel}" in lib/i18n.ts`,
      );
    }

    result[locale] = doc;
  }

  return result;
}

/**
 * Version and "updated" date of a document (its .en.md and .ru.md together),
 * computed from Git by scripts/legal-versions.mjs before every build and dev run.
 */
export type LegalVersion = { version: number; date: string };

const versionsFile = path.join(process.cwd(), "lib", "legal-versions.generated.json");

export function loadLegalVersion(slug: LegalSlug): LegalVersion {
  if (!fs.existsSync(versionsFile)) {
    throw new Error(
      "[legal] lib/legal-versions.generated.json is missing. It is written by scripts/legal-versions.mjs, " +
        "which runs automatically before `npm run build` and `npm run dev`.",
    );
  }
  const versions = JSON.parse(fs.readFileSync(versionsFile, "utf8")) as Partial<Record<LegalSlug, LegalVersion>>;
  const entry = versions[slug];
  if (!entry || !Number.isInteger(entry.version) || entry.version < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
    throw new Error(`[legal] lib/legal-versions.generated.json has no valid entry for "${slug}"`);
  }
  return entry;
}

export function legalPageTitle(slug: LegalSlug): string {
  return `${loadLegalDocument(slug).en.title} | Pilates Space`;
}
