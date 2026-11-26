import { cookies } from "next/headers";
import { defaultLocale, localeCookieKey, type Locale } from "@/lib/i18n";

function isLocale(value: string | undefined | null): value is Locale {
  return value === "ru" || value === "en";
}

// A saved choice (cookie) wins; otherwise English, regardless of Accept-Language.
export async function resolveRequestLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(localeCookieKey)?.value;

  if (isLocale(cookieLocale)) {
    return cookieLocale;
  }

  return defaultLocale;
}
