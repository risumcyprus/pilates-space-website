import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { legalPageTitle } from "@/lib/legal";

export const metadata: Metadata = { title: legalPageTitle("waiver") };

export default function Page() {
  return <LegalPage slug="waiver" />;
}
