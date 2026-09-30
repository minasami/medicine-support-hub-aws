import React, { useState, useEffect } from "react";
import {
  SPONSORSHIP_TIERS,
  SponsorshipTier,
  revenueCat,
  RevenueCatState,
} from "@/lib/revenuecat-client";
import { RevenueCatPaywallModal } from "@/components/revenuecat-paywall-modal";
import { PublicHealthAdBanner } from "@/components/public-health-ad-banner";
import { OneSignalAlertCard } from "@/components/onesignal-alert-card";
import {
  Heart,
  Shield,
  Sparkles,
  CheckCircle2,
  Gift,
  Activity,
  ArrowRight,
  ExternalLink,
  Users,
  Coins,
  FileCheck,
  Trophy,
} from "lucide-react";

export default function SponsorPortal() {
  const [rcState, setRcState] = useState<RevenueCatState>(revenueCat.getState());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTierId, setSelectedTierId] = useState<string>("medicine_angel_monthly");
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  useEffect(() => {
    setRcState(revenueCat.getState());
  }, []);

  const handleOpenPaywall = (tierId: string) => {
    setSelectedTierId(tierId);
    setIsModalOpen(true);
  };

  const handleQuickUnlock = () => {
    const res = revenueCat.redeemPromoCode("SHIPATON2026");
    setRcState(revenueCat.getState());
    setActionNotice(res.message);
  };

  const handleReset = () => {
    revenueCat.clearEntitlements();
    setRcState(revenueCat.getState());
    setActionNotice("Entitlements reset to initial state.");
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-10">
        {/* Breadcrumb & Badges */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-teal-100 dark:bg-teal-900/60 text-teal-800 dark:text-teal-200">
              <Heart className="w-3.5 h-3.5 fill-current text-rose-500" />
              Humanitarian Impact
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200">
              <Sparkles className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              RevenueCat Shipaton 2026
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">Hackathon Track:</span>
            <span className="font-bold text-teal-600 dark:text-teal-400">Next Gen Student Award</span>
          </div>
        </div>

        {/* Hero Section */}
        <div className="text-center space-y-4 max-w-3xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-teal-600 via-cyan-600 to-blue-600 bg-clip-text text-transparent">
            Medicine Support Hub: Sponsor an Egyptian Patient
          </h1>
          <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed">
            Recurring monthly sponsorships powered by <strong>RevenueCat</strong> directly fund verified chronic medications at Egyptian Drug Authority (EDA) official price caps.
          </p>

          <div className="flex flex-wrap justify-center gap-4 pt-2">
            <button
              onClick={() => handleOpenPaywall("medicine_angel_monthly")}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white shadow-lg shadow-teal-600/20 transition-all hover:scale-[1.02]"
            >
              <Heart className="w-4 h-4 fill-current text-white" />
              Open RevenueCat Paywall
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={handleQuickUnlock}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 shadow-sm transition-all"
            >
              <Gift className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              Judge Quick Unlock (SHIPATON2026)
            </button>
          </div>
        </div>

        {/* Action Notice */}
        {actionNotice && (
          <div className="p-4 rounded-xl bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 text-xs text-teal-800 dark:text-teal-200 flex items-center justify-between">
            <span>{actionNotice}</span>
            <button onClick={() => setActionNotice(null)} className="font-bold underline ml-2">
              Dismiss
            </button>
          </div>
        )}

        {/* RevenueCat Live Telemetry Card */}
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-amber-500 flex items-center justify-center text-white font-bold shadow-md">
                RC
              </div>
              <div>
                <h3 className="font-bold text-sm">RevenueCat In-App Purchases Engine</h3>
                <p className="text-xs text-slate-500">Cross-Platform Web, iOS & Android Subscription Layer</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">SDK Active</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60">
              <span className="text-slate-500 block mb-1">Project ID</span>
              <span className="font-mono font-semibold text-teal-600 dark:text-teal-400">{rcState.projectId}</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60">
              <span className="text-slate-500 block mb-1">Subscriber ID</span>
              <span className="font-mono font-semibold truncate block">{rcState.appUserId}</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60">
              <span className="text-slate-500 block mb-1">Active Entitlements</span>
              <span className="font-semibold text-teal-600 dark:text-teal-400">
                {rcState.activeEntitlements.length > 0
                  ? rcState.activeEntitlements.join(", ")
                  : "None (Free tier)"}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between">
              <div>
                <span className="text-slate-500 block mb-1">Testing Mode</span>
                <span className="font-semibold text-amber-600 dark:text-amber-400">Sandbox / Simulator</span>
              </div>
              {rcState.activeEntitlements.length > 0 && (
                <button
                  onClick={handleReset}
                  className="text-[11px] text-rose-600 dark:text-rose-400 underline font-medium"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Public Health Sponsor Ad Banner (RevenueCat Hybrid Monetization & Catvertising) */}
        <PublicHealthAdBanner
          rcState={rcState}
          onOpenPaywall={() => handleOpenPaywall("patient_sponsor_monthly")}
          onStateChange={() => setRcState(revenueCat.getState())}
        />

        {/* Sponsorship Packages Grid */}
        <div className="space-y-4">
          <div className="text-center">
            <h2 className="text-2xl font-bold">Choose Your Sponsorship Impact</h2>
            <p className="text-xs text-slate-500 mt-1">
              All plans include transparent prescription tracking and official Egyptian Drug Authority price audits.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {SPONSORSHIP_TIERS.map((tier) => {
              const isPurchased = rcState.activeEntitlements.includes(tier.entitlement);

              return (
                <div
                  key={tier.id}
                  className={`rounded-2xl p-6 border transition-all flex flex-col justify-between ${
                    tier.isPopular
                      ? "border-teal-500 bg-white dark:bg-slate-900 shadow-xl ring-2 ring-teal-500/20 relative"
                      : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm"
                  }`}
                >
                  {tier.isPopular && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow">
                      Most Popular
                    </span>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-bold text-lg">{tier.titleEn}</h3>
                      <span className="text-xs text-slate-500 font-arabic font-medium">{tier.titleAr}</span>
                    </div>

                    <div className="flex items-baseline gap-1 mb-4">
                      <span className="text-3xl font-extrabold tracking-tight">${tier.priceUsd}</span>
                      <span className="text-xs text-slate-500">/{tier.periodEn}</span>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 min-h-[36px]">
                      {tier.descriptionEn}
                    </p>

                    <div className="p-2.5 rounded-lg bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800/80 mb-5">
                      <span className="text-xs font-semibold text-teal-800 dark:text-teal-200 block">
                        {tier.impactBadgeEn}
                      </span>
                      <span className="text-[11px] text-teal-600 dark:text-teal-400 font-arabic block mt-0.5">
                        {tier.impactBadgeAr}
                      </span>
                    </div>

                    <div className="space-y-2.5 mb-6 text-xs">
                      {tier.featuresEn.map((f, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
                          <span className="text-slate-700 dark:text-slate-300">{f}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => handleOpenPaywall(tier.id)}
                    className={`w-full py-3 px-4 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 ${
                      isPurchased
                        ? "bg-emerald-600 text-white shadow"
                        : tier.isPopular
                        ? "bg-teal-600 hover:bg-teal-700 text-white shadow-md shadow-teal-600/20"
                        : "bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-800 dark:hover:bg-slate-700"
                    }`}
                  >
                    <Heart className="w-4 h-4 fill-current" />
                    {isPurchased ? "Active Entitlement Unlocked" : `Subscribe via RevenueCat ($${tier.priceUsd})`}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Impact Simulator Section */}
        <div className="p-8 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-teal-950 text-white space-y-6 shadow-xl">
          <div className="max-w-2xl">
            <span className="text-xs uppercase tracking-wider font-semibold text-teal-400 block mb-1">
              Real-World Translation
            </span>
            <h3 className="text-2xl font-bold">What Your Sponsorship Actually Buys in Egypt</h3>
            <p className="text-xs text-slate-300 mt-1">
              Unlike traditional charities with high administrative overhead, Medicine Support Hub uses RevenueCat subscriptions to directly fulfill pharmacy dispensary orders at legally capped prices.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-4 rounded-xl bg-white/10 backdrop-blur-md border border-white/10 space-y-2">
              <Coins className="w-5 h-5 text-amber-300" />
              <h4 className="font-bold text-sm">Concor 5mg (Bisoprolol)</h4>
              <p className="text-slate-300">
                Official EDA Price: <strong>65 EGP (~$1.35)</strong>. A $4.99 monthly sponsorship provides a 3-month supply of chronic hypertension medication.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white/10 backdrop-blur-md border border-white/10 space-y-2">
              <Activity className="w-5 h-5 text-rose-300" />
              <h4 className="font-bold text-sm">Insulin Mixtard 30</h4>
              <p className="text-slate-300">
                Essential life-saving diabetes therapy. A $14.99 monthly sponsorship covers 2 full cartridges and injection needles with temperature-controlled delivery.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white/10 backdrop-blur-md border border-white/10 space-y-2">
              <FileCheck className="w-5 h-5 text-teal-300" />
              <h4 className="font-bold text-sm">Bedrock AI Safety Scans</h4>
              <p className="text-slate-300">
                Prevents accidental toxicity by checking bioequivalent generic alternatives (e.g. Megamox for Augmentin) across 17,000+ national monographs.
              </p>
            </div>
          </div>
        </div>

        {/* OneSignal Automated Retention & Refill Alerts Card */}
        <OneSignalAlertCard />

        {/* Gamified Community Verification & Donor Streaks Section */}
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
                <Trophy className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm">Gamified Verification & Donor Streaks</h3>
                <p className="text-xs text-slate-500">Crowdsourced Clinical Active Learning & Corporate CSR Leaderboards</p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-xs font-semibold">
              Roadmap & Active Beta
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 space-y-1.5">
              <div className="flex items-center gap-2 text-teal-600 dark:text-teal-400 font-bold">
                <FileCheck className="w-4 h-4" />
                <span>Prescription OCR Bounties</span>
              </div>
              <p className="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                Pharmacists and students compete to decode handwritten Egyptian prescriptions, earning Clinical Trust XP and sponsor bounties.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 space-y-1.5">
              <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-bold">
                <Heart className="w-4 h-4 fill-current" />
                <span>Life Saver Donor Streaks</span>
              </div>
              <p className="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                Continuous RevenueCat subscribers unlock Bronze, Silver, Gold, and Platinum Angel badges with transparent impact milestones.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 space-y-1.5">
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-bold">
                <Users className="w-4 h-4" />
                <span>Corporate CSR Leaderboard</span>
              </div>
              <p className="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                Pharmaceutical manufacturers and pharmacy chains compete publicly on chronic patient months sponsored and verified.
              </p>
            </div>
          </div>
        </div>

        {/* Footer info for Hackathon Judges */}
        <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-900/40 text-center text-xs text-slate-500">
          <span>
            Medicine Support Hub is competing in the <strong>RevenueCat Shipaton 2026</strong> (Next Gen Award Track).
          </span>{" "}
          <a
            href="https://revenuecat-shipaton-2026.devpost.com/"
            target="_blank"
            rel="noreferrer"
            className="text-teal-600 dark:text-teal-400 underline inline-flex items-center gap-1 font-semibold ml-1"
          >
            Devpost Hackathon Page <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Paywall Modal */}
      <RevenueCatPaywallModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setRcState(revenueCat.getState());
        }}
        defaultTierId={selectedTierId}
      />
    </div>
  );
}
