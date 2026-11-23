import { LegalDocument } from "@/components/LegalDocument";
import { loadLegalDocument, type LegalSlug } from "@/lib/legal";

export function LegalPage({ slug }: { slug: LegalSlug }) {
  return <LegalDocument documents={loadLegalDocument(slug)} />;
}
