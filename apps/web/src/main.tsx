import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App";
import "./index.css";
import "./mobile-platform.css";
import { installTolerantUrlInputs } from "./lib/url-inputs";

installTolerantUrlInputs();

// Appwrite serves generated static route entry points as directory URLs. Keep
// the browser URL aligned with Wouter's canonical route definitions.
if (window.location.pathname.length > 1 && window.location.pathname.endsWith("/")) {
  const canonicalPath = window.location.pathname.replace(/\/+$/, "");
  window.history.replaceState(null, document.title, `${canonicalPath}${window.location.search}${window.location.hash}`);
}

const isNativeCapacitor = Capacitor.isNativePlatform();

if ("serviceWorker" in navigator) {
  if (isNativeCapacitor) {
    // PWA SW on Capacitor local origins (legacy https://localhost or
    // https://app.medicinesupport.local) poisons WebView cache across Play
    // updates (stale index/chunks → blank white screen). Never register;
    // purge any leftover registration + Cache Storage from older builds.
    void (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      } catch (e) {
        console.warn("Capacitor SW unregister failed", e);
      }
      try {
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch (e) {
        console.warn("Capacitor cache clear failed", e);
      }
    })();
  } else {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
        console.warn("Medicine Support Hub service worker registration failed", error);
      });
    });
  }
}

function paintMountError(err: unknown) {
  const root = document.getElementById("root");
  if (!root) return;
  const message = err instanceof Error ? err.message : String(err);
  console.error("[MSH] createRoot / App mount failed", err);
  root.innerHTML = `
    <div id="msh-boot" class="msh-boot-error" role="alert" style="min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.5rem;padding:1.5rem;font-family:system-ui,sans-serif;color:#ecfdf5;text-align:center;background:#0f766e">
      <div style="font-size:1.05rem;font-weight:600">Something went wrong starting the app.</div>
      <div style="font-size:1rem;opacity:0.95;direction:rtl">حدث خطأ أثناء بدء التطبيق.</div>
      <div style="margin-top:0.35rem;font-size:0.85rem;opacity:0.9;max-width:22rem;line-height:1.4">${message.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string))}</div>
      <button type="button" onclick="location.reload()" style="margin-top:1rem;border:1px solid #a7f3d0;background:#ecfdf5;color:#0f766e;font:inherit;font-weight:600;padding:0.65rem 1.25rem;border-radius:0.5rem;cursor:pointer">Reload / إعادة التحميل</button>
    </div>
  `;
}

try {
  const el = document.getElementById("root");
  if (!el) {
    throw new Error("Missing #root element");
  }
  createRoot(el).render(<App />);
} catch (err) {
  paintMountError(err);
}
