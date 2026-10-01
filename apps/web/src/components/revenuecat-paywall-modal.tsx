import React, { useEffect, useState } from "react";
import { SPONSORSHIP_TIERS, revenueCat } from "@/lib/revenuecat-client";

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTierId?: string;
}

export function RevenueCatPaywallModal({ isOpen, onClose, defaultTierId }: PaywallModalProps) {
  const [state, setState] = useState(revenueCat.getState());
  const [tierId, setTierId] = useState(defaultTierId || SPONSORSHIP_TIERS[0].id);
  const [processing, setProcessing] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => revenueCat.subscribe(() => setState(revenueCat.getState())), []);
  useEffect(() => {
    if (!isOpen) return;
    setTierId(defaultTierId || SPONSORSHIP_TIERS[0].id);
    setNotice("");
    void revenueCat.refresh();
  }, [isOpen, defaultTierId]);
  if (!isOpen) return null;
  const tier = SPONSORSHIP_TIERS.find(item => item.id === tierId) || SPONSORSHIP_TIERS[0];
  const subscribed = state.activeEntitlements.includes(tier.entitlement);

  async function purchase() {
    setProcessing(true);
    setNotice("");
    try {
      await revenueCat.purchaseTier(tier);
      setNotice("RevenueCat confirmed the selected entitlement. This is not evidence of medicine delivery or funding.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to verify purchase.");
    } finally {
      setProcessing(false);
      setState(revenueCat.getState());
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="subscription-title"
        className="w-full max-w-xl rounded-2xl bg-white p-6 text-slate-900 shadow-xl dark:bg-slate-900 dark:text-white space-y-5">
        <div className="flex items-center justify-between">
          <h2 id="subscription-title" className="text-xl font-bold">Subscription prototype</h2>
          <button onClick={onClose} disabled={processing} aria-label="Close subscription dialog">Close</button>
        </div>
        <p>No medicine delivery, patient allocation or clinical outcome is promised by this prototype.</p>
        <label className="block">Plan
          <select className="block w-full rounded border p-2 text-slate-900" value={tierId}
            disabled={processing} onChange={event => setTierId(event.target.value)}>
            {SPONSORSHIP_TIERS.map(item => <option key={item.id} value={item.id}>{item.titleEn}</option>)}
          </select>
        </label>
        <p>Illustrative price: USD {tier.priceUsd}/{tier.periodEn}. The RevenueCat checkout shows the actual currency, price and any trial before confirmation.</p>
        {state.error && <p role="alert">{state.error}</p>}
        {!state.checkoutEnabled && <p>Checkout is disabled or not configured. Demo preview does not create paid access.</p>}
        <button className="rounded bg-teal-700 px-4 py-2 text-white disabled:opacity-50"
          disabled={processing || subscribed || !state.checkoutEnabled} onClick={() => void purchase()}>
          {processing ? "Waiting for checkout…" : subscribed ? "Entitlement verified" : "Continue to RevenueCat checkout"}
        </button>
        <div className="flex flex-wrap gap-4">
          <button disabled={processing} className="underline" onClick={() => void revenueCat.refresh()}>Refresh subscription access</button>
          <button disabled={processing} className="underline" onClick={() => setNotice(revenueCat.redeemPromoCode("SHIPATON2026").message)}>
            Preview demo tiers
          </button>
        </div>
        {state.demoEntitlements.length > 0 && <p>Demo tiers: {state.demoEntitlements.join(", ")}. Preview only; paid access remains independently verified.</p>}
        <p aria-live="polite">{notice}</p>
      </section>
    </div>
  );
}
