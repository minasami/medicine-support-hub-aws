import test from "node:test";
import { EntitlementStore } from "./revenuecat-access.mjs";

const assert = (condition, message = "Assertion failed") => { if (!condition) throw new Error(message); };
const info = (active = {}) => ({ entitlements: { active } });
const grant = (extra = {}) => ({ isActive: true, isSandbox: true, expirationDate: null, ...extra });
const tier = { identifier: "exact-plan", entitlement: "sponsor" };
const adapter = (overrides = {}) => ({
  getOfferings: async () => ({ current: { availablePackages: [{ identifier: "exact-plan" }] } }),
  getCustomerInfo: async () => info(),
  purchase: async () => ({ customerInfo: info({ sponsor: grant() }) }),
  ...overrides,
});
const rejects = async fn => { let failed = false; try { await fn(); } catch { failed = true; } assert(failed, "Expected rejection"); };
const empty = store => assert(Object.keys(store.snapshot()).length === 0, "Access should be empty");

const cases = [
  ["unconfigured purchase and refresh fail closed", async () => {
    const store = new EntitlementStore(null);
    await rejects(() => store.purchase(tier)); await rejects(() => store.refresh()); empty(store);
  }],
  ["missing package never starts checkout", async () => {
    let calls = 0;
    const store = new EntitlementStore(adapter({
      getOfferings: async () => ({ current: null }),
      purchase: async () => { calls++; return { customerInfo: info() }; },
    }));
    await rejects(() => store.purchase(tier)); assert(calls === 0); empty(store);
  }],
  ["substring package match is rejected", async () => {
    const store = new EntitlementStore(adapter({
      getOfferings: async () => ({ current: { availablePackages: [{ identifier: "prefix-exact-plan" }] } }),
    }));
    await rejects(() => store.purchase(tier)); empty(store);
  }],
  ["cancelled checkout grants nothing", async () => {
    const store = new EntitlementStore(adapter({ purchase: async () => { throw new Error("Cancelled"); } }));
    await rejects(() => store.purchase(tier)); empty(store);
  }],
  ["network failure grants nothing", async () => {
    const store = new EntitlementStore(adapter({ getOfferings: async () => { throw new Error("Offline"); } }));
    await rejects(() => store.purchase(tier)); empty(store);
  }],
  ["checkout without requested entitlement fails", async () => {
    const store = new EntitlementStore(adapter({ purchase: async () => ({ customerInfo: info({ unrelated: grant() }) }) }));
    await rejects(() => store.purchase(tier)); empty(store);
  }],
  ["successful purchase grants only provider entitlements", async () => {
    let selected;
    const store = new EntitlementStore(adapter({
      purchase: async ({ rcPackage }) => { selected = rcPackage.identifier; return { customerInfo: info({ sponsor: grant() }) }; },
    }));
    const result = await store.purchase(tier);
    assert(result.success && selected === tier.identifier);
    assert(Object.hasOwn(store.snapshot(), "sponsor"));
    assert(!Object.hasOwn(store.snapshot(), "ad_free"), "Do not infer ad_free");
  }],
  ["reload obtains entitlements from provider", async () => {
    const provider = adapter({ getCustomerInfo: async () => info({ sponsor: grant() }) });
    const reloaded = new EntitlementStore(provider); empty(reloaded);
    await reloaded.refresh(); assert(Object.hasOwn(reloaded.snapshot(), "sponsor"));
  }],
  ["revocation removes existing access", async () => {
    let current = info({ sponsor: grant() });
    const store = new EntitlementStore(adapter({ getCustomerInfo: async () => current }));
    await store.refresh(); current = info(); await store.refresh(); empty(store);
  }],
  ["refresh failure clears stale access", async () => {
    let offline = false;
    const store = new EntitlementStore(adapter({ getCustomerInfo: async () => {
      if (offline) throw new Error("Offline"); return info({ sponsor: grant() });
    }}));
    await store.refresh(); offline = true; await rejects(() => store.refresh()); empty(store);
  }],
  ["expired and inactive entitlements cannot unlock", async () => {
    let now = 1000;
    const store = new EntitlementStore(adapter({ getCustomerInfo: async () => info({
      sponsor: grant({ expirationDate: new Date(2000) }),
      inactive: grant({ isActive: false }),
      invalid: grant({ expirationDate: "invalid-date" }),
    }) }), () => now);
    await store.refresh(); assert(Object.keys(store.snapshot()).join() === "sponsor");
    now = 2000; empty(store);
  }],
  ["malformed response fails closed", async () => {
    const store = new EntitlementStore(adapter({ purchase: async () => ({ customerInfo: {} }) }));
    await rejects(() => store.purchase(tier)); empty(store);
  }],
  ["stale refresh cannot override newer revocation", async () => {
    let finish; let calls = 0;
    const store = new EntitlementStore(adapter({ getCustomerInfo: () => ++calls === 1
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(info()) }));
    const earlier = store.refresh(); await store.refresh();
    finish(info({ sponsor: grant() })); await earlier; empty(store);
  }],
  ["concurrent checkout is blocked", async () => {
    let finish; let calls = 0;
    const store = new EntitlementStore(adapter({ purchase: () => {
      calls++; return new Promise(resolve => { finish = resolve; });
    }}));
    const first = store.purchase(tier);
    await Promise.resolve();
    await rejects(() => store.purchase(tier)); assert(calls === 1);
    finish({ customerInfo: info({ sponsor: grant() }) }); await first;
  }],
  ["provider response mutation cannot add later access", async () => {
    const response = info({ sponsor: grant() });
    const store = new EntitlementStore(adapter({ getCustomerInfo: async () => response }));
    await store.refresh();
    response.entitlements.active.ad_free = grant();
    response.entitlements.active.sponsor.isActive = false;
    assert(Object.keys(store.snapshot()).join() === "sponsor");
  }],
];

for (const [name, run] of cases) test(name, run);
