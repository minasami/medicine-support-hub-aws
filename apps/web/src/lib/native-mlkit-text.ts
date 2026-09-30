/**
 * On-device ML Kit text recognition (Capacitor Android/iOS),
 * then Tesseract.js in the browser / WebView.
 */
import { Capacitor } from "@capacitor/core";
import { recognizeWithTesseract } from "@/lib/tesseract-ocr";

export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function importOptional(moduleId: string): Promise<any | null> {
  try {
    const id = ["@", ...moduleId.replace(/^@/, "").split("/")].join("/");
    return await import(/* @vite-ignore */ id);
  } catch {
    return null;
  }
}

async function recognizeMlKit(file: File): Promise<string | null> {
  if (!file || !isNativePlatform()) return null;
  const dataUrl = await fileToDataUrl(file);
  const rawBase64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
  try {
    const fsMod = await import("@capacitor/filesystem");
    const path = `msh-ocr-${Date.now()}.jpg`;
    await fsMod.Filesystem.writeFile({
      path,
      data: rawBase64,
      directory: fsMod.Directory.Cache,
    });
    const uri = await fsMod.Filesystem.getUri({
      path,
      directory: fsMod.Directory.Cache,
    });

    const kit = await importOptional("capacitor-mlkit/text-recognition");
    if (kit?.TextRecognition?.processImage) {
      try {
        const Script = kit.Script as { Latin?: string; Chinese?: string } | undefined;
        const first = await kit.TextRecognition.processImage({
          path: uri.uri,
          script: Script?.Latin,
        });
        const text = String(first?.text || "").trim();
        if (text) return text;
      } catch {
        /* plugin present but call failed */
      }
    }

    const pan = await importOptional("pantrist/capacitor-plugin-ml-kit-text-recognition");
    if (pan?.detectText) {
      try {
        const r = await pan.detectText({ base64: rawBase64, filename: uri.uri });
        if (r?.text?.trim()) return r.text.trim();
      } catch {
        /* optional fallback */
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * ML Kit on native, Tesseract.js on web. Returns null if both fail.
 */
export async function recognizeTextFromFile(file: File): Promise<string | null> {
  if (!file) return null;
  try {
    const native = await recognizeMlKit(file);
    if (native && native.trim().length >= 2) return native.trim();
  } catch {
    /* fall through */
  }
  return recognizeWithTesseract(file);
}
