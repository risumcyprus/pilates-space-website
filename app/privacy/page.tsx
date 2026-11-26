import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { legalPageTitle } from "@/lib/legal";

export const metadata: Metadata = { title: legalPageTitle("privacy") };

export default function Page() {
  return <LegalPage slug="privacy" />;
}
