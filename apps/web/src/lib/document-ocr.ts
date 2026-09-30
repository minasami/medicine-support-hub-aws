import { recognizeTextFromFile } from "@/lib/native-mlkit-text";
import { recognizeWithTesseract } from "@/lib/tesseract-ocr";

export type DocumentOcrResult = {
  text: string | null;
  source: "mlkit" | "tesseract" | "none";
};

/**
 * Native ML Kit first (Android/iOS), then Tesseract.js in the WebView/browser.
 */
export async function recognizeDocumentText(file: File): Promise<DocumentOcrResult> {
  try {
    const native = await recognizeTextFromFile(file);
    if (native && native.trim().length >= 2) {
      return { text: native.trim(), source: "mlkit" };
    }
  } catch {
    /* fall through */
  }
  const tess = await recognizeWithTesseract(file);
  if (tess) return { text: tess, source: "tesseract" };
  return { text: null, source: "none" };
}
