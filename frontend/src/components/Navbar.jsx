import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { getUnreadCount } from "../services/notificationService.js";
import BrandLogo from "./BrandLogo.jsx";
import { getDashboardPath } from "../utils/branding.js";
import "./Navbar.css"; // styling for badge and nav buttons

// Notification Icon SVG
const BellIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
  </svg>
);

// Heart Icon SVG
const HeartIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
  </svg>
);

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  
  const [unreadCount, setUnreadCount] = useState(0);

  const { user, logout } = useAuth();
  const name = user.name || user.email || "User";
  const profileImage =
    user?.profile_image ||
    (user?.role === "client" || user?.role === "Client"
      ? localStorage.getItem("client_profile_avatar") || ""
      : "");
  const premiumActive = !!user?.is_premium && !!user?.premium_valid_until && new Date(user.premium_valid_until) > new Date();
  const dashboardPath = getDashboardPath(user);
  const isFreelancerOnboarding = location.pathname.startsWith("/freelancer/create-profile/");

  useEffect(() => {
    const close = () => { 
      setMenuOpen(false); 
      setNavOpen(false); 
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  useEffect(() => {
    if (user.isAuthenticated && user?.id) {
      getUnreadCount(user.id)
        .then((response) => {
          setUnreadCount(response.unread_count || 0);
        })
        .catch(() => setUnreadCount(0));
    }
  }, [user.isAuthenticated, user?.id, location.pathname]);

  const isArtistDashboard = location.pathname.startsWith("/artist/") || location.pathname === "/dashboard";
  if (isArtistDashboard) return null;

  return (
    <nav className={`navbar${isFreelancerOnboarding ? " minimal" : ""}`}>
      <div className="navbar-inner">
        <BrandLogo to={dashboardPath} size="sm" />

        {!isFreelancerOnboarding && (
          <button
            className="hamburger"
            aria-label="Toggle menu"
            onClick={(e) => { e.stopPropagation(); setNavOpen(!navOpen); }}
          >
            <span />
            <span />
            <span />
          </button>
        )}

        {!isFreelancerOnboarding && (
          <ul className="nav-links">
            {/* Show client-specific items only when logged in as client */}
            {user.isAuthenticated && (user.role === "client" || user.role === "Client") && (
              <>
                <li className={location.pathname === "/my-projects" ? "active" : ""} onClick={() => navigate("/my-projects")}>My Projects</li>
                <li className={location.pathname === "/browse-artists" ? "active" : ""} onClick={() => navigate("/browse-artists")}>Browse Artists</li>
                <li className={location.pathname === "/client/post-project" ? "active" : ""} onClick={() => navigate("/client/post-project")}>Post a Project</li>
                <li className={location.pathname === "/payment" ? "active" : ""} onClick={() => navigate("/payment")}>Payments</li>
                <li className={location.pathname === "/messages" ? "active" : ""} onClick={() => navigate("/messages")}>Messages</li>
              </>
            )}
          </ul>
        )}

        <div className="nav-actions">

          {!isFreelancerOnboarding && !user.isAuthenticated ? (
            <>
              <span
                className="login"
                onClick={() => navigate("/login/client")}
              >
                Login
              </span>
              <button
                className="signup-btn"
                onClick={() => navigate("/signup/client")}
              >
                Sign Up
              </button>
            </>
          ) : (
            <>
              {!isFreelancerOnboarding && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="nav-bell-btn" onClick={() => navigate("/favorites")} title="Liked Freelancers">
                    <HeartIcon />
                  </button>
                  <button className="nav-bell-btn" onClick={() => navigate("/notifications")} title="Notifications">
                    <BellIcon />
                    {unreadCount > 0 && (
                      <span className="nav-bell-badge">{unreadCount}</span>
                    )}
                  </button>
                </div>
              )}

              <div className="profile-wrap" onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}>
                <div className="avatar">
                  {profileImage ? (
                    <img
                      src={profileImage}
                      alt={name}
                      style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
                    />
                  ) : (
                    name.slice(0,1).toUpperCase()
                  )}
                </div>
                <span className="profile-name">{name}</span>
                {premiumActive && (
                  <span style={{ padding: '4px 8px', borderRadius: '999px', background: '#dbeafe', color: '#1d4ed8', fontSize: '12px', fontWeight: 700 }}>
                    Premium
                  </span>
                )}
                {menuOpen && (
                  <div className="profile-menu">
                    <button onClick={() => { logout(); navigate("/"); }}>Logout</button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {!isFreelancerOnboarding && navOpen && (
        <div className="mobile-menu" onClick={(e)=>e.stopPropagation()}>
          <button className={`mobile-item ${location.pathname === '/my-projects' ? 'active' : ''}`} onClick={() => { navigate("/my-projects"); setNavOpen(false); }}>My Projects</button>
          <button className={`mobile-item ${location.pathname === '/browse-artists' ? 'active' : ''}`} onClick={() => { navigate("/browse-artists"); setNavOpen(false); }}>Browse Artists</button>
          <button className={`mobile-item ${location.pathname === '/client/post-project' ? 'active' : ''}`} onClick={() => { navigate("/client/post-project"); setNavOpen(false); }}>Post a Project</button>
          <button className={`mobile-item ${location.pathname === '/payment' ? 'active' : ''}`} onClick={() => { navigate("/payment"); setNavOpen(false); }}>Payments</button>
          <button className={`mobile-item ${location.pathname === '/messages' ? 'active' : ''}`} onClick={() => { navigate("/messages"); setNavOpen(false); }}>Messages</button>
          {!user.isAuthenticated && (
            <button className="mobile-item" onClick={() => { navigate("/login/client"); setNavOpen(false); }}>Login</button>
          )}
        </div>
      )}
    </nav>
  );
}
