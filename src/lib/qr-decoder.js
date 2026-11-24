// src/lib/qr-decoder.js
// ─────────────────────────────────────────────────────────────────────────────
// QR code reader utility for web browser (scans images or video feeds).
// Uses the native BarcodeDetector API supported in Chromium / Android WebView.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decodes QR code content from an image File or Blob.
 * @param {File|Blob} file
 * @returns {Promise<{ ok: boolean, text?: string, error?: string }>}
 */
export async function decodeQrFromImageFile(file) {
  if (!file) return { ok: false, error: 'No image file provided' };

  if (typeof window === 'undefined') {
    return { ok: false, error: 'QR decoding is only available in browser environment' };
  }

  // 1. Check BarcodeDetector support
  if ('BarcodeDetector' in window) {
    try {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      if (codes && codes.length > 0 && codes[0].rawValue) {
        return { ok: true, text: codes[0].rawValue.trim() };
      }
      return { ok: false, error: 'No QR code found in the image. Please ensure the QR is clear and well lit.' };
    } catch (err) {
      console.warn('[decodeQrFromImageFile] BarcodeDetector failed, falling back:', err.message);
    }
  }

  // 2. Fallback via Image element and Canvas
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = async () => {
        if ('BarcodeDetector' in window) {
          try {
            const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
            const codes = await detector.detect(img);
            if (codes && codes.length > 0 && codes[0].rawValue) {
              resolve({ ok: true, text: codes[0].rawValue.trim() });
              return;
            }
          } catch (_) {}
        }
        resolve({
          ok: false,
          error: 'Your browser requires BarcodeDetector or Chrome/Edge to scan images directly. You can also type your UPI ID manually.',
        });
      };
      img.onerror = () => resolve({ ok: false, error: 'Could not load the image file' });
      img.src = reader.result;
    };
    reader.onerror = () => resolve({ ok: false, error: 'Failed to read image file' });
    reader.readAsDataURL(file);
  });
}
