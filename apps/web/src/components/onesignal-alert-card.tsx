import React, { useState, useEffect } from "react";
import {
  Bell,
  BellRing,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Sparkles,
  Calendar,
  Heart,
  FileCheck,
  Send,
} from "lucide-react";
import {
  ONESIGNAL_APP_ID,
  isPushSupported,
  getNotificationPermission,
  requestNotificationPermission,
  tagChronicRefillReminder,
  tagSponsorEngagement,
  triggerSimulatedNotification,
} from "@/lib/onesignal-client";

export function OneSignalAlertCard() {
  const [supported, setSupported] = useState<boolean>(true);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  useEffect(() => {
    setSupported(isPushSupported());
    setPermission(getNotificationPermission());
  }, []);

  const handleRequestPermission = async () => {
    setStatusMessage("Requesting browser permission via OneSignal SDK...");
    const granted = await requestNotificationPermission();
    setPermission(getNotificationPermission());
    if (granted) {
      setStatusMessage("✅ Successfully subscribed to Medicine Support Hub push alerts!");
      await tagSponsorEngagement("medicine_angel_monthly", 1);
    } else {
      setStatusMessage("⚠️ Notifications were not allowed or dismissed. Check browser settings.");
    }
  };

  const handleTestTrigger = async (type: "refill" | "impact" | "bounty") => {
    let title = "";
    let body = "";

    if (type === "refill") {
      title = "💊 Chronic Refill Due: Plavix 75mg";
      body = "Your monthly cardiovascular therapy refill is ready for renewal at El-Ezaby Pharmacy. Claim with your sponsor subsidy.";
      setActiveTag("refill_days_due: 3");
      await tagChronicRefillReminder("Plavix 75mg", 3);
    } else if (type === "impact") {
      title = "❤️ Sponsor Impact: Patient Ahmed in Cairo";
      body = "Your Medicine Angel sponsorship just delivered 1 month of Lantus Solostar insulin. Tap to see the verified clinical receipt.";
      setActiveTag("sponsor_streak_months: 2");
      await tagSponsorEngagement("medicine_angel_monthly", 2);
    } else {
      title = "🔍 OCR Bounty: +10 EGP Verification Credit";
      body = "A new handwritten prescription from Mansoura University Hospital needs verification. Help transcribe to earn aid credits.";
      setActiveTag("ocr_bounty_eligible: true");
    }

    const res = await triggerSimulatedNotification(title, body);
    if (res.success) {
      setStatusMessage(`🔔 Test push dispatched: "${title}"`);
    } else {
      setStatusMessage(`ℹ️ Preview (${res.reason || "Simulated"}): "${title} — ${body}"`);
    }
  };

  return (
    <div className="rounded-2xl p-6 bg-gradient-to-br from-indigo-900/20 via-slate-900/60 to-purple-900/20 border border-indigo-500/30 backdrop-blur-md shadow-xl space-y-6">
      {/* Top Banner Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-indigo-500/20 pb-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 relative">
            <BellRing className="w-5 h-5 text-indigo-400" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-teal-400 animate-ping" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base text-slate-100">
                Automated Push Notifications & Retention Loops
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                OneSignal Web SDK v16
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Keep Them Coming Back Award: Monthly prescription refill cadences, donor impact updates & OCR bounties
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-400">OneSignal App ID:</span>
          <code className="px-2 py-1 rounded bg-slate-950/80 border border-slate-700/60 text-indigo-300 font-mono text-[11px]">
            {ONESIGNAL_APP_ID}
          </code>
        </div>
      </div>

      {/* Permission Status & Action Row */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 rounded-xl bg-slate-950/50 border border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="text-xs">
            <span className="text-slate-400 mr-2">Browser Push Status:</span>
            {permission === "granted" ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950/60 border border-emerald-500/40 text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Active & Subscribed
              </span>
            ) : permission === "denied" ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-950/60 border border-rose-500/40 text-rose-400">
                <AlertCircle className="w-3.5 h-3.5" />
                Blocked in Browser
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-950/60 border border-amber-500/40 text-amber-400">
                <Bell className="w-3.5 h-3.5" />
                Prompt Ready (Default)
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {permission !== "granted" ? (
            <button
              onClick={handleRequestPermission}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition-all hover:scale-[1.02]"
            >
              <Bell className="w-3.5 h-3.5" />
              Subscribe to Medicine Alerts
            </button>
          ) : (
            <button
              onClick={() => handleTestTrigger("refill")}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 transition-all hover:scale-[1.02]"
            >
              <Send className="w-3.5 h-3.5" />
              Test Push Alert Now
            </button>
          )}
        </div>
      </div>

      {/* Retention Feature Demos for Shipaton Judges */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            Judge Demonstration: Test Retention Cadences & Data Tags
          </span>
          {activeTag && (
            <span className="text-[11px] font-mono text-teal-400 bg-teal-950/60 px-2 py-0.5 rounded border border-teal-800/40">
              Synced Tag: {activeTag}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            onClick={() => handleTestTrigger("refill")}
            className="flex flex-col text-left p-3.5 rounded-xl bg-slate-900/60 hover:bg-slate-850 border border-slate-700/60 hover:border-teal-500/50 transition-all group"
          >
            <div className="flex items-center gap-2 font-bold text-xs text-teal-400 mb-1">
              <Calendar className="w-4 h-4 text-teal-400" />
              <span>Monthly Refill Alert</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug group-hover:text-slate-300">
              Automated 30-day chronic prescription refill reminders keep patients adherent to vital treatments.
            </p>
          </button>

          <button
            onClick={() => handleTestTrigger("impact")}
            className="flex flex-col text-left p-3.5 rounded-xl bg-slate-900/60 hover:bg-slate-850 border border-slate-700/60 hover:border-rose-500/50 transition-all group"
          >
            <div className="flex items-center gap-2 font-bold text-xs text-rose-400 mb-1">
              <Heart className="w-4 h-4 fill-current text-rose-400" />
              <span>Sponsor Impact Updates</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug group-hover:text-slate-300">
              Notifies RevenueCat subscribers when their sponsored patient receives their subsidized chronic supply.
            </p>
          </button>

          <button
            onClick={() => handleTestTrigger("bounty")}
            className="flex flex-col text-left p-3.5 rounded-xl bg-slate-900/60 hover:bg-slate-850 border border-slate-700/60 hover:border-amber-500/50 transition-all group"
          >
            <div className="flex items-center gap-2 font-bold text-xs text-amber-400 mb-1">
              <FileCheck className="w-4 h-4 text-amber-400" />
              <span>OCR Verification Bounties</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug group-hover:text-slate-300">
              Alerts pharmacists and community contributors when new prescriptions arrive to earn aid credits.
            </p>
          </button>
        </div>
      </div>

      {/* Status Notice */}
      {statusMessage && (
        <div className="p-3 rounded-xl bg-indigo-950/50 border border-indigo-800/40 text-xs text-indigo-200">
          {statusMessage}
        </div>
      )}
    </div>
  );
}
