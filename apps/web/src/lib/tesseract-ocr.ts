/**
 * Browser / WebView OCR via tesseract.js (eng + ara).
 * Workers and traineddata load from jsDelivr so the Vite bundle stays small.
 */
import type { Worker } from "tesseract.js";

const TESS_VERSION = "5.1.1";
const CDN = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESS_VERSION}`;
const CORE = "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1";
const LANG = "https://tessdata.projectnaptha.com/4.0.0";

let workerPromise: Promise<Worker> | null = null;

async function getWorker(onProgress?: (ratio: number) => void): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng+ara", 1, {
        workerPath: `${CDN}/dist/worker.min.js`,
        corePath: `${CORE}/tesseract-core.wasm.js`,
        langPath: LANG,
        logger: (m) => {
          if (m.status === "recognizing text" && typeof m.progress === "number") {
            onProgress?.(m.progress);
          }
        },
      });
      return worker;
    })();
  }
  return workerPromise;
}

export async function recognizeWithTesseract(
  file: File | Blob | string,
  onProgress?: (ratio: number) => void,
): Promise<string | null> {
  try {
    const worker = await getWorker(onProgress);
    const { data } = await worker.recognize(file);
    const text = String(data?.text || "").replace(/\s+/g, " ").trim();
    return text.length >= 2 ? text : null;
  } catch {
    return null;
  }
}
