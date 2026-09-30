# ⚡ OCR Prescription & Invoice Parser

Parse prescription or pharmacy-invoice text (or an Appwrite Storage file id) inside an Appwrite Function. Optional client-side ML Kit text can be sent as `text` so the function does not need Document AI.

Assistive only. A licensed pharmacist or the patient must confirm items.

Canonical implementation: `functions/ocr-prescription-parser` in [medicine-support-hub](https://github.com/minasami/medicine-support-hub).

## 🧰 Usage

### POST /

| Name | Description | Location | Type | Sample |
| --- | --- | --- | --- | --- |
| imageId | Storage file id | Body | String | `64f…` |
| text | Pre-extracted OCR | Body | String | `Augmentin 1g BID` |
| user_id | Owner | Body | String | `64a…` |
| kind | `prescription` or `invoice` | Body | String | `invoice` |

**200**

```json
{ "success": true, "prescription_id": "…", "confidence_score": 0.82, "disclaimer": "AI assistive only. Licensed pharmacist must verify." }
```

**400**

```json
{ "success": false, "error": "Provide { imageId } and/or { text } and/or image payload." }
```

## ⚙️ Configuration

| Setting | Value |
| --- | --- |
| Runtime | Node.js 20 |
| Entrypoint | src/main.js |
| Build Commands | npm install |
| Permissions | users |
| Timeout (Seconds) | 30 |
| Scopes | databases.read, databases.write, storage.read, users.read |

## 🔒 Environment Variables

### APPWRITE_DATABASE_ID
Database that holds `prescriptions` and `prescription_items`.

| Question | Answer |
| --- | --- |
| Required | Yes |
| Sample Value | medicine_support_hub |

### APPWRITE_RX_BUCKET
Storage bucket for Rx photos.

| Question | Answer |
| --- | --- |
| Required | No |
| Sample Value | prescription-images |

### APPWRITE_API_KEY
Server key with Functions + Databases + Storage.

| Question | Answer |
| --- | --- |
| Required | Yes |
| Sample Value | standard_… |

### VERTEX_ACCESS_TOKEN / GOOGLE_CLOUD_PROJECT
Optional MedGemma / Vertex parse. Stub parser runs when unset.
