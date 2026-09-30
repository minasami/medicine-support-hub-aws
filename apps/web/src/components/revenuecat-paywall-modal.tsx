import React, { useState, useEffect } from "react";
import {
  SPONSORSHIP_TIERS,
  SponsorshipTier,
  revenueCat,
  RevenueCatState,
} from "@/lib/revenuecat-client";
import { Check, Heart, Shield, Sparkles, X, Gift, AlertCircle } from "lucide-react";

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTierId?: string;
}

export const RevenueCatPaywallModal: React.FC<PaywallModalProps> = ({
  isOpen,
  onClose,
  defaultTierId = "medicine_angel_monthly",
}) => {
  const [selectedTier, setSelectedTier] = useState<SponsorshipTier>(
    SPONSORSHIP_TIERS.find((t) => t.id === defaultTierId) || SPONSORSHIP_TIERS[1]
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoStatus, setPromoStatus] = useState<{ success?: boolean; message?: string } | null>(null);
  const [rcState, setRcState] = useState<RevenueCatState>(revenueCat.getState());

  useEffect(() => {
    setRcState(revenueCat.getState());
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubscribe = async (tier: SponsorshipTier) => {
    setIsProcessing(true);
    try {
      await revenueCat.purchaseTier(tier);
      setRcState(revenueCat.getState());
      setPromoStatus({
        success: true,
        message: `Subscription active! Thank you for sponsoring via RevenueCat (${tier.titleEn}).`,
      });
    } catch (err: any) {
      setPromoStatus({
        success: false,
        message: err?.message || "Failed to process subscription.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRedeemCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoCode.trim()) return;
    const res = revenueCat.redeemPromoCode(promoCode);
    setPromoStatus(res);
    setRcState(revenueCat.getState());
  };

  const isEntitled = (entitlement: string) => rcState.activeEntitlements.includes(entitlement);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-3xl my-8 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-slate-900 dark:text-slate-100">
        {/* Header Ribbon */}
        <div className="bg-gradient-to-r from-teal-600 via-cyan-600 to-blue-600 text-white p-6 relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full hover:bg-white/20 transition-colors text-white"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white/20 backdrop-blur-md tracking-wide">
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              RevenueCat Powered In-App Sponsorship
            </span>
            <span className="text-xs text-white/80 bg-black/20 px-2.5 py-1 rounded-full">
              Shipaton 2026
            </span>
          </div>

          <h2 className="text-2xl font-bold tracking-tight">
            Sponsor a Chronic Disease Patient in Egypt
          </h2>
          <p className="text-sm text-teal-100 mt-1 max-w-xl">
            Recurring sponsorships directly purchase vital chronic medications at official Egyptian Drug Authority (EDA) capped rates for vulnerable families.
          </p>
        </div>

        <div className="p-6 space-y-6">
          {/* Active Subscription Banner */}
          {rcState.activeEntitlements.length > 0 && (
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 flex items-start gap-3">
              <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
              <div className="text-xs">
                <span className="font-bold text-emerald-800 dark:text-emerald-200 text-sm block">
                  Active RevenueCat Entitlements Unlocked
                </span>
                <span className="text-emerald-700 dark:text-emerald-300">
                  Active tiers: {rcState.activeEntitlements.join(", ")} · App User ID: <code className="bg-emerald-100 dark:bg-emerald-900/50 px-1 py-0.5 rounded">{rcState.appUserId}</code>
                </span>
              </div>
            </div>
          )}

          {/* Pricing Tiers Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {SPONSORSHIP_TIERS.map((tier) => {
              const selected = selectedTier.id === tier.id;
              const hasTier = isEntitled(tier.entitlement);

              return (
                <div
                  key={tier.id}
                  onClick={() => setSelectedTier(tier)}
                  className={`cursor-pointer rounded-xl p-5 border transition-all relative flex flex-col justify-between ${
                    selected
                      ? "border-teal-500 bg-teal-50/50 dark:bg-teal-950/20 ring-2 ring-teal-500/30"
                      : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40"
                  }`}
                >
                  {tier.isPopular && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-sm">
                      Most Popular
                    </span>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-bold text-base">{tier.titleEn}</h3>
                      {hasTier && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300">
                          Active
                        </span>
                      )}
                    </div>

                    <div className="mb-3">
                      <span className="text-2xl font-extrabold tracking-tight">${tier.priceUsd}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">/{tier.periodEn}</span>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 min-h-[32px]">
                      {tier.descriptionEn}
                    </p>

                    <div className="text-[11px] font-medium text-teal-700 dark:text-teal-300 bg-teal-100/60 dark:bg-teal-900/40 px-2 py-1 rounded mb-4">
                      {tier.impactBadgeEn}
                    </div>

                    <ul className="space-y-2 text-xs mb-4">
                      {tier.featuresEn.map((f, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <Check className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
                          <span className="text-slate-700 dark:text-slate-300">{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <button
                    disabled={isProcessing}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSubscribe(tier);
                    }}
                    className={`w-full py-2.5 px-4 rounded-lg font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 ${
                      hasTier
                        ? "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                        : selected
                        ? "bg-teal-600 hover:bg-teal-700 text-white shadow"
                        : "bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200"
                    }`}
                  >
                    <Heart className="w-3.5 h-3.5 fill-current" />
                    {hasTier ? "Subscribed" : `Sponsor for $${tier.priceUsd}/${tier.periodEn}`}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Judge / Reviewer Promo Code Section */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs text-slate-600 dark:text-slate-400">
              <span className="font-semibold block text-slate-800 dark:text-slate-200 flex items-center gap-1">
                <Gift className="w-4 h-4 text-purple-600" />
                Devpost & RevenueCat Hackathon Judges:
              </span>
              Use promo code <code className="font-mono font-bold text-teal-600 bg-teal-50 dark:bg-teal-950 px-1 py-0.5 rounded border border-teal-200 dark:border-teal-800">SHIPATON2026</code> to unlock all tiers for testing.
            </div>

            <form onSubmit={handleRedeemCode} className="flex gap-2 w-full sm:w-auto">
              <input
                type="text"
                placeholder="Enter promo code"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500 w-full sm:w-36 font-mono uppercase"
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 text-white shrink-0"
              >
                Apply
              </button>
            </form>
          </div>

          {/* Feedback Alert */}
          {promoStatus && (
            <div
              className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
                promoStatus.success
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-300 dark:border-amber-800"
              }`}
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{promoStatus.message}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
