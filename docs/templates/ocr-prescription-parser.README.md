# ⚡ OCR Prescription & Invoice Parser

Parse a prescription or pharmacy invoice image (or pasted text) with Appwrite Storage + Functions. Optional on-device text from the client can be passed as `text` to skip a second OCR hop.

Educational / operations assist only. A pharmacist or patient must confirm items before any order.

## 🧰 Usage

### POST /

**Body (JSON)**

| Name | Description | Type | Sample |
| --- | --- | --- | --- |
| imageId | File ID in the prescriptions bucket | String | `64f…` |
| text | Optional pre-extracted OCR text (ML Kit) | String | `Augmentin 1g BID` |
| user_id | Appwrite user who owns the Rx | String | `64a…` |
| kind | `prescription` (default) or `invoice` | String | `invoice` |

**200**

```json
{ "success": true, "prescription_id": "…", "confidence_score": 0.82 }
```

**400**

```json
{ "success": false, "error": "Missing imageId or text" }
```

## ⚙️ Configuration

| Setting | Value |
| --- | --- |
| Runtime | Node.js 20 |
| Entrypoint | src/main.js |
| Build | npm install |
| Timeout | 30 |
| Scopes | databases.read, databases.write, storage.read, users.read |

## 🔒 Environment variables

| Name | Required | Notes |
| --- | --- | --- |
| APPWRITE_FUNCTION_PROJECT_ID | Yes | Injected |
| APPWRITE_API_KEY | Yes | Functions write + DB + storage |
| APPWRITE_DATABASE_ID | Yes | Database that holds prescriptions |
| APPWRITE_RX_BUCKET | No | Default `prescription-images` |
| GCP_PROJECT / MODEL_VERSION | No | Vertex / MedGemma hook |

Source in this monorepo: `functions/ocr-prescription-parser`.
