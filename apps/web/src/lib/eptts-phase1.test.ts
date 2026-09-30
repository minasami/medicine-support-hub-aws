/**
 * EPTTS Phase 1 CSV helper checks.
 * Run: pnpm test:eptts-phase1
 */
import {
  buildTemplateCsv,
  buildWorkedExampleCsv,
  hasValidGs1CheckDigit,
  validateEpttsPhase1Csv,
} from "./eptts-phase1.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
  console.log("ok:", msg);
}

assert(hasValidGs1CheckDigit("04065270805843"), "official example GTIN check digit");
assert(hasValidGs1CheckDigit("035045800000002012"), "official example SSCC check digit");
assert(hasValidGs1CheckDigit("5413868000009"), "official example GLN check digit");
assert(!hasValidGs1CheckDigit("04065270805844"), "wrong GTIN check digit rejected");

const template = buildTemplateCsv();
const templateResult = validateEpttsPhase1Csv(template);
assert(templateResult.ok, "empty template is valid (header only)");
assert(templateResult.rowCount === 0, "template has no data rows");

const example = buildWorkedExampleCsv();
const exampleResult = validateEpttsPhase1Csv(example);
assert(exampleResult.ok, "worked example validates");
assert(exampleResult.rowCount === 17, "worked example has 17 data rows");
assert(exampleResult.uniqueSgtins === 6, "worked example unique SGTINs");
assert(exampleResult.distinctLots.length === 1, "worked example single lot");

const badHeader = validateEpttsPhase1Csv("seqNo,wrong\n1,commissioning\n");
assert(!badHeader.ok, "wrong header fails");
assert(
  badHeader.issues.some((issue) => issue.code === "header_mismatch"),
  "header mismatch code",
);

const badOrder = example.replace("2026-03-05T12:30:00.000Z", "2026-03-05T09:00:00.000Z");
const orderResult = validateEpttsPhase1Csv(badOrder);
assert(
  orderResult.issues.some((issue) => issue.code === "event_time_order"),
  "descending eventTime fails",
);



// Invalid inputs must not silently pass local validation.
const invalidCases: Array<[string, string, string]> = [
  ["extra column", example.split("\n").map((line, i) => i && line ? line + ",extra" : line).join("\n"), "column_count"],
  ["missing column", example.split("\n").map((line, i) => i && line ? line.slice(0, line.lastIndexOf(",")) : line).join("\n"), "column_count"],
  ["invalid GLN check digit", example.replaceAll("5413868000009", "5413868000000"), "gln_format"],
  ["wrong GLN length with valid check digit", example.replaceAll("5413868000009", "04065270805843"), "gln_format"],
  ["invalid expiry month", example.replaceAll("2028-02-01T", "2028-99-99T"), "expiry_format"],
  ["invalid expiry day", example.replaceAll("2028-02-01T", "2028-02-30T"), "expiry_format"],
  ["invalid manufacture date", example.replaceAll("2026-02-01T", "2026-02-29T"), "manuf_format"],
  ["normalized event date", example.replaceAll("2026-03-05T", "2026-02-30T"), "event_time_format"],
  ["invalid offset hours", example.replaceAll("+04:00", "+99:00"), "time_offset"],
  ["invalid offset minutes", example.replaceAll("+04:00", "+02:60"), "time_offset"],
  ["unclosed quote", example.trimEnd() + '\"\n', "csv_syntax"],
  ["characters after quote", example.replace("1,commissioning", '\"1\"x,commissioning'), "csv_syntax"],
  ["internal blank row", example.replace("2,commissioning", "\n2,commissioning"), "column_count"],
];
for (const [name, csv, code] of invalidCases) {
  const result = validateEpttsPhase1Csv(csv);
  assert(!result.ok && result.issues.some(issue => issue.code === code), name + " rejected");
}
assert(validateEpttsPhase1Csv("\uFEFF" + example.replaceAll("\n", "\r\n")).ok, "BOM and CRLF accepted");
assert(validateEpttsPhase1Csv(example.replaceAll("2028-02-01T", "2028-02-29T")).ok, "valid leap day accepted");
assert(validateEpttsPhase1Csv(example.replace("1,commissioning", '\"1\",\"commissioning\"')).ok, "proper quoted fields accepted");

console.log("eptts-phase1 tests passed");
