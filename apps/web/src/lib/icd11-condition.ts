/**
 * Optional ICD-11 MMS condition codes for a future indication / comorbidity field.
 * Do not call id.who.int from the product page — cache stems you actually use.
 * Pair ranking does not depend on this module.
 */

export const ICD11_RELEASE = "2026-01";
export const ICD11_LINEARIZATION = "mms";

export type Icd11ConditionRef = {
  code: string;
  titleEn?: string;
  titleAr?: string;
  releaseId: string;
  linearization: "mms";
  postCoordination?: string;
};

export function formatIcd11Ref(ref: Icd11ConditionRef): string {
  const label = ref.titleEn || ref.code;
  return `${ref.code} (${ref.linearization}@${ref.releaseId}) ${label}`;
}

/** Placeholder — wire WHO ICD-API behind a nightly job, not a request-time fetch. */
export async function lookupIcd11Stub(_query: string): Promise<Icd11ConditionRef[]> {
  return [];
}
