# OneSignal Web Push Integration

> **RevenueCat Shipaton 2026** — *Keep Them Coming Back Award* Track  
> **OneSignal App ID:** `5410295e-f7e9-4ba8-affb-04d7201f3f69`  
> **Official SDK Documentation:** [OneSignal Web SDK Setup](https://documentation.onesignal.com/docs/en/web-sdk-setup)  

---

## 1. Overview & Architecture

Medicine Support Hub uses the **OneSignal Web Push SDK (v16)** to drive 30-day retention and patient adherence. The integration synchronizes patient therapy cycles with international diaspora micro-sponsors powered by RevenueCat.

### Architecture Components:
* **Service Worker:** [`apps/web/public/OneSignalSDKWorker.js`](../apps/web/public/OneSignalSDKWorker.js) served at the root origin (`/OneSignalSDKWorker.js`).
* **HTML Initialization:** [`apps/web/index.html`](../apps/web/index.html) loads the deferred v16 SDK loader with `allowLocalhostAsSecureOrigin: true` and active subscription bell widgets.
* **Client Helper:** [`apps/web/src/lib/onesignal-client.ts`](../apps/web/src/lib/onesignal-client.ts) provides typed helpers for requesting permissions, dispatching test notifications, and setting custom tags.
* **Interactive UI Component:** [`apps/web/src/components/onesignal-alert-card.tsx`](../apps/web/src/components/onesignal-alert-card.tsx) embedded in the Sponsor Portal (`/sponsor`) for live judge evaluation and demonstration.

---

## 2. Retention Loops ("Keep Them Coming Back")

### Loop 1: Monthly Chronic Prescription Refill Cadence
* **Problem:** Patients with cardiovascular diseases, hypertension, and diabetes frequently run out of critical medication before refilling.
* **Solution:** OneSignal tags users with `refill_medicine` and `refill_days_due`. An automated 30-day push sequence prompts the patient to renew their subsidized prescription 3 days before expiry.

### Loop 2: Sponsor Impact & Donor Streaks
* **Problem:** Charity micro-donors often experience donor fatigue and drop off after a single donation.
* **Solution:** Real-time push updates inform RevenueCat subscribers the moment their patient receives subsidized medicine (e.g. "Ahmed in Cairo received 1 month of Lantus insulin"). Milestone alerts celebrate 30-day, 90-day, and 1-year donor streaks.

### Loop 3: Gamified OCR Prescription Bounties
* **Problem:** Transcribing doctor handwriting requires continuous expert verification.
* **Solution:** Registered pharmacists receive instant push notifications when new prescriptions are uploaded, earning aid credits and community trust XP.

---

## 3. How to Verify
1. Visit the live Sponsor Portal: [https://main.d24cynqfuktylf.amplifyapp.com/sponsor](https://main.d24cynqfuktylf.amplifyapp.com/sponsor)
2. Scroll to the **"Automated Push Notifications & Retention Loops"** card.
3. Click **"Subscribe to Medicine Alerts"** to grant browser notification permission.
4. Click any of the three retention demo triggers:
   * **Monthly Refill Alert**
   * **Sponsor Impact Updates**
   * **OCR Verification Bounties**
