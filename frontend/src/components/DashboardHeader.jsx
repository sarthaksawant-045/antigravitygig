import { useMemo, useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useNavigate } from "react-router-dom";
import BrandLogo from "./BrandLogo.jsx";
import { getDashboardPath } from "../utils/branding.js";

function hasActivePremium(user) {
  if (!user?.is_premium || !user?.premium_valid_until) return false;
  const expiry = new Date(user.premium_valid_until);
  return !Number.isNaN(expiry.getTime()) && expiry > new Date();
}

export default function DashboardHeader({ onSearch }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const name = useMemo(() => user.name || user.email || "Artist", [user]);
  const premiumActive = useMemo(() => hasActivePremium(user), [user]);
  const normalizedRole = String(user.role || "").toLowerCase().trim();
  const showSearch = normalizedRole === "client";
  const dashboardPath = useMemo(() => getDashboardPath(user), [user]);

  useEffect(() => {
    const close = () => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  return (
    <header className="db-header">
      <BrandLogo to={dashboardPath} size="sm" />
      {showSearch && (
        <div className="db-search">
          <span className="db-search-ico">{'\u{1F50E}'}</span>
          <input
            placeholder="Search gigs, events, clients..."
            onChange={(e) => onSearch?.(e.target.value)}
          />
        </div>
      )}
      <div className="db-actions">
        <div className="db-user" onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}>
          <div className="db-avatar">{name.slice(0, 1).toUpperCase()}</div>
          <span className="db-username">{name}</span>
          {premiumActive && (
            <span style={{ marginLeft: "8px", padding: "4px 8px", borderRadius: "999px", background: "#dbeafe", color: "#1d4ed8", fontSize: "12px", fontWeight: 700 }}>
              Premium
            </span>
          )}
          {menuOpen && (
            <div className="profile-menu">
              <button onClick={() => { logout(); navigate("/"); }}>Logout</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
