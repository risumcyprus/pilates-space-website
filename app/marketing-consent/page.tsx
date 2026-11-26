import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { legalPageTitle } from "@/lib/legal";

export const metadata: Metadata = { title: legalPageTitle("marketing-consent") };

export default function Page() {
  return <LegalPage slug="marketing-consent" />;
}
