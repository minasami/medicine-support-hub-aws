import React, { useState } from "react";
import { triggerSimulatedNotification } from "@/lib/onesignal-client";

export function OneSignalAlertCard() {
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function preview(kind: string) {
    setBusy(true);
    try {
      const result = await triggerSimulatedNotification(
        "Medicine Support Hub: demo " + kind,
        "Synthetic example only. No real prescription, payment, delivery or reward is associated with this notification."
      );
      setNotice(result.success
        ? "Local browser notification displayed. This does not verify a OneSignal campaign or remote push delivery."
        : "Preview unavailable: " + (result.reason || "Browser notifications unavailable."));
    } catch {
      setNotice("Unable to show the local notification preview.");
    } finally { setBusy(false); }
  }
  return <section className="rounded-xl border p-6 space-y-3">
    <h2 className="text-xl font-bold">Notification concept previews</h2>
    <p>These buttons request browser notification permission and display synthetic local examples. They do not schedule reminders, send remote campaigns, or record subscriber or patient tags.</p>
    <div className="flex flex-wrap gap-3">
      {["refill reminder", "supporter update", "verification task"].map(kind =>
        <button key={kind} disabled={busy} className="rounded border px-4 py-2 disabled:opacity-50"
          onClick={() => void preview(kind)}>Preview {kind}</button>)}
    </div>
    <p aria-live="polite">{notice}</p>
  </section>;
}
