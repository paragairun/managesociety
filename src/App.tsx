import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { FingerprintProvider } from "@/contexts/FingerprintContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import GuardLogin from "./pages/GuardLogin";
import GuardDashboard from "./pages/GuardDashboard";
import VisitorForm from "./pages/VisitorForm";
import ResidentLogin from "./pages/ResidentLogin";
import ResidentPortal from "./pages/ResidentPortal";
import AdminLogin from "./pages/AdminLogin";
import AdminPanel from "./pages/AdminPanel";
import Register from "./pages/Register";
import SocietyRegister from "./pages/SocietyRegister";
import LoginPortal from "./pages/LoginPortal";
import SocietyPortal from "./pages/SocietyPortal";
import SuperAdminDashboard from "./pages/SuperAdminDashboard";
import SuperAdminLogin from "./pages/SuperAdminLogin";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";
import Index from "./pages/Index";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import Article from "./pages/Article";

const queryClient = new QueryClient();

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

/** Fires a GA4 page_view on every React Router navigation. */
const GAPageTracker = () => {
  const location = useLocation();
  useEffect(() => {
    if (typeof window.gtag === "function") {
      window.gtag("event", "page_view", {
        page_path: location.pathname + location.search,
        page_location: window.location.href,
      });
    }
  }, [location]);
  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <GAPageTracker />
        <AuthProvider>
          <FingerprintProvider>
          <main>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/privacy-policy" element={<PrivacyPolicy />} />
            <Route path="/register" element={<Register />} />
            <Route path="/register-society" element={<SocietyRegister />} />
            <Route path="/login" element={<LoginPortal />} />
            <Route path="/login/society" element={<SocietyPortal />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/article/digital-vs-paper-society-management" element={<Article />} />

            {/* Super admin */}
            <Route path="/super-admin/login" element={<SuperAdminLogin />} />
            <Route path="/super-admin" element={<SuperAdminDashboard />} />

            {/* Guard — legacy root + slug-based */}
            <Route path="/guard" element={<GuardLogin />} />
            <Route path="/:societySlug/guard" element={<GuardLogin />} />
            <Route path="/guard/dashboard" element={
              <ProtectedRoute requiredRole="guard" loginPathBase="guard">
                <GuardDashboard />
              </ProtectedRoute>
            } />
            <Route path="/:societySlug/guard/dashboard" element={
              <ProtectedRoute requiredRole="guard" loginPathBase="guard">
                <GuardDashboard />
              </ProtectedRoute>
            } />

            {/* Visitor form — public, no login required */}
            <Route path="/visitor/form" element={<VisitorForm />} />
            <Route path="/:societySlug/visitor/form" element={<VisitorForm />} />

            {/* Resident — legacy root + slug-based */}
            <Route path="/resident" element={<ResidentLogin />} />
            <Route path="/:societySlug/resident" element={<ResidentLogin />} />
            <Route path="/resident/dashboard" element={
              <ProtectedRoute requiredRole="resident" loginPathBase="resident">
                <ResidentPortal />
              </ProtectedRoute>
            } />
            <Route path="/:societySlug/resident/dashboard" element={
              <ProtectedRoute requiredRole="resident" loginPathBase="resident">
                <ResidentPortal />
              </ProtectedRoute>
            } />

            {/* Admin — legacy root + slug-based */}
            <Route path="/admin" element={<AdminLogin />} />
            <Route path="/:societySlug/admin" element={<AdminLogin />} />
            <Route path="/admin/dashboard" element={
              <ProtectedRoute requiredRole="admin" loginPathBase="admin">
                <AdminPanel />
              </ProtectedRoute>
            } />
            <Route path="/:societySlug/admin/dashboard" element={
              <ProtectedRoute requiredRole="admin" loginPathBase="admin">
                <AdminPanel />
              </ProtectedRoute>
            } />

            <Route path="*" element={<NotFound />} />
          </Routes>
          </main>
          </FingerprintProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
