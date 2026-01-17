import {
  buildGlossaryReferences,
  serializeReferences,
} from "@/lib/glossary-references";
import { GlossaryList } from "./GlossaryList";

export function GlossaryListServer() {
  const references = buildGlossaryReferences();
  const serializedRefs = serializeReferences(references);

  return <GlossaryList references={serializedRefs} />;
}
