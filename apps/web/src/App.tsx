import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router as WouterRouter, useLocation as useWouterLocation } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RouteSeo } from "@/components/route-seo";
import { LanguageProvider } from "@/lib/i18n";
import { RoleProvider } from "@/lib/role";
import { AuthProvider } from "@/lib/auth";
import { PatientAuthProvider } from "@/lib/patient-auth";
import { Layout } from "@/components/layout";
import { JourneyContinuity } from "@/components/journey-continuity";
import { client as appwriteClient } from "@/lib/appwrite";
import { startAdaptiveBeacon } from "@/lib/adaptive";
import { startDeepLinkListener } from "@/lib/deep-links";
import { AppRouter } from "@/app-router";
import { AppErrorBoundary } from "@/components/app-error-boundary";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

function DeepLinkBridge() {
  const [, navigate] = useWouterLocation();
  useEffect(() => startDeepLinkListener((path) => navigate(path)), [navigate]);
  return null;
}

export default function App() {
  useEffect(() => {
    if (import.meta.env.VITE_APPWRITE_PROJECT_ID) {
      try {
        appwriteClient.setEndpoint(
          import.meta.env.VITE_APPWRITE_ENDPOINT || "https://fra.cloud.appwrite.io/v1",
        );
        appwriteClient.setProject(import.meta.env.VITE_APPWRITE_PROJECT_ID);
      } catch (e) {
        console.warn("Appwrite Client initialization notice:", e);
      }
    }
    return startAdaptiveBeacon(120_000);
  }, []);

  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <LanguageProvider>
            <RoleProvider>
              <AuthProvider>
                <PatientAuthProvider>
                  <WouterRouter>
                    <DeepLinkBridge />
                    <RouteSeo />
                    <Layout>
                      <AppRouter />
                      <JourneyContinuity />
                    </Layout>
                  </WouterRouter>
                </PatientAuthProvider>
              </AuthProvider>
            </RoleProvider>
          </LanguageProvider>
        </TooltipProvider>
        <Toaster />
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
