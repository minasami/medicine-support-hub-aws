import type { Purchases } from "@revenuecat/purchases-js";
type Adapter = Pick<Purchases, "getCustomerInfo" | "getOfferings" | "purchase">;
export class EntitlementStore {
  constructor(adapter: Adapter | null, now?: () => number);
  snapshot(): Record<string, { isSandbox: boolean; expirationDate: Date | null; isActive: boolean }>;
  refresh(): Promise<ReturnType<EntitlementStore["snapshot"]>>;
  purchase(tier: { identifier: string; entitlement: string }): Promise<{ success: boolean; entitlement: string }>;
}
