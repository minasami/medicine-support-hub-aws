import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor shell for Medicine Support Hub.
 * Web build output: apps/web/dist/public (after `pnpm run build`).
 *
 * Package id must match Android applicationId and the Appwrite Android platform:
 *   com.medicinesupporthub.app
 *
 * server.hostname is intentionally NOT bare "localhost". Older builds registered
 * a PWA SW on https://localhost; Play updates keep that SW/cache and poison the
 * WebView (blank white screen). A stable custom hostname orphans the old SW.
 *
 * Commands:
 *   pnpm mobile:sync
 *   pnpm mobile:add:android
 *   pnpm mobile:add:ios
 *   pnpm mobile:build:android
 */
const config: CapacitorConfig = {
  appId: "com.medicinesupporthub.app",
  appName: "Medicine Support Hub",
  webDir: "apps/web/dist/public",
  server: {
    // Local Capacitor origin only — NOT a remote URL.
    hostname: "app.medicinesupport.local",
    androidScheme: "https",
    cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#0f766e",
      showSpinner: false,
    },
    LocalNotifications: {
      iconColor: "#0f766e",
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: "automatic",
    preferredContentMode: "mobile",
  },
};

export default config;
