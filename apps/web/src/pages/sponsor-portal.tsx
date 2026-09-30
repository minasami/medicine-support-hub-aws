import React, { useEffect, useState } from "react";
import { SPONSORSHIP_TIERS, revenueCat } from "@/lib/revenuecat-client";
import { RevenueCatPaywallModal } from "@/components/revenuecat-paywall-modal";
import { PublicHealthAdBanner } from "@/components/public-health-ad-banner";
import { OneSignalAlertCard } from "@/components/onesignal-alert-card";

export default function SponsorPortal() {
  const [state, setState] = useState(revenueCat.getState());
  const [open, setOpen] = useState(false);
  const [tierId, setTierId] = useState(SPONSORSHIP_TIERS[0].id);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const unsubscribe = revenueCat.subscribe(() => setState(revenueCat.getState()));
    const refresh = () => { void revenueCat.refresh(); };
    refresh();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { unsubscribe(); window.removeEventListener("focus", refresh); window.clearInterval(timer); };
  }, []);
  const showPlan = (id: string) => { setTierId(id); setOpen(true); };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="space-y-4 text-center">
          <p className="font-semibold text-teal-700">Medicine Support Hub · Shipaton prototype</p>
          <h1 className="text-4xl font-bold">Explore recurring support for medicine access</h1>
          <p>Our goal is to connect supporters with medicine assistance programs. This prototype demonstrates subscription access and sample engagement flows.</p>
          <p className="rounded border border-amber-400 bg-amber-50 p-4 text-amber-950">
            No patient allocation, pharmacy payment, medicine delivery or treatment outcome is demonstrated here. Demo previews do not create purchases or donations.
          </p>
          <button className="rounded bg-teal-700 px-5 py-3 text-white" onClick={() => showPlan(tierId)}>Open subscription options</button>
          <button className="ml-4 underline" onClick={() => setNotice(revenueCat.redeemPromoCode("SHIPATON2026").message)}>Judge demo preview</button>
        </header>
        {notice && <p role="status">{notice}</p>}
        <section className="rounded-xl border p-6 space-y-3">
          <h2 className="text-xl font-bold">Subscription access</h2>
          <p>{state.isConfigured ? "SDK configured" : "SDK unavailable"} · Entitlement environment: {state.environment}</p>
          <p>Verified entitlements: {state.activeEntitlements.join(", ") || "None"}</p>
          <p>Project: {state.projectId} · Browser customer: {state.appUserId || "Unavailable"}</p>
          <p>Access reloads for this browser identity. Cross-device account linking is not implemented in this prototype.</p>
          {state.error && <p role="alert">{state.error}</p>}
          <button className="underline" onClick={() => void revenueCat.refresh()}>Refresh subscription access</button>
          {state.demoEntitlements.length > 0 && (
            <aside className="rounded border border-amber-400 p-3">
              <strong>Demo preview only</strong>
              <p>{state.demoEntitlements.join(", ")}</p>
              <p>These sample tiers are not verified entitlements and do not unlock paid features.</p>
              <button className="underline" onClick={() => revenueCat.clearEntitlements()}>Clear demo preview</button>
            </aside>
          )}
        </section>
        <section className="grid gap-4 md:grid-cols-3" aria-label="Prototype plans">
          {SPONSORSHIP_TIERS.map(tier => (
            <article key={tier.id} className="rounded-xl border bg-white p-6 dark:bg-slate-900 space-y-3">
              <h2 className="text-lg font-bold">{tier.titleEn}</h2>
              <p lang="ar" dir="rtl">{tier.titleAr}</p>
              <p>{tier.descriptionEn}</p>
              <p>Illustrative price: USD {tier.priceUsd}/{tier.periodEn}. Final terms appear at checkout.</p>
              <p>{state.activeEntitlements.includes(tier.entitlement) ? "Verified entitlement" : "No verified access"}</p>
              <button className="rounded bg-teal-700 px-4 py-2 text-white" onClick={() => showPlan(tier.id)}>Review plan</button>
            </article>
          ))}
        </section>
        <PublicHealthAdBanner rcState={state} onOpenPaywall={() => showPlan(SPONSORSHIP_TIERS[0].id)}
          onStateChange={() => setState(revenueCat.getState())} />
        <OneSignalAlertCard />
        <section className="rounded-xl border p-6 space-y-3">
          <h2 className="text-xl font-bold">Planned medicine assistance workflow</h2>
          <p>Pharmacy partnerships, verified dispensing receipts, supporter impact reports and audited cost estimates are future work.</p>
          <p>Catalog matches are information for professional review, not proof of bioequivalence or a recommendation to change treatment. No certified clinical safety claim is made.</p>
          <p>AWS hosts this frontend. Appwrite remains the application backend; its database has not been migrated to AWS.</p>
        </section>
      </div>
      <RevenueCatPaywallModal isOpen={open} onClose={() => setOpen(false)} defaultTierId={tierId} />
    </main>
  );
}
