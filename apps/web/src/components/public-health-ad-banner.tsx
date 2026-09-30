import React, { useState } from "react";
import { revenueCat, RevenueCatState } from "@/lib/revenuecat-client";
import { Sparkles, HeartHandshake, Play, CheckCircle2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AdBannerProps {
  onOpenPaywall?: () => void;
  rcState: RevenueCatState;
  onStateChange: () => void;
}

export const PublicHealthAdBanner: React.FC<AdBannerProps> = ({
  onOpenPaywall,
  rcState,
  onStateChange,
}) => {
  const [isPlayingAd, setIsPlayingAd] = useState(false);
  const [adSuccessMsg, setAdSuccessMsg] = useState<string | null>(null);

  const handleWatchRewardedAd = () => {
    setIsPlayingAd(true);
    setAdSuccessMsg(null);
    setTimeout(() => {
      setIsPlayingAd(false);
      const res = revenueCat.recordRewardedAd();
      setAdSuccessMsg(res.message);
      onStateChange();
    }, 2500);
  };

  if (rcState.isAdFree) {
    return (
      <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <span className="font-bold text-emerald-900 dark:text-emerald-200 block">
              Ad-Free Experience Active
            </span>
            <span className="text-emerald-700 dark:text-emerald-400">
              Unlocked via RevenueCat Sponsorship Entitlement (<code className="font-mono">ad_free</code>). 100% of platform features are uninterrupted.
            </span>
          </div>
        </div>
        <span className="px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-300 font-semibold text-[11px] shrink-0">
          RevenueCat Sponsor
        </span>
      </div>
    );
  }

  return (
    <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-teal-950 border border-teal-500/30 text-white shadow-lg space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
            Catvertising Public Health Partner
          </span>
          <span className="text-xs text-slate-400">
            Egyptian Cure Bank & SOUL Pharma Network
          </span>
        </div>
        <button
          onClick={onOpenPaywall}
          className="text-[11px] text-teal-300 hover:text-teal-200 underline font-medium flex items-center gap-1"
        >
          <Sparkles className="w-3 h-3" />
          Remove ads via RevenueCat
        </button>
      </div>

      <div className="space-y-1.5">
        <h4 className="font-bold text-sm text-white flex items-center gap-2">
          <HeartHandshake className="w-4 h-4 text-rose-400" />
          Free Chronic Disease Screening Initiative
        </h4>
        <p className="text-xs text-slate-300 leading-relaxed">
          Over 30% of Egyptian adults have undiagnosed hypertension. Visit participating community pharmacies for free blood pressure checks and official EDA-subsidized therapy reviews.
        </p>
      </div>

      {adSuccessMsg && (
        <div className="p-2.5 rounded-lg bg-teal-500/20 border border-teal-400/40 text-teal-200 text-xs flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" />
          <span>{adSuccessMsg}</span>
        </div>
      )}

      <div className="pt-1 border-t border-slate-700/60 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={handleWatchRewardedAd}
            disabled={isPlayingAd}
            className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs h-8"
          >
            {isPlayingAd ? (
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-950 animate-ping" />
                Viewing Partner Message (2s)...
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Play className="w-3 h-3 fill-current" />
                Watch Rewarded Ad (+0.50 EGP Aid)
              </span>
            )}
          </Button>

          {rcState.rewardedAdCredits > 0 && (
            <span className="text-[11px] text-emerald-400 font-mono">
              Total Community Aid Generated: {(rcState.rewardedAdCredits * 0.5).toFixed(2)} EGP
            </span>
          )}
        </div>

        <span className="text-[11px] text-slate-400">
          Subscribe for $4.99/mo to permanently remove ads & directly sponsor patients.
        </span>
      </div>
    </div>
  );
};
