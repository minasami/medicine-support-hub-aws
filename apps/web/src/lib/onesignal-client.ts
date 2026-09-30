/**
 * OneSignal Web Push SDK Client Integration
 * Hackathon Track: "Keep Them Coming Back Award" (RevenueCat Shipaton 2026)
 *
 * App ID: 5410295e-f7e9-4ba8-affb-04d7201f3f69
 * Documentation: https://documentation.onesignal.com/docs/en/web-sdk-setup
 */

export const ONESIGNAL_APP_ID = "5410295e-f7e9-4ba8-affb-04d7201f3f69";

declare global {
  interface Window {
    OneSignalDeferred?: Array<(OneSignal: any) => Promise<void> | void>;
    OneSignal?: any;
  }
}

/**
 * Checks whether Web Push Notifications and Service Workers are supported by the browser.
 */
export function isPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "Notification" in window && "serviceWorker" in navigator;
}

/**
 * Returns current browser notification permission status ('default' | 'granted' | 'denied' | 'unsupported').
 */
export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

/**
 * Requests browser push notification permission using OneSignal SDK or native Notification API fallback.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!isPushSupported()) {
    console.warn("[OneSignal] Push notifications not supported on this platform.");
    return false;
  }

  // Use OneSignal v16 Deferred queue if available
  if (window.OneSignalDeferred) {
    return new Promise((resolve) => {
      window.OneSignalDeferred!.push(async (OneSignal) => {
        try {
          if (OneSignal?.Notifications?.requestPermission) {
            await OneSignal.Notifications.requestPermission();
            const granted = Notification.permission === "granted";
            resolve(granted);
            return;
          }
        } catch (e) {
          console.warn("[OneSignal] Notifications.requestPermission error:", e);
        }
        // Fallback to native
        try {
          const res = await Notification.requestPermission();
          resolve(res === "granted");
        } catch {
          resolve(false);
        }
      });
    });
  }

  try {
    const res = await Notification.requestPermission();
    return res === "granted";
  } catch {
    return false;
  }
}

/**
 * Tags the subscriber with chronic prescription refill reminder metadata.
 * Powers automated 30-day retention re-engagement.
 */
export async function tagChronicRefillReminder(
  medicineName: string,
  daysUntilRefill: number
): Promise<void> {
  if (typeof window === "undefined" || !window.OneSignalDeferred) return;

  window.OneSignalDeferred.push(async (OneSignal) => {
    try {
      if (OneSignal?.User?.addTags) {
        await OneSignal.User.addTags({
          refill_medicine: medicineName,
          refill_days_due: String(daysUntilRefill),
          refill_enrolled: "true",
          last_interaction: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.warn("[OneSignal] Failed to set refill tags", e);
    }
  });
}

/**
 * Tags the subscriber with RevenueCat sponsorship milestone data.
 * Keeps sponsors engaged with real-time patient impact updates.
 */
export async function tagSponsorEngagement(
  tier: string,
  streakMonths: number
): Promise<void> {
  if (typeof window === "undefined" || !window.OneSignalDeferred) return;

  window.OneSignalDeferred.push(async (OneSignal) => {
    try {
      if (OneSignal?.User?.addTags) {
        await OneSignal.User.addTags({
          sponsor_tier: tier,
          sponsor_streak_months: String(streakMonths),
          patient_community: "Egypt-CrossBorder-EDA",
          keep_coming_back_enrolled: "true",
        });
      }
    } catch (e) {
      console.warn("[OneSignal] Failed to set sponsor tags", e);
    }
  });
}

/**
 * Triggers a live or simulated notification for judges and users.
 */
export async function triggerSimulatedNotification(
  title: string,
  body: string,
  icon: string = "/medicine-support-hub-logo.png"
): Promise<{ success: boolean; reason?: string }> {
  if (!isPushSupported()) {
    return { success: false, reason: "Push notifications are not supported in this browser." };
  }

  if (Notification.permission === "default") {
    const granted = await requestNotificationPermission();
    if (!granted) {
      return { success: false, reason: "Notification permission was dismissed or not granted." };
    }
  }

  if (Notification.permission === "denied") {
    return { success: false, reason: "Notifications are blocked in your browser settings." };
  }

  // If granted, trigger via Service Worker registration if available, or native Notification
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) {
        await reg.showNotification(title, {
          body,
          icon,
          badge: icon,
          tag: "msh-refill-alert",
          data: {
            url: "/sponsor-portal",
          },
        });
        return { success: true };
      }
    }

    new Notification(title, {
      body,
      icon,
    });
    return { success: true };
  } catch (err) {
    console.error("[OneSignal Client] Error showing notification:", err);
    return { success: false, reason: String(err) };
  }
}
