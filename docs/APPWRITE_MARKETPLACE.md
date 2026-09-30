# Appwrite marketplace — Medicine Support Hub

Appwrite does not let you self-publish a product onto [Integrations](https://appwrite.io/integrations).
Submit the partner form, and optionally a Function template PR.

## 1. Partner / Integrations catalog (do this first)

1. Open https://appwrite.io/partners
2. Scroll to **Become a Partner** and submit the form.
3. Choose **Integrations / Technology partner** (product built on Appwrite), not only agency/expert unless you also sell implementation.

### Paste block

- Product: Medicine Support Hub
- Website: https://medicinesupport.app
- GitHub: https://github.com/minasami/medicine-support-hub
- Logo: https://medicinesupport.app/medicine-support-hub-logo.png
- Contact: minasamitawfiksaad@gmail.com · +20 128 459 0503
- Location: Giza / Cairo, Egypt
- Cloud project: Appwrite Cloud (Functions already deployed from this repo)

**What we built on Appwrite**

Auth, Databases (prescriptions, prescription_items, orders, order_quotes, order_messages, pharmacies, annotations), Storage bucket `prescription-images`, Functions (`ocr-prescription-parser` and related Rx / catalog jobs), Realtime, Messaging.

**Why list it**

Reference healthcare stack other Appwrite teams can study or reuse: prescription or invoice photo → parse → pharmacy quote → chat → TPA claim draft, plus an Egypt medicine encyclopedia.

**Category suggestions:** Health / AI / Storage / Functions

## 2. Function templates marketplace

In-console list lives at Project → Functions → Templates.
Upstream repo: https://github.com/appwrite/templates

Candidate from this repo: `functions/ocr-prescription-parser`

Before opening a PR on `appwrite/templates`:

- Strip Hub-only collection IDs behind env vars (`APPWRITE_DATABASE_ID`, `RX_BUCKET`, `GCP_PROJECT`).
- Keep Node 18/20, `src/main.js`, no private keys in the template.
- Add a README that matches `appwrite/templates/_README_TEMPLATE.md` (see `docs/templates/ocr-prescription-parser.README.md`).
- Folder layout they expect: `node/ocr-prescription-parser/` (or `node-nodejs-20/`).

Do **not** submit the whole SPA as a template. Only the isolated function.

## 3. After they reply

- Send screenshots of /scan?mode=rx, /medicines, and the Appwrite Console functions list.
- Offer a 15-minute walkthrough.
- If they want a blog post: “Prescription OCR + pharmacy negotiation on Appwrite Functions”.
