# Tesseract.js OCR

Web and WebView Rx / invoice capture uses [tesseract.js](https://github.com/naptha/tesseract.js) when ML Kit is absent.

Order:
1. Capacitor ML Kit text (native builds only)
2. Tesseract.js `eng+ara` (CDN worker + tessdata)
3. Server `ocr-prescription-parser` still runs with `imageId` + any extracted `text`

Workers are not bundled. First scan downloads the worker (~2 MB) and language data.
