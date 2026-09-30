# Submit OCR parser to Appwrite Function templates

Official marketplace source: https://github.com/appwrite/templates

```bash
git clone https://github.com/appwrite/templates.git
cd templates
mkdir -p node/ocr-prescription-parser/src
# copy from this repo:
cp ../medicine-support-hub/functions/ocr-prescription-parser/package.json node/ocr-prescription-parser/
cp ../medicine-support-hub/functions/ocr-prescription-parser/src/main.js node/ocr-prescription-parser/src/
cp ../medicine-support-hub/templates/appwrite/node/ocr-prescription-parser/README.md node/ocr-prescription-parser/
```

Open a PR titled `feat: add ocr-prescription-parser Node.js template`.

The live Function in Medicine Support Hub stays at `functions/ocr-prescription-parser`.
This folder is only the marketplace README + submit steps.
