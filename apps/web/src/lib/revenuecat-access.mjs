// RevenueCat is the only source of paid access. Browser demo data is never read here.
export class EntitlementStore {
  constructor(adapter, now = () => Date.now()) {
    this.adapter = adapter;
    this.now = now;
    this.active = {};
    this.version = 0;
    this.pendingPurchase = false;
  }
  accept(info) {
    if (!info || !info.entitlements || !info.entitlements.active ||
        typeof info.entitlements.active !== "object" || Array.isArray(info.entitlements.active)) {
      throw new Error("RevenueCat returned invalid customer information.");
    }
    this.active = Object.fromEntries(Object.entries(info.entitlements.active)
      .filter(([, value]) => value && value.isActive === true)
      .map(([key, value]) => [key, { ...value }]));
  }
  snapshot() {
    return Object.fromEntries(Object.entries(this.active).filter(([, value]) =>
      value.expirationDate == null || new Date(value.expirationDate).getTime() > this.now()));
  }
  async refresh() {
    const version = ++this.version;
    try {
      if (!this.adapter) throw new Error("RevenueCat is not configured.");
      const info = await this.adapter.getCustomerInfo();
      if (version === this.version) this.accept(info);
      return this.snapshot();
    } catch (error) {
      if (version === this.version) this.active = {};
      throw error;
    }
  }
  async purchase(tier) {
    if (this.pendingPurchase) throw new Error("A checkout is already in progress.");
    this.pendingPurchase = true;
    ++this.version; // Discard any older in-flight refresh.
    try {
      if (!this.adapter) throw new Error("RevenueCat is not configured.");
      const offerings = await this.adapter.getOfferings();
      const pkg = offerings.current?.availablePackages.find(p => p.identifier === tier.identifier);
      if (!pkg) throw new Error("This plan is unavailable. No purchase was started.");
      const result = await this.adapter.purchase({ rcPackage: pkg });
      ++this.version; // A checkout response supersedes refreshes started during checkout.
      this.accept(result.customerInfo);
      if (!Object.hasOwn(this.snapshot(), tier.entitlement)) {
        throw new Error("Checkout returned without the requested entitlement. Refresh access before retrying.");
      }
      return { success: true, entitlement: tier.entitlement };
    } catch (error) {
      ++this.version;
      this.active = {};
      throw error;
    } finally {
      this.pendingPurchase = false;
    }
  }
}
