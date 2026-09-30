/**
 * EDA EPTTS / ETTP Phase 1 CSV helper.
 * Source: EDREX:NP.CIP.004/2026 Implementation Guide for Commissioning and Packing.
 *
 * This module only prepares and validates files. It does not submit to EDA/EPTTS.
 */

export const EPTTS_PHASE1_HEADER =
  "seqNo,Bizstep,eventTime,timeOffset,readPointGLN,bizLocationGLN,epc,Parent,import,expiryDate,manufDate";

export const EPTTS_PHASE1_COLUMNS = EPTTS_PHASE1_HEADER.split(",") as readonly string[];

export const MAX_UNIQUE_SGTINS = 50_000;
export const MAX_DISTINCT_LOTS = 5;

export type EpttsBizstep = "commissioning" | "packing";

export type EpttsPhase1Row = {
  seqNo: string;
  Bizstep: string;
  eventTime: string;
  timeOffset: string;
  readPointGLN: string;
  bizLocationGLN: string;
  epc: string;
  Parent: string;
  import: string;
  expiryDate: string;
  manufDate: string;
};

export type EpttsIssue = {
  severity: "error" | "warning";
  row?: number;
  field?: string;
  code: string;
  messageEn: string;
  messageAr: string;
};

export type EpttsValidationResult = {
  ok: boolean;
  headerOk: boolean;
  rowCount: number;
  uniqueSgtins: number;
  distinctLots: string[];
  commissionedEpcs: string[];
  packedChildren: string[];
  issues: EpttsIssue[];
  rows: EpttsPhase1Row[];
};

const EVENT_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const OFFSET_RE = /^[+-]\d{2}:\d{2}$/;
const DATE_T_RE = /^\d{4}-\d{2}-\d{2}T$/;
const SGTIN_RE = /^\(01\)(\d{14})\(21\)(.+)$/;
const SSCC_RE = /^\(00\)(\d{18})$/;
const LOT_RE = /^\(10\)(.+)$/;

export function gs1CheckDigit(bodyWithoutCheck: string): number {
  let sum = 0;
  const digits = bodyWithoutCheck.replace(/\D/g, "");
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i += 1) {
    const n = Number(reversed[i]);
    sum += n * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function hasValidGs1CheckDigit(digits: string): boolean {
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$|^\d{17}$|^\d{18}$/.test(digits)) {
    return false;
  }
  const body = digits.slice(0, -1);
  const check = Number(digits.slice(-1));
  return gs1CheckDigit(body) === check;
}

export function parseCsvText(text: string): string[][] {
  const raw = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const table: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quoted) {
      if (ch === '"' && raw[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else cell += ch;
    } else if (ch === ',' || ch === '\n') {
      row.push(cell); cell = ""; closed = false;
      if (ch === '\n') { table.push(row); row = []; }
    } else if (ch === '"' && !cell && !closed) {
      quoted = true;
    } else {
      if (closed || ch === '"') throw new Error("Invalid CSV quoting");
      cell += ch;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  if (cell || row.length || closed) table.push([...row, cell]);
  // Ignore trailing empty lines only; internal blank records retain their row numbers.
  while (table.length && table[table.length - 1].length === 1 && table[table.length - 1][0] === "") table.pop();
  return table;
}

function cellsToRow(cells: string[]): EpttsPhase1Row {
  return {
    seqNo: cells[0] ?? "",
    Bizstep: cells[1] ?? "",
    eventTime: cells[2] ?? "",
    timeOffset: cells[3] ?? "",
    readPointGLN: cells[4] ?? "",
    bizLocationGLN: cells[5] ?? "",
    epc: cells[6] ?? "",
    Parent: cells[7] ?? "",
    import: cells[8] ?? "",
    expiryDate: cells[9] ?? "",
    manufDate: cells[10] ?? "",
  };
}

function parseEventTimeMs(value: string): number | null {
  if (!EVENT_TIME_RE.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) || new Date(ms).toISOString() !== value ? null : ms;
}

function parseDateT(value: string): number | null {
  if (!DATE_T_RE.test(value)) return null;
  const ms = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value.slice(0, 10) ? null : ms;
}

function classifyEpc(epc: string): { kind: "sgtin" | "sscc" | "unknown"; digits?: string; serial?: string } {
  const sgtin = epc.match(SGTIN_RE);
  if (sgtin) return { kind: "sgtin", digits: sgtin[1], serial: sgtin[2] };
  const sscc = epc.match(SSCC_RE);
  if (sscc) return { kind: "sscc", digits: sscc[1] };
  return { kind: "unknown" };
}

export function validateEpttsPhase1Csv(text: string): EpttsValidationResult {
  const issues: EpttsIssue[] = [];
  let table: string[][];
  try { table = parseCsvText(text); }
  catch {
    return { ok: false, headerOk: false, rowCount: 0, uniqueSgtins: 0,
      distinctLots: [], commissionedEpcs: [], packedChildren: [], rows: [],
      issues: [{ severity: "error", code: "csv_syntax", messageEn: "Malformed CSV quoting.", messageAr: "علامات الاقتباس في ملف CSV غير صحيحة." }] };
  }

  if (table.length === 0) {
    issues.push({
      severity: "error",
      code: "empty_file",
      messageEn: "File is empty.",
      messageAr: "الملف فارغ.",
    });
    return {
      ok: false,
      headerOk: false,
      rowCount: 0,
      uniqueSgtins: 0,
      distinctLots: [],
      commissionedEpcs: [],
      packedChildren: [],
      issues,
      rows: [],
    };
  }

  const header = table[0].join(",");
  const headerOk = header === EPTTS_PHASE1_HEADER;
  if (!headerOk) {
    issues.push({
      severity: "error",
      row: 1,
      field: "header",
      code: "header_mismatch",
      messageEn: `Header must be exactly: ${EPTTS_PHASE1_HEADER}`,
      messageAr: `يجب أن يطابق صف العناوين القالب الرسمي حرفياً: ${EPTTS_PHASE1_HEADER}`,
    });
  }

  const dataLines = table.slice(1);
  const rows = dataLines.map(cellsToRow);
  const commissioned = new Set<string>();
  const packed = new Set<string>();
  const sgtins = new Set<string>();
  const lots = new Set<string>();
  let previousEventMs: number | null = null;

  rows.forEach((row, index) => {
    const rowNo = index + 2;
    const expectedSeq = String(index + 1);
    if (dataLines[index].length !== EPTTS_PHASE1_COLUMNS.length) {
      issues.push({ severity: "error", row: rowNo, code: "column_count",
        messageEn: "Each record must contain exactly 11 columns.",
        messageAr: "يجب أن يحتوي كل صف على ١١ عموداً بالضبط." });
    }
    if (row.seqNo !== expectedSeq) {
      issues.push({
        severity: "error",
        row: rowNo,
        field: "seqNo",
        code: "seq_order",
        messageEn: `seqNo must be ${expectedSeq} (continuous from 1).`,
        messageAr: `يجب أن يكون seqNo مساوياً ${expectedSeq} ومتتابعاً من 1.`,
      });
    }

    if (row.Bizstep !== "commissioning" && row.Bizstep !== "packing") {
      issues.push({
        severity: "error",
        row: rowNo,
        field: "Bizstep",
        code: "bizstep",
        messageEn: "Bizstep must be commissioning or packing.",
        messageAr: "قيمة Bizstep يجب أن تكون commissioning أو packing فقط.",
      });
    }

    const eventMs = parseEventTimeMs(row.eventTime);
    if (eventMs === null) {
      issues.push({
        severity: "error",
        row: rowNo,
        field: "eventTime",
        code: "event_time_format",
        messageEn: "eventTime must be ISO 8601 UTC like 2026-03-05T10:00:00.000Z.",
        messageAr: "صيغة eventTime يجب أن تكون UTC مثل 2026-03-05T10:00:00.000Z.",
      });
    } else if (previousEventMs !== null && eventMs < previousEventMs) {
      issues.push({
        severity: "error",
        row: rowNo,
        field: "eventTime",
        code: "event_time_order",
        messageEn: "Rows must be sorted by eventTime ascending.",
        messageAr: "يجب ترتيب الصفوف تصاعدياً حسب eventTime.",
      });
    }
    if (eventMs !== null) previousEventMs = eventMs;

    if (!OFFSET_RE.test(row.timeOffset) || Number(row.timeOffset.slice(1, 3)) > 23 || Number(row.timeOffset.slice(4)) > 59) {
      issues.push({
        severity: "error",
        row: rowNo,
        field: "timeOffset",
        code: "time_offset",
        messageEn: "timeOffset must look like +02:00 or +04:00.",
        messageAr: "صيغة timeOffset يجب أن تكون مثل +02:00 أو +04:00.",
      });
    }

    if (!row.readPointGLN || !row.bizLocationGLN) {
      issues.push({
        severity: "error",
        row: rowNo,
        field: "readPointGLN",
        code: "gln_required",
        messageEn: "readPointGLN and bizLocationGLN are required.",
        messageAr: "readPointGLN و bizLocationGLN إلزاميان.",
      });
    } else if (row.readPointGLN !== row.bizLocationGLN) {
      issues.push({
        severity: "error",
        row: rowNo,
        field: "readPointGLN",
        code: "gln_mismatch",
        messageEn: "readPointGLN must equal bizLocationGLN.",
        messageAr: "يجب أن يتساوى readPointGLN مع bizLocationGLN.",
      });
    } else if (!hasValidGs1CheckDigit(row.readPointGLN) || !/^\d{13}$/.test(row.readPointGLN)) {
      issues.push({
        severity: "error",
        row: rowNo,
        field: "readPointGLN",
        code: "gln_format",
        messageEn: "GLN must contain 13 digits with a valid GS1 check digit.",
        messageAr: "يجب أن يتكون GLN من ١٣ رقماً مع رقم تحقق GS1 صالح.",
      });
    }

    const epcInfo = classifyEpc(row.epc);
    if (epcInfo.kind === "unknown") {
      issues.push({
        severity: "error",
        row: rowNo,
        field: "epc",
        code: "epc_format",
        messageEn: "epc must be (01)GTIN14(21)SERIAL or (00)SSCC18.",
        messageAr: "صيغة epc يجب أن تكون (01)GTIN14(21)SERIAL أو (00)SSCC18.",
      });
    } else if (epcInfo.digits && !hasValidGs1CheckDigit(epcInfo.digits)) {
      issues.push({
        severity: "error",
        row: rowNo,
        field: "epc",
        code: "epc_check_digit",
        messageEn: `Invalid GS1 check digit on ${epcInfo.kind.toUpperCase()} ${epcInfo.digits}.`,
        messageAr: `رقم التحقق GS1 غير صالح في ${epcInfo.kind.toUpperCase()} ${epcInfo.digits}.`,
      });
    }

    if (epcInfo.kind === "sgtin" && row.epc) sgtins.add(row.epc);

    if (row.Bizstep === "commissioning") {
      if (epcInfo.kind === "sgtin") {
        if (!LOT_RE.test(row.Parent)) {
          issues.push({
            severity: "error",
            row: rowNo,
            field: "Parent",
            code: "lot_required",
            messageEn: "SGTIN commissioning Parent must be a lot like (10)BATCH003.",
            messageAr: "عند تشغيل SGTIN يجب أن يكون Parent رقم تشغيلية مثل (10)BATCH003.",
          });
        } else {
          lots.add(row.Parent);
        }
        if (row.import !== "" && row.import !== "I") {
          issues.push({
            severity: "error",
            row: rowNo,
            field: "import",
            code: "import_flag",
            messageEn: "import must be I (imported) or blank (local).",
            messageAr: "حقل import يكون I للمستورد أو فارغاً للمحلي.",
          });
        }
        if (parseDateT(row.expiryDate) === null) {
          issues.push({
            severity: "error",
            row: rowNo,
            field: "expiryDate",
            code: "expiry_format",
            messageEn: "expiryDate is required for SGTIN commissioning as YYYY-MM-DDT.",
            messageAr: "expiryDate إلزامي لتشغيل SGTIN بصيغة YYYY-MM-DDT.",
          });
        } else if (eventMs !== null) {
          const expiryMs = parseDateT(row.expiryDate);
          if (expiryMs !== null && expiryMs < eventMs) {
            issues.push({
              severity: "error",
              row: rowNo,
              field: "expiryDate",
              code: "expiry_passed",
              messageEn: "Already-expired expiryDate rejects the row.",
              messageAr: "تاريخ صلاحية منتهٍ يرفض الصف.",
            });
          }
        }
        if (row.manufDate) {
          if (parseDateT(row.manufDate) === null) {
            issues.push({
              severity: "error",
              row: rowNo,
              field: "manufDate",
              code: "manuf_format",
              messageEn: "manufDate must be YYYY-MM-DDT when provided.",
              messageAr: "صيغة manufDate عند إدخالها يجب أن تكون YYYY-MM-DDT.",
            });
          } else if (eventMs !== null) {
            const manufMs = parseDateT(row.manufDate);
            if (manufMs !== null && manufMs >= eventMs) {
              issues.push({
                severity: "error",
                row: rowNo,
                field: "manufDate",
                code: "manuf_after_event",
                messageEn: "manufDate must be earlier than eventTime.",
                messageAr: "يجب أن يسبق manufDate وقت الحدث eventTime.",
              });
            }
          }
        }
      } else if (epcInfo.kind === "sscc") {
        if (row.Parent || row.import || row.expiryDate || row.manufDate) {
          issues.push({
            severity: "error",
            row: rowNo,
            field: "Parent",
            code: "sscc_blank_fields",
            messageEn: "SSCC commissioning must leave Parent, import, expiryDate, and manufDate blank.",
            messageAr: "تشغيل SSCC يتطلب ترك Parent و import و expiryDate و manufDate فارغة.",
          });
        }
      }
      if (row.epc) commissioned.add(row.epc);
    }

    if (row.Bizstep === "packing") {
      if (row.import || row.expiryDate || row.manufDate) {
        issues.push({
          severity: "error",
          row: rowNo,
          field: "import",
          code: "packing_blank_fields",
          messageEn: "Packing rows must leave import, expiryDate, and manufDate blank.",
          messageAr: "صفوف التعبئة تترك import و expiryDate و manufDate فارغة.",
        });
      }
      const parentInfo = classifyEpc(row.Parent);
      if (parentInfo.kind !== "sscc" || (parentInfo.digits && !hasValidGs1CheckDigit(parentInfo.digits))) {
        issues.push({
          severity: "error",
          row: rowNo,
          field: "Parent",
          code: "packing_parent",
          messageEn: "Packing Parent must be a valid (00)SSCC.",
          messageAr: "Parent في التعبئة يجب أن يكون SSCC صالحاً بصيغة (00).",
        });
      }
      if (row.epc && !commissioned.has(row.epc)) {
        issues.push({
          severity: "warning",
          row: rowNo,
          field: "epc",
          code: "child_not_in_file",
          messageEn:
            "Child EPC is not commissioned earlier in this file. That is allowed only if it was commissioned in a previous accepted upload.",
          messageAr:
            "وحدة الابن غير مشغّلة في هذا الملف. هذا مقبول فقط إذا تم تشغيلها في رفع سابق مقبول.",
        });
      }
      if (row.epc) packed.add(row.epc);
    }
  });

  if (lots.size > MAX_DISTINCT_LOTS) {
    issues.push({
      severity: "error",
      code: "lot_limit",
      messageEn: `Maximum ${MAX_DISTINCT_LOTS} distinct lots per commissioning file (found ${lots.size}).`,
      messageAr: `الحد الأقصى ${MAX_DISTINCT_LOTS} تشغيلة مختلفة في ملف التشغيل (وُجد ${lots.size}).`,
    });
  }

  if (sgtins.size > MAX_UNIQUE_SGTINS) {
    issues.push({
      severity: "error",
      code: "serial_limit",
      messageEn: `Maximum ${MAX_UNIQUE_SGTINS} unique SGTINs per file (found ${sgtins.size}).`,
      messageAr: `الحد الأقصى ${MAX_UNIQUE_SGTINS} رقم تسلسلي فريد لكل ملف (وُجد ${sgtins.size}).`,
    });
  }

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  return {
    ok: headerOk && errorCount === 0,
    headerOk,
    rowCount: rows.length,
    uniqueSgtins: sgtins.size,
    distinctLots: [...lots],
    commissionedEpcs: [...commissioned],
    packedChildren: [...packed],
    issues,
    rows,
  };
}

export function buildTemplateCsv(): string {
  return `${EPTTS_PHASE1_HEADER}\n`;
}

function csvLine(values: string[]): string {
  return values
    .map((value) => (/["\,\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value))
    .join(",");
}

/** Compact official-style example using identifiers from EDREX:NP.CIP.004/2026. */
export function buildWorkedExampleCsv(): string {
  const gln = "5413868000009";
  const offset = "+04:00";
  const gtin = "04065270805843";
  const lot = "(10)BATCH003";
  const expiry = "2028-02-01T";
  const manuf = "2026-02-01T";
  const itemTime = "2026-03-05T10:00:00.000Z";
  const caseTime = "2026-03-05T10:05:00.000Z";
  const packTime = "2026-03-05T12:00:00.000Z";
  const palletTime = "2026-03-05T12:30:00.000Z";
  const caseA = "(00)035045800000002012";
  const caseB = "(00)035045800000002029";
  const pallet = "(00)035045800000002111";

  const lines: string[][] = [];
  const serials = ["B3-0001", "B3-0002", "B3-0003", "B3-0004", "B3-0005", "B3-0006"];

  serials.forEach((serial) => {
    lines.push([
      "",
      "commissioning",
      itemTime,
      offset,
      gln,
      gln,
      `(01)${gtin}(21)${serial}`,
      lot,
      "I",
      expiry,
      manuf,
    ]);
  });

  [caseA, caseB, pallet].forEach((sscc) => {
    lines.push(["", "commissioning", caseTime, offset, gln, gln, sscc, "", "", "", ""]);
  });

  serials.slice(0, 3).forEach((serial) => {
    lines.push([
      "",
      "packing",
      packTime,
      offset,
      gln,
      gln,
      `(01)${gtin}(21)${serial}`,
      caseA,
      "",
      "",
      "",
    ]);
  });
  serials.slice(3).forEach((serial) => {
    lines.push([
      "",
      "packing",
      packTime,
      offset,
      gln,
      gln,
      `(01)${gtin}(21)${serial}`,
      caseB,
      "",
      "",
      "",
    ]);
  });

  [caseA, caseB].forEach((sscc) => {
    lines.push(["", "packing", palletTime, offset, gln, gln, sscc, pallet, "", "", ""]);
  });

  const numbered = lines.map((cols, index) => {
    const copy = [...cols];
    copy[0] = String(index + 1);
    return csvLine(copy);
  });

  return [EPTTS_PHASE1_HEADER, ...numbered].join("\n") + "\n";
}

export function summarizeForSplit(result: EpttsValidationResult): string[] {
  const hints: string[] = [];
  if (result.distinctLots.length > MAX_DISTINCT_LOTS) {
    hints.push(
      `Split commissioning rows by lot. This file has ${result.distinctLots.length} lots; keep at most ${MAX_DISTINCT_LOTS} per file.`,
    );
  }
  if (result.uniqueSgtins > MAX_UNIQUE_SGTINS) {
    hints.push(
      `Split unique SGTINs into files of ${MAX_UNIQUE_SGTINS} or fewer. This file has ${result.uniqueSgtins}.`,
    );
  }
  return hints;
}
