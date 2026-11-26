import { LegalDocument } from "@/components/LegalDocument";
import { loadLegalDocument, type LegalSlug } from "@/lib/legal";

export function LegalPage({ slug }: { slug: LegalSlug }) {
  const { documents, meta } = loadLegalDocument(slug);
  return <LegalDocument documents={documents} meta={meta} />;
}
