import React, { useState } from "react";
import { revenueCat, type RevenueCatState } from "@/lib/revenuecat-client";
interface AdBannerProps {
  onOpenPaywall?: () => void;
  rcState: RevenueCatState;
  onStateChange: () => void;
}
export function PublicHealthAdBanner({ onOpenPaywall, rcState, onStateChange }: AdBannerProps) {
  const [message, setMessage] = useState("");
  if (rcState.isAdFree) return <section className="rounded-xl border p-4">
    RevenueCat verified the ad_free entitlement. The sample promotional panel is hidden.
  </section>;
  return <section className="rounded-xl border p-6 space-y-3">
    <h2 className="text-xl font-bold">Community message preview</h2>
    <p>This is a local interaction demo, not a served RevenueCat ad. It generates no revenue, donations or aid credits.</p>
    <button className="rounded border px-4 py-2" onClick={() => {
      setMessage(revenueCat.recordRewardedAd().message);
      onStateChange();
    }}>View sample message</button>
    <p>Demo views this session: {rcState.rewardedAdCredits}</p>
    <p role="status">{message}</p>
    <button className="underline" onClick={onOpenPaywall}>Review subscription options</button>
  </section>;
}
