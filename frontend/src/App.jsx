import { useEffect, useState } from "react";
import Navbar from "./components/Navbar.jsx";
import GlobalLoader from "./components/GlobalLoader.jsx";
import Hero from "./components/Hero.jsx";
import AuthSignup from "./components/AuthSignup.jsx";
import AuthLogin from "./components/AuthLogin.jsx";
import ForgotPassword from "./components/ForgotPassword.jsx";
import ClientProfileSetup from "./components/ClientProfileSetup.jsx";
import FreelancerProfileSetup from "./components/FreelancerProfileSetup.jsx";
import Onboarding from "./components/Onboarding.jsx";
import ChoosePath from "./components/ChoosePath.jsx";
import PostProject from "./components/PostProject.jsx";
import BrowseArtists from "./components/BrowseArtists.jsx";
import Messages from "./components/Messages.jsx";
import ClientProfile from "./components/ClientProfile.jsx";
import ArtistProfile from "./components/ArtistProfile.jsx";
import PaymentPage from "./components/PaymentPage.jsx";
import GoogleAuthCallback from "./components/GoogleAuthCallback.jsx";
import "./App.css";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext.jsx";
import PublicRoute from "./components/routes/PublicRoute.jsx";
import ProtectedClientRoute from "./components/routes/ProtectedClientRoute.jsx";
import ProtectedFreelancerRoute from "./components/routes/ProtectedFreelancerRoute.jsx";
import FreelancerProfileStep1 from "./pages/FreelancerProfileStep1.jsx";
import FreelancerProfileStep2 from "./pages/FreelancerProfileStep2.jsx";
import ArtistDashboard from "./pages/ArtistDashboard.jsx";
import FreelancerProfilePage from "./pages/FreelancerProfilePage.jsx";
import FreelancerPortfolioPage from "./pages/FreelancerPortfolioPage.jsx";
import OpportunitiesPage from "./pages/OpportunitiesPage.jsx";
import GigActivityPage from "./pages/GigActivityPage.jsx";
import MessagesPage from "./pages/MessagesPage.jsx";
import ClientMessagesPage from "./pages/ClientMessagesPage.jsx";
import DashboardHeader from "./components/DashboardHeader.jsx";
import DashboardSidebar from "./components/DashboardSidebar.jsx";
import DashboardPlaceholder from "./components/DashboardPlaceholder.jsx";
import NotificationsPage from "./pages/NotificationsPage.jsx";
import FavoritesPage from "./pages/FavoritesPage.jsx";
import VerificationPage from "./pages/VerificationPage.jsx";
import SubscriptionPage from "./pages/SubscriptionPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import MyProjects from "./pages/MyProjects.jsx";
import ViewApplicants from "./pages/ViewApplicants.jsx";
import GlobalCallHandler from "./components/GlobalCallHandler.jsx";
import { publicService } from "./services/publicService";

// Admin Pages
import AdminLogin from "./pages/admin/AdminLogin.jsx";
import AdminDashboard from "./pages/admin/AdminDashboard.jsx";
import AdminClients from "./pages/admin/AdminClients.jsx";
import AdminFreelancers from "./pages/admin/AdminFreelancers.jsx";
import AdminKYC from "./pages/admin/AdminKYC.jsx";
import AdminKYCReview from "./pages/admin/AdminKYCReview.jsx";
import AdminAuditLogs from "./pages/admin/AdminAuditLogs.jsx";
import AdminProjects from "./pages/admin/AdminProjects.jsx";
import AdminPayments from "./pages/admin/AdminPayments.jsx";
import AdminEmailLogs from "./pages/admin/AdminEmailLogs.jsx";
import AdminDisputeCenter from "./pages/admin/AdminDisputeCenter.jsx";
import { Briefcase, Palette, Star } from "lucide-react";
function formatCompactNumber(value) {
  const numeric = Number(value || 0);
  if (numeric >= 1000) {
    const compact = numeric / 1000;
    const shown = compact >= 10 ? Math.round(compact) : Math.round(compact * 10) / 10;
    return `${shown}K+`;
  }
  return `${Math.round(numeric)}+`;
}
const StatsStrip = () => {
  const fallbackStats = {
    artists: 500,
    projects: 2000,
    rating: 4.5,
  };
  const [stats, setStats] = useState({
    artists: 0,
    projects: 0,
    rating: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    publicService.getPlatformStats()
      .then((response) => {
        if (!isMounted) return;
        const data = response?.data || {};
        setStats({
          artists: Number(data.total_artists || 0),
          projects: Number(data.total_projects_completed || 0),
          rating: Number(data.average_rating || 0),
        });
      })
      .catch(() => {
        if (!isMounted) return;
        setStats(fallbackStats);
      })
      .finally(() => {
        if (!isMounted) return;
        setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);
  const statItems = [
    {
      key: "artists",
      label: "Active Artists",
      value: loading ? "..." : formatCompactNumber(stats.artists || fallbackStats.artists),
      icon: Palette,
      accent: "Premium talent across creative categories",
    },
    {
      key: "projects",
      label: "Projects Completed",
      value: loading ? "..." : formatCompactNumber(stats.projects || fallbackStats.projects),
      icon: Briefcase,
      accent: "Trusted workflows for bookings and delivery",
    },
    {
      key: "rating",
      label: "Average Rating",
      value: loading ? "..." : `${Number(stats.rating || fallbackStats.rating).toFixed(1)}/5`,
      icon: Star,
      accent: "Consistent quality from a verified artist network",
    },
  ];
  return (
    <section className="stats home-stats">
      <div className="stats-inner home-stats-inner">
        {statItems.map((item, index) => {
          const Icon = item.icon;
          return (
            <article
              key={item.key}
              className="stat-card home-stat-card"
              data-home-reveal
              data-home-tilt
              style={{ "--card-delay": `${index * 90}ms` }}
            >
              <div className="home-stat-topline" />
              <div className="home-stat-icon">
                <Icon size={18} />
              </div>
              <div className="stat-value home-stat-value">{item.value}</div>
              <div className="stat-label home-stat-label">{item.label}</div>
              <p className="home-stat-accent">{item.accent}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
};
const AppContent = () => {
  const location = useLocation();
  const isArtistDashboard =
    location.pathname.startsWith("/artist/") ||
    location.pathname === "/dashboard";
  const isAdminRoute = location.pathname.startsWith("/admin");
  return (
    <>
      {!isAdminRoute && <Navbar />}
      <Routes>
        <Route path="/" element={<><Hero /><StatsStrip /></>} />
        <Route path="/signup/:role" element={<PublicRoute><AuthSignup /></PublicRoute>} />
        <Route path="/login/:role" element={<PublicRoute><AuthLogin /></PublicRoute>} />
        <Route path="/forgot-password/:role" element={<ForgotPassword />} />
        <Route path="/auth/callback" element={<GoogleAuthCallback />} />
        <Route path="/client/profile-setup" element={
          <ProtectedClientRoute requireCompleted={false}><ClientProfileSetup /></ProtectedClientRoute>
        } />
        <Route path="/freelancer/profile-setup" element={
          <ProtectedClientRoute requireCompleted={false}><FreelancerProfileSetup /></ProtectedClientRoute>
        } />
        <Route path="/freelancer/create-profile/step-1" element={
          <ProtectedFreelancerRoute requireCompleted={false}><FreelancerProfileStep1 /></ProtectedFreelancerRoute>
        } />
        <Route path="/freelancer/create-profile/step-2" element={
          <ProtectedFreelancerRoute requireCompleted={false}><FreelancerProfileStep2 /></ProtectedFreelancerRoute>
        } />
        <Route path="/onboarding" element={
          <ProtectedClientRoute><Onboarding /></ProtectedClientRoute>
        } />
        <Route path="/dashboard" element={
          <Navigate to="/artist/dashboard" replace />
        } />
        <Route path="/artist/dashboard" element={
          <ProtectedFreelancerRoute><ArtistDashboard /></ProtectedFreelancerRoute>
        } />
        <Route path="/artist/profile" element={
          <ProtectedFreelancerRoute><FreelancerProfilePage /></ProtectedFreelancerRoute>
        } />
        <Route path="/artist/portfolio" element={
          <ProtectedFreelancerRoute><FreelancerPortfolioPage /></ProtectedFreelancerRoute>
        } />
        <Route path="/artist/opportunities" element={
          <ProtectedFreelancerRoute><OpportunitiesPage /></ProtectedFreelancerRoute>
        } />
        <Route path="/artist/projects" element={
          <ProtectedFreelancerRoute><GigActivityPage /></ProtectedFreelancerRoute>
        } />
        <Route path="/projects/:id" element={
          <ProtectedFreelancerRoute><GigActivityPage /></ProtectedFreelancerRoute>
        } />
        <Route path="/artist/messages" element={
          <ProtectedFreelancerRoute><MessagesPage /></ProtectedFreelancerRoute>
        } />
        <Route path="/artist/notifications" element={
          <ProtectedFreelancerRoute><NotificationsPage /></ProtectedFreelancerRoute>
        } />
        <Route path="/artist/verification" element={
          <ProtectedFreelancerRoute><VerificationPage /></ProtectedFreelancerRoute>
        } />
        <Route path="/artist/subscription" element={
          <ProtectedFreelancerRoute><SubscriptionPage /></ProtectedFreelancerRoute>
        } />
        <Route path="/artist/settings" element={
          <ProtectedFreelancerRoute><SettingsPage /></ProtectedFreelancerRoute>
        } />
        <Route path="/choose-path" element={
          <ProtectedClientRoute><ChoosePath /></ProtectedClientRoute>
        } />
        <Route path="/client/post-project" element={
          <ProtectedClientRoute><PostProject /></ProtectedClientRoute>
        } />
        <Route path="/post-project" element={<Navigate to="/client/post-project" replace />} />
        <Route path="/browse-artists" element={
          <ProtectedClientRoute><BrowseArtists /></ProtectedClientRoute>
        } />
        <Route path="/browse" element={<Navigate to="/browse-artists" replace />} />
        <Route path="/messages" element={
          <ProtectedClientRoute><ClientMessagesPage /></ProtectedClientRoute>
        } />
        <Route path="/notifications" element={
          <ProtectedClientRoute><NotificationsPage /></ProtectedClientRoute>
        } />
        <Route path="/favorites" element={
          <ProtectedClientRoute><FavoritesPage /></ProtectedClientRoute>
        } />
        <Route path="/profile" element={
          <ProtectedClientRoute><ClientProfile /></ProtectedClientRoute>
        } />
        <Route path="/artist/:id" element={
          <ProtectedClientRoute><ArtistProfile /></ProtectedClientRoute>
        } />
        <Route path="/payment" element={
          <ProtectedClientRoute><PaymentPage /></ProtectedClientRoute>
        } />
        <Route path="/my-projects" element={
          <ProtectedClientRoute><MyProjects /></ProtectedClientRoute>
        } />
        <Route path="/project/:id/applicants" element={
          <ProtectedClientRoute><ViewApplicants /></ProtectedClientRoute>
        } />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/dashboard" element={<AdminDashboard />} />
        <Route path="/admin/clients" element={<AdminClients />} />
        <Route path="/admin/freelancers" element={<AdminFreelancers />} />
        <Route path="/admin/kyc" element={<AdminKYC />} />
        <Route path="/admin/kyc/:doc_id" element={<AdminKYCReview />} />
        <Route path="/admin/audit-logs" element={<AdminAuditLogs />} />
        <Route path="/admin/projects" element={<AdminProjects />} />
        <Route path="/admin/payments" element={<AdminPayments />} />
        <Route path="/admin/tickets" element={<AdminDisputeCenter />} />
        <Route path="/admin/email-logs" element={<AdminEmailLogs />} />
        <Route path="*" element={<><Hero /><StatsStrip /></>} />
      </Routes>
    </>
  );
};
export default function App() {
  const [appReady, setAppReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAppReady(true);
    }, 350);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);
  if (!appReady) {
    return <GlobalLoader message="Loading GigBridge..." />;
  }
  return (
    <AuthProvider>
      <GlobalCallHandler />
      <AppContent />
    </AuthProvider>
  );
}
