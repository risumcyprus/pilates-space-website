import fs from "node:fs";
import path from "node:path";
import { translations, type Locale } from "@/lib/i18n";

/**
 * Legal documents are published verbatim from content/legal/<slug>.<locale>.md.
 * Each file starts with a front-matter block (version and published date, set by
 * hand; see parseLegalFrontMatter), which is stripped before the text is parsed.
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

/** Version and publication date, set by hand in each file's front matter. */
export type LegalMeta = { version: number; published: string };

const FRONT_MATTER = /^---\nversion: ([1-9]\d*)\npublished: (\d{4})-(\d{2})-(\d{2})\n---\n\n/;

/**
 * Every legal file starts with exactly:
 *
 *   ---
 *   version: 1
 *   published: 2026-11-27
 *   ---
 *   (blank line)
 *
 * Returns the values and the document text after the block.
 */
export function parseLegalFrontMatter(source: string, file: string): { meta: LegalMeta; body: string } {
  const match = source.match(FRONT_MATTER);
  if (!match) {
    throw new Error(
      `[legal] ${file}: missing or malformed front matter. The file must start with exactly:\n` +
        "---\nversion: <number>\npublished: <YYYY-MM-DD>\n---\n(blank line)",
    );
  }
  const [block, version, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const published = `${year}-${month}-${day}`;
  if (date.toISOString().slice(0, 10) !== published) {
    throw new Error(`[legal] ${file}: published "${published}" is not a valid date`);
  }
  return { meta: { version: Number(version), published }, body: source.slice(block.length) };
}

const contentDir = path.join(process.cwd(), "content", "legal");

export function loadLegalDocument(slug: LegalSlug): { documents: Record<Locale, LegalDocumentData>; meta: LegalMeta } {
  const documents = {} as Record<Locale, LegalDocumentData>;
  const metas = {} as Record<Locale, LegalMeta>;

  for (const locale of LOCALES) {
    const file = `${slug}.${locale}.md`;
    const { meta, body: source } = parseLegalFrontMatter(
      fs.readFileSync(path.join(contentDir, file), "utf8").replace(/\r\n/g, "\n"),
      file,
    );
    metas[locale] = meta;
    const doc = withLinks(parseLegalMarkdown(source, file), locale, slug);

    // The published text must be exactly the source text (after the front matter).
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

    documents[locale] = doc;
  }

  // The English and Russian files of a document must carry the same version and date.
  const { en, ru } = metas;
  if (en.version !== ru.version || en.published !== ru.published) {
    throw new Error(
      `[legal] ${slug}: front matter differs between ${slug}.en.md (version ${en.version}, ${en.published}) ` +
        `and ${slug}.ru.md (version ${ru.version}, ${ru.published})`,
    );
  }

  return { documents, meta: en };
}

export function legalPageTitle(slug: LegalSlug): string {
  return `${loadLegalDocument(slug).documents.en.title} | Pilates Space`;
}
