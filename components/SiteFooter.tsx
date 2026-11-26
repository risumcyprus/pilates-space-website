"use client";

import { Instagram } from "lucide-react";
import Link from "next/link";
import { useI18n } from "@/components/LanguageProvider";
import { instagramHref } from "@/lib/home-page";

export function SiteFooter() {
  const { t } = useI18n();

  return (
    <footer className="border-t border-[#e5dbcc] bg-[#f4eee5]">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 text-xs capitalize tracking-[0.14em] text-zinc-500 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <span className="whitespace-nowrap">{t.footer.company}</span>
          <span className="text-[0.65rem] text-zinc-400">{t.footer.registration}</span>
        </div>
        <ul className="flex flex-col gap-2">
          {t.footer.legal.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="hover:text-zinc-800">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 md:items-end">
          <a
            href={instagramHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 hover:text-zinc-800"
            aria-label="Instagram"
          >
            <Instagram className="h-4 w-4" />
            <span>Instagram</span>
          </a>
          <span>{t.footer.copy}</span>
        </div>
      </div>
    </footer>
  );
}
