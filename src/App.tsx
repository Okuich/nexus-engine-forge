import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AppNavSidebar } from "@/components/navigation/AppNavSidebar";
import Index from "./pages/Index.tsx";
import Login from "./pages/Login.tsx";
import Signup from "./pages/Signup.tsx";
import MLDashboard from "./pages/MLDashboard.tsx";
import MLPipeline from "./pages/MLPipeline.tsx";
import MLEvaluation from "./pages/MLEvaluation.tsx";
import Prospects from "./pages/Prospects.tsx";
import CRM from "./pages/CRM.tsx";
import Marketplace from "./pages/Marketplace.tsx";
import Admin from "./pages/Admin.tsx";
import Fabrication from "./pages/Fabrication.tsx";
import Pricing from "./pages/Pricing.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppNavSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-11 flex items-center border-b border-border bg-card px-2 shrink-0">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
          </header>
          <main className="flex-1 overflow-hidden">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function AppRoutes() {
  const location = useLocation();
  const isAuthPage = location.pathname === '/login' || location.pathname === '/signup';

  if (isAuthPage) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
      </Routes>
    );
  }

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
        <Route path="/ml" element={<ProtectedRoute><MLDashboard /></ProtectedRoute>} />
        <Route path="/pipeline" element={<ProtectedRoute><MLPipeline /></ProtectedRoute>} />
        <Route path="/ml/evaluation" element={<ProtectedRoute><MLEvaluation /></ProtectedRoute>} />
        <Route path="/prospects" element={<ProtectedRoute><Prospects /></ProtectedRoute>} />
        <Route path="/crm" element={<ProtectedRoute><CRM /></ProtectedRoute>} />
        <Route path="/marketplace" element={<ProtectedRoute><Marketplace /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
        <Route path="/fabrication" element={<ProtectedRoute><Fabrication /></ProtectedRoute>} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppLayout>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
