"use client";

import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { SiteFooter } from "@/components/SiteFooter";
import { useI18n } from "@/components/LanguageProvider";
import type { Locale } from "@/lib/i18n";
import type { LegalDocumentData, LegalInline, LegalVersion } from "@/lib/legal";

const linkClass =
  "underline decoration-zinc-300 underline-offset-2 transition-colors hover:text-zinc-900 hover:decoration-zinc-900";

function Inline({ content }: { content: LegalInline[] }) {
  return (
    <>
      {content.map((run, index) => {
        const text = run.href ? (
          <Link href={run.href} className={linkClass}>
            {run.text}
          </Link>
        ) : (
          run.text
        );

        return run.bold ? (
          <strong key={index} className="font-semibold text-zinc-900">
            {text}
          </strong>
        ) : (
          <span key={index}>{text}</span>
        );
      })}
    </>
  );
}

export function LegalDocument({
  documents,
  version,
}: {
  documents: Record<Locale, LegalDocumentData>;
  version: LegalVersion;
}) {
  const { locale, t } = useI18n();
  const doc = documents[locale];
  const [year, month, day] = version.date.split("-").map(Number);
  const updated = `${day} ${t.legalMeta.months[month - 1]} ${year}`;

  return (
    <div className="bg-[#f7f4ef] text-zinc-900 min-h-screen">
      <PublicNav />

      <main className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
        <h1 lang={locale} className="text-4xl sm:text-5xl tracking-tight">
          {doc.title}
        </h1>
        <p lang={locale} className="mt-3 text-sm text-zinc-500">
          {t.legalMeta.version} {version.version} · {t.legalMeta.updated} {updated}
        </p>

        <article
          lang={locale}
          className="mt-8 border border-zinc-200 bg-white p-5 sm:p-6 text-sm text-zinc-700"
        >
          {doc.blocks.map((block, index) => {
            if (block.type === "h2") {
              return (
                <h2 key={index} className="mt-6 first:mt-0 text-base font-semibold text-zinc-900">
                  <Inline content={block.content} />
                </h2>
              );
            }

            if (block.type === "ul") {
              return (
                <ul key={index} className="mt-3 list-disc space-y-1.5 pl-5 leading-relaxed">
                  {block.items.map((item, itemIndex) => (
                    <li key={itemIndex}>
                      <Inline content={item} />
                    </li>
                  ))}
                </ul>
              );
            }

            return (
              <p key={index} className="mt-3 first:mt-0 leading-relaxed">
                <Inline content={block.content} />
              </p>
            );
          })}
        </article>
      </main>

      <SiteFooter />
    </div>
  );
}
