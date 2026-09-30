/**
 * Lightweight checks for device-locale detection + bilingual display names.
 * Run: npx tsx apps/web/src/lib/i18n-locale.test.ts
 */
import { detectDeviceLanguage } from "./i18n-locale";
import { localeMedicineNames } from "./medicine-display";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
  console.log("ok:", msg);
}

assert(detectDeviceLanguage("ar") === "ar", "stored ar wins");
assert(detectDeviceLanguage("en") === "en", "stored en wins");
assert(
  detectDeviceLanguage(null, { language: "ar-EG" }) === "ar",
  "ar-EG device → ar",
);
assert(
  detectDeviceLanguage(null, { language: "ar" }) === "ar",
  "ar device → ar",
);
assert(
  detectDeviceLanguage(null, { languages: ["ar-SA", "en-US"], language: "en-US" }) === "ar",
  "languages[0] ar wins",
);
assert(
  detectDeviceLanguage(null, { language: "en-US" }) === "en",
  "en-US device → en",
);
assert(
  detectDeviceLanguage("en", { language: "ar-EG" }) === "en",
  "explicit store beats device",
);

const ar = localeMedicineNames("ar", "Panadol", "بانادول");
assert(ar.primary === "بانادول", "ar primary is Arabic");
assert(ar.secondary === "Panadol", "ar secondary is English");

const en = localeMedicineNames("en", "Panadol", "بانادول");
assert(en.primary === "Panadol", "en primary is English");
assert(en.secondary === "بانادول", "en secondary is Arabic");

const arOnly = localeMedicineNames("en", "", "بانادول");
assert(arOnly.primary === "بانادول", "falls back to Arabic when EN empty");

console.log("\nAll i18n-locale checks passed.");
