import { useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, ShieldAlert, UploadCloud } from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import {
  buildTemplateCsv,
  buildWorkedExampleCsv,
  MAX_DISTINCT_LOTS,
  MAX_UNIQUE_SGTINS,
  summarizeForSplit,
  validateEpttsPhase1Csv,
  type EpttsIssue,
  type EpttsValidationResult,
} from "@/lib/eptts-phase1";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function downloadText(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function IndustryEpttsWorkshopPage() {
  const { t, language } = useLanguage();
  const arabic = language === "ar";
  const [result, setResult] = useState<EpttsValidationResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const readId = useRef(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const splitHints = useMemo(() => (result ? summarizeForSplit(result) : []), [result]);

  return (
    <div className="container mx-auto max-w-4xl space-y-6 px-4 py-10">
      <Badge className="bg-emerald-600/90 font-bold text-white">
        {t("Manufacturer tool · Phase 1 CSV", "أداة المصنّعين · المرحلة الأولى CSV")}
      </Badge>
      <h1 className="text-3xl font-extrabold tracking-tight">
        {t("EPTTS commissioning & packing workshop", "ورشة تشغيل وتعبئة منظومة التتبع الدوائي")}
      </h1>
      <p className="max-w-3xl text-sm text-muted-foreground">
        {t(
          "Prepare and validate EDA Phase 1 CSV files for commissioning and packing, then upload them yourself in EPTTS. Medicine Support Hub does not submit events to the national system.",
          "جهّز ملف CSV للمرحلة الأولى من هيئة الدواء ثم ارفعه بنفسك على المنظومة. المنصة لا ترسل الأحداث إلى هيئة الدواء.",
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <a href="/industry">{t("Claim company profile", "توثيق ملف الشركة")}</a>
        </Button>
        <Button variant="outline" asChild>
          <a href="/industry/workspace">{t("Company workspace", "مساحة عمل الشركة")}</a>
        </Button>
      </div>

      <Alert className="border-amber-500/40 bg-amber-50 dark:bg-amber-950/30">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>{t("Not an EDA gateway", "ليست بوابة لهيئة الدواء")}</AlertTitle>
        <AlertDescription>
          {t(
            "This page never stores serial numbers on the public encyclopedia and never files commissioning or packing events.",
            "هذه الصفحة لا تحفظ الأرقام التسلسلية في الموسوعة ولا تقدّم أحداث التشغيل أو التعبئة.",
          )}
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Download className="h-5 w-5 text-emerald-600" />
              {t("CSV template", "قالب CSV")}
            </CardTitle>
            <CardDescription>
              {t("Fixed 11-column header. Do not rename columns or change order.", "أحد عشر عموداً بترتيب ثابت. لا تغيّر الأسماء أو الترتيب.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => downloadText("eptts-phase1-template.csv", buildTemplateCsv())}>
              {t("Download empty template", "تنزيل القالب الفارغ")}
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
              {t("Worked example", "مثال تشغيلي")}
            </CardTitle>
            <CardDescription>
              {t("6 items, 2 cases, 1 pallet — BATCH003 style.", "٦ عبوات وصندوقان وبالتة — نمط BATCH003.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => downloadText("eptts-phase1-example-batch003.csv", buildWorkedExampleCsv())}>
              {t("Download example CSV", "تنزيل مثال CSV")}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="border-emerald-500/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UploadCloud className="h-5 w-5 text-emerald-600" />
            {t("Validate a file before EPTTS upload", "تحقق من الملف قبل الرفع على المنظومة")}
          </CardTitle>
          <CardDescription>
            {t(
              `Checks header, sequence, timestamps, GLN match, GS1 check digits, lot cap (${MAX_DISTINCT_LOTS}), and serial cap (${MAX_UNIQUE_SGTINS.toLocaleString()}).`,
              `يفحص العناوين والترتيب والتوقيت وتطابق GLN ورقم تحقق GS1 وحد التشغيلات (${MAX_DISTINCT_LOTS}) وحد الأرقام التسلسلية (${MAX_UNIQUE_SGTINS.toLocaleString()}).`,
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-emerald-500/40 bg-emerald-50/40 px-4 py-8 text-center dark:bg-emerald-950/20">
            <UploadCloud className="mb-2 h-8 w-8 text-emerald-700" />
            <span className="text-sm font-semibold">
              {t("Choose a CSV file (up to 10 MB)", "اختر ملف CSV (حتى ١٠ ميجابايت)")}
            </span>
            <span className="mt-1 text-xs text-muted-foreground">
              {fileName || t("Client-side only · file is not uploaded to our servers", "على جهازك فقط · لا يُرفع الملف إلى خوادمنا")}
            </span>
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const id = ++readId.current;
                setFileName(file.name);
                setResult(null);
                setFileError(null);
                setReading(false);
                event.target.value = "";
                if (file.size > 10 * 1024 * 1024) {
                  setFileError(t("File exceeds the 10 MB browser limit.", "الملف يتجاوز حد المتصفح البالغ ١٠ ميجابايت."));
                  return;
                }
                setReading(true);
                try {
                  const text = await file.text();
                  if (id === readId.current) setResult(validateEpttsPhase1Csv(text));
                } catch {
                  if (id === readId.current) setFileError(t("Could not read this file.", "تعذر قراءة الملف."));
                } finally {
                  if (id === readId.current) setReading(false);
                }
              }}
            />
          </label>

          {reading && <p role="status">{t("Reading file…", "جار قراءة الملف…")}</p>}
          {fileError && <p role="alert">{fileError}</p>}
          {result && (
            <div className="space-y-3">
              <Alert className={result.ok ? "border-emerald-500/40 bg-emerald-50" : "border-red-500/40 bg-red-50"}>
                {result.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4" />}
                <AlertTitle>
                  {result.ok
                    ? result.rowCount === 0
                      ? t("Empty template — no events to check", "قالب فارغ — لا توجد أحداث للتحقق")
                      : t("Local checks passed — EDA acceptance not verified", "اجتاز الفحص المحلي — لم يتم التحقق من قبول هيئة الدواء")
                    : t("Fix the listed file errors", "صحح أخطاء الملف الموضحة")}
                </AlertTitle>
                <AlertDescription>
                  {t(`Rows ${result.rowCount} · SGTINs ${result.uniqueSgtins} · lots ${result.distinctLots.length}`, `صفوف ${result.rowCount} · أرقام تسلسلية ${result.uniqueSgtins} · تشغيلات ${result.distinctLots.length}`)}
                </AlertDescription>
              </Alert>
              {splitHints.map((hint) => (
                <p key={hint} className="text-sm text-muted-foreground">{hint}</p>
              ))}
              <ul className="space-y-2">
                {result.issues.slice(0, 200).map((issue: EpttsIssue, index) => (
                  <li key={`${issue.code}-${issue.row ?? "file"}-${index}`} className="rounded-lg border px-3 py-2 text-sm">
                    <strong>
                      {issue.severity === "error" ? (arabic ? "خطأ" : "Error") : arabic ? "تنبيه" : "Warning"}
                      {issue.row ? ` · ${arabic ? "صف" : "row"} ${issue.row}` : ""}
                    </strong>
                    <p className="mt-1 text-xs">{arabic ? issue.messageAr : issue.messageEn}</p>
                  </li>
                ))}
              </ul>
              {result.issues.length > 200 && <p>{t(`Showing 200 of ${result.issues.length} issues.`, `عرض ٢٠٠ من ${result.issues.length} مشكلة.`)}</p>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
