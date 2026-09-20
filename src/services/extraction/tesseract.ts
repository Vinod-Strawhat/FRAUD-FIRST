/**
 * Server-side Tesseract OCR fallback.
 *
 * Used when AWS Textract is unavailable. Runs entirely server-side using
 * tesseract.js with Node.js worker. No browser APIs are used.
 *
 * The worker path is resolved via Node.js Module.createRequire() to bypass
 * Turbopack's compile-time rewriting of require.resolve(), which replaces
 * the call with a Turbopack module ID string instead of a real filesystem
 * path. createRequire() produces a native Node.js require function whose
 * .resolve() returns the actual installed package location.
 */

import path from "node:path";
import Module from "node:module";
import Tesseract from "tesseract.js";

export interface TesseractResult {
  text: string;
  confidence: number;
}

const SUPPORTED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
]);

function isSupportedImage(mimeType: string): boolean {
  return SUPPORTED_MIME_TYPES.has(mimeType);
}

/**
 * Resolve the tesseract.js worker script path from the installed package.
 *
 * Turbopack rewrites require.resolve("tesseract.js") into a module ID
 * string at compile time, even when tesseract.js is externalized via
 * serverExternalPackages. To get the real filesystem path, we create a
 * native Node.js require function via Module.createRequire() rooted at
 * a known filesystem location (process.cwd()), then call its .resolve().
 * process.cwd() is a runtime value that Turbopack does not rewrite.
 */
function resolveWorkerPath(): string {
  const nativeRequire = Module.createRequire(process.cwd() + "/noop.js");
  const entryPoint = nativeRequire.resolve("tesseract.js");
  return path.join(
    path.dirname(entryPoint),
    "worker-script",
    "node",
    "index.js"
  );
}

export async function extractWithTesseract(
  bytes: Uint8Array,
  mimeType: string
): Promise<TesseractResult> {
  if (!isSupportedImage(mimeType)) {
    throw new Error(
      `Tesseract does not support ${mimeType}. Use PNG or JPEG.`
    );
  }

  let workerPath: string;
  try {
    workerPath = resolveWorkerPath();
    console.log("[TESSERACT-DIAG] workerPath resolved", { workerPath });
  } catch (resolveError) {
    console.log("[TESSERACT-DIAG] resolveWorkerPath FAILED", {
      errorName: resolveError instanceof Error ? resolveError.name : typeof resolveError,
      errorMessage: resolveError instanceof Error ? resolveError.message : String(resolveError),
    });
    throw resolveError;
  }

  let worker;
  try {
    console.log("[TESSERACT-DIAG] Creating worker...");
    worker = await Tesseract.createWorker("eng", undefined, {
      workerPath,
    });
    console.log("[TESSERACT-DIAG] Worker created successfully");
  } catch (createError) {
    console.log("[TESSERACT-DIAG] createWorker FAILED", {
      errorName: createError instanceof Error ? createError.name : typeof createError,
      errorMessage: createError instanceof Error ? createError.message : String(createError),
      stack: createError instanceof Error ? createError.stack?.split("\n").slice(0, 5).join("\n") : undefined,
    });
    throw createError;
  }

  try {
    const buffer = Buffer.from(bytes);
    console.log("[TESSERACT-DIAG] Starting recognition...", { bufferSize: buffer.length });
    const result = await worker.recognize(buffer);
    console.log("[TESSERACT-DIAG] Recognition complete", { textLength: result.data.text.trim().length, confidence: result.data.confidence });

    const text = result.data.text.trim();
    const confidence = Math.round(result.data.confidence);

    return { text, confidence };
  } catch (recognizeError) {
    console.log("[TESSERACT-DIAG] recognize FAILED", {
      errorName: recognizeError instanceof Error ? recognizeError.name : typeof recognizeError,
      errorMessage: recognizeError instanceof Error ? recognizeError.message : String(recognizeError),
      stack: recognizeError instanceof Error ? recognizeError.stack?.split("\n").slice(0, 5).join("\n") : undefined,
    });
    throw recognizeError;
  } finally {
    await worker.terminate();
  }
}

export { isSupportedImage as isTesseractSupported };
