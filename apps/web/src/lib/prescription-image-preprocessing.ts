import { ExecutionMethod } from "appwrite";
import { functions } from "@/lib/appwrite";

const OCR_FUNCTION_ID = "ocr-prescription-parser";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const CLIENT_BRIDGE_ENABLED = import.meta.env.VITE_OPENCV5_PRESCRIPTION_VISION_ENABLED === "true";

type PreprocessResponse = {
  success?: boolean;
  preprocessing?: {
    applied?: boolean;
    mime_type?: string;
    preprocessed_image_base64?: string;
  };
};

function fileFromBase64(value: string, original: File): File | null {
  if (!value || value.length > MAX_BASE64_CHARS || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return null;
  }
  try {
    const binary = atob(value);
    if (!binary.length || binary.length > MAX_IMAGE_BYTES) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new File([bytes], original.name, {
      type: "image/jpeg",
      lastModified: original.lastModified,
    });
  } catch {
    return null;
  }
}

/**
 * Ask the authenticated Appwrite OCR function to preprocess this user's uploaded
 * image. The AWS worker URL and signing credentials are never exposed to the client.
 * Any disabled/unavailable bridge keeps the untouched uploaded File as the OCR input.
 */
export async function preprocessPrescriptionImage(file: File, imageId: string): Promise<File> {
  if (!CLIENT_BRIDGE_ENABLED) return file;
  try {
    const execution = await functions.createExecution(
      OCR_FUNCTION_ID,
      JSON.stringify({ action: "preprocess", imageId }),
      false,
      "/",
      ExecutionMethod.POST,
    );
    const response = JSON.parse(execution.responseBody || "{}") as PreprocessResponse;
    if (
      response.success !== true ||
      response.preprocessing?.applied !== true ||
      response.preprocessing.mime_type !== "image/jpeg"
    ) {
      return file;
    }
    return fileFromBase64(response.preprocessing.preprocessed_image_base64 || "", file) || file;
  } catch {
    // OCR remains available from the original local image if Appwrite/AWS is unavailable.
    return file;
  }
}
