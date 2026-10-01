import { Purchases, LogLevel } from "@revenuecat/purchases-js";
import { EntitlementStore } from "./revenuecat-access.mjs";

export interface SponsorshipTier {
  id: string;
  identifier: string;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  priceUsd: number;
  periodEn: string;
  periodAr: string;
  entitlement: string;
  isPopular?: boolean;
  impactBadgeEn: string;
  impactBadgeAr: string;
  featuresEn: string[];
  featuresAr: string[];
}


export const SPONSORSHIP_TIERS: SponsorshipTier[] = [
  {
    "id": "patient_sponsor_monthly",
    "identifier": "tier_patient_sponsor",
    "titleEn": "Patient Sponsor",
    "titleAr": "كفيل مريض",
    "descriptionEn": "Prototype subscription tier. No medicine delivery or treatment outcome is guaranteed.",
    "descriptionAr": "خطة اشتراك تجريبية. لا تضمن توصيل أدوية أو نتيجة علاجية.",
    "priceUsd": 4.99,
    "periodEn": "month",
    "periodAr": "شهر",
    "entitlement": "patient_sponsor",
    "impactBadgeEn": "Prototype · No patient allocation",
    "impactBadgeAr": "نموذج تجريبي · دون تخصيص مرضى",
    "featuresEn": [
      "RevenueCat entitlement status",
      "Pricing and any trial are confirmed at checkout",
      "Pharmacy fulfillment and impact reporting are planned"
    ],
    "featuresAr": [
      "حالة صلاحية الاشتراك من RevenueCat",
      "السعر وأي فترة تجريبية يؤكدان عند الدفع",
      "تنفيذ الطلبات وتقارير الأثر قيد التخطيط"
    ],
    "isPopular": false
  },
  {
    "id": "medicine_angel_monthly",
    "identifier": "tier_medicine_angel",
    "titleEn": "Medicine Angel",
    "titleAr": "ملاك الدواء",
    "descriptionEn": "Prototype subscription tier. No medicine delivery or treatment outcome is guaranteed.",
    "descriptionAr": "خطة اشتراك تجريبية. لا تضمن توصيل أدوية أو نتيجة علاجية.",
    "priceUsd": 14.99,
    "periodEn": "month",
    "periodAr": "شهر",
    "entitlement": "medicine_angel",
    "isPopular": false,
    "impactBadgeEn": "Prototype · No patient allocation",
    "impactBadgeAr": "نموذج تجريبي · دون تخصيص مرضى",
    "featuresEn": [
      "RevenueCat entitlement status",
      "Pricing and any trial are confirmed at checkout",
      "Pharmacy fulfillment and impact reporting are planned"
    ],
    "featuresAr": [
      "حالة صلاحية الاشتراك من RevenueCat",
      "السعر وأي فترة تجريبية يؤكدان عند الدفع",
      "تنفيذ الطلبات وتقارير الأثر قيد التخطيط"
    ]
  },
  {
    "id": "clinical_pro_annual",
    "identifier": "tier_clinical_pro_annual",
    "titleEn": "Annual Healthcare Patron",
    "titleAr": "راعي الرعاية الصحية السنوي",
    "descriptionEn": "Prototype subscription tier. No medicine delivery or treatment outcome is guaranteed.",
    "descriptionAr": "خطة اشتراك تجريبية. لا تضمن توصيل أدوية أو نتيجة علاجية.",
    "priceUsd": 49.99,
    "periodEn": "year",
    "periodAr": "سنة",
    "entitlement": "clinical_pro",
    "impactBadgeEn": "Prototype · No patient allocation",
    "impactBadgeAr": "نموذج تجريبي · دون تخصيص مرضى",
    "featuresEn": [
      "RevenueCat entitlement status",
      "Pricing and any trial are confirmed at checkout",
      "Pharmacy fulfillment and impact reporting are planned"
    ],
    "featuresAr": [
      "حالة صلاحية الاشتراك من RevenueCat",
      "السعر وأي فترة تجريبية يؤكدان عند الدفع",
      "تنفيذ الطلبات وتقارير الأثر قيد التخطيط"
    ],
    "isPopular": false
  }
];

export interface RevenueCatState {
  isConfigured: boolean;
  isSandbox: boolean;
  environment: "unknown" | "sandbox" | "production" | "mixed";
  projectId: string;
  appUserId: string;
  activeEntitlements: string[];
  demoEntitlements: string[];
  isAdFree: boolean;
  rewardedAdCredits: number;
  checkoutEnabled: boolean;
  error?: string;
}

const env = import.meta.env;
export const RC_PROJECT_ID = env.VITE_REVENUECAT_PROJECT_ID || "proj8b481083";

class RevenueCatService {
  private client: Purchases | null = null;
  private access = new EntitlementStore(null);
  private appUserId = "";
  private demoEntitlements: string[] = [];
  private demoViews = 0;
  private error: string | undefined;
  private listeners = new Set<() => void>();
  private checkoutEnabled = env.VITE_REVENUECAT_CHECKOUT_ENABLED === "true";

  constructor() {
    if (typeof window === "undefined") return;
    try {
      // Persist identity only. Never restore access from browser storage.
      const identityKey = "msh_rc_anonymous_user_v1";
      this.appUserId = localStorage.getItem(identityKey) || crypto.randomUUID();
      localStorage.setItem(identityKey, this.appUserId);
      localStorage.removeItem("msh_revenuecat_demo_entitlements");
      localStorage.removeItem("msh_rewarded_ad_credits");
      const apiKey = env.VITE_REVENUECAT_PUBLIC_API_KEY;
      if (!apiKey || apiKey === "rcb_test_msh_shipaton_2026") {
        throw new Error("Subscription service is not configured. Demo preview remains available.");
      }
      Purchases.setLogLevel(LogLevel.Warn);
      this.client = Purchases.configure({ apiKey, appUserId: this.appUserId });
      this.access = new EntitlementStore(this.client);
    } catch {
      this.error = "Subscription service is unavailable. No paid access has been granted.";
    }
  }

  private emit() { this.listeners.forEach(listener => listener()); }
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  public getState(): RevenueCatState {
    const active = this.access.snapshot();
    const entries = Object.values(active);
    const sandbox = entries.filter(entry => entry.isSandbox).length;
    const environment = !entries.length ? "unknown" :
      sandbox === entries.length ? "sandbox" : sandbox === 0 ? "production" : "mixed";
    return {
      isConfigured: this.client !== null,
      isSandbox: environment === "sandbox",
      environment,
      projectId: RC_PROJECT_ID,
      appUserId: this.appUserId,
      activeEntitlements: Object.keys(active),
      demoEntitlements: [...this.demoEntitlements],
      isAdFree: Object.hasOwn(active, "ad_free"),
      rewardedAdCredits: this.demoViews,
      checkoutEnabled: this.checkoutEnabled && this.client !== null,
      error: this.error,
    };
  }

  public async refresh(): Promise<void> {
    try {
      await this.access.refresh();
      this.error = undefined;
    } catch {
      this.error = "Unable to verify subscription access. Please retry.";
    }
    this.emit();
  }

  public async purchaseTier(tier: SponsorshipTier): Promise<{ success: boolean; entitlement: string }> {
    if (!this.checkoutEnabled) throw new Error("Checkout is disabled for this prototype.");
    try {
      const result = await this.access.purchase(tier);
      this.error = undefined;
      return result;
    } catch {
      this.error = "Checkout was cancelled or could not be verified. No new access was granted. Refresh before retrying.";
      throw new Error(this.error);
    } finally {
      this.emit();
    }
  }

  public redeemPromoCode(code: string): { success: boolean; message: string } {
    if (code.trim().toUpperCase() !== "SHIPATON2026") {
      return { success: false, message: "Unknown demo code." };
    }
    this.demoEntitlements = ["patient_sponsor", "medicine_angel", "clinical_pro", "ad_free"];
    this.emit();
    return { success: true, message: "Demo preview enabled. No purchase, trial, paid access, donation or patient allocation was created." };
  }

  public clearEntitlements() {
    this.demoEntitlements = [];
    this.demoViews = 0;
    this.emit();
  }

  public recordRewardedAd(): { credits: number; message: string } {
    this.demoViews += 1;
    this.emit();
    return { credits: this.demoViews, message: "Demo message viewed. No ad revenue, donation or monetary credit was generated." };
  }
}

export const revenueCat = new RevenueCatService();
