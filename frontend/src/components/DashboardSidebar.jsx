import { useAuth } from "../context/AuthContext.jsx";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { getUnreadCount } from "../services/notificationService.js";

const MENU = [
  { key: "dashboard", label: "Dashboard", ico: "▦", path: "/artist/dashboard" },
  { key: "profile", label: "Profile", ico: "👤", path: "/artist/profile" },
  { key: "portfolio", label: "Portfolio", ico: "💼", path: "/artist/portfolio" },
  { key: "opportunities", label: "Find Work", ico: "🔍", path: "/artist/opportunities" },
  { key: "projects", label: "My Gigs", ico: "📁", path: "/artist/projects" },
  { key: "messages", label: "Messages", ico: "💬", path: "/artist/messages" },
  { key: "notifications", label: "Notifications", ico: "🔔", path: "/artist/notifications" },
  { key: "verification", label: "Verification", ico: "🛡️", path: "/artist/verification" },
  { key: "subscription", label: "Subscription", ico: "💳", path: "/artist/subscription" },
  { key: "settings", label: "Settings", ico: "⚙️", path: "/artist/settings" },
];

export default function DashboardSidebar({ active = "dashboard", onSelect }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const name = user.name || user.email || "Artist";
  
  const [messageCount, setMessageCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    getUnreadCount(user.id)
      .then((response) => setNotificationCount(response.unread_count || 0))
      .catch(() => setNotificationCount(0));
  }, [user?.id]);

  const handleNav = (item) => {
    if (item.path) {
      navigate(item.path);
    }
    onSelect?.(item.key);
  };

  return (
    <aside className="db-sidebar">
      <nav className="db-nav">
        {MENU.map((m) => (
          <button
            key={m.key}
            className={`db-nav-item ${active === m.key ? "active" : ""}`}
            onClick={() => handleNav(m)}
          >
            <span className="db-nav-ico">{m.ico}</span>
            <span className="db-nav-label">{m.label}</span>
            {m.key === 'messages' && messageCount > 0 && <span className="db-nav-badge">{messageCount}</span>}
            {m.key === 'notifications' && notificationCount > 0 && <span className="db-nav-badge">{notificationCount}</span>}
          </button>
        ))}
      </nav>
      <div className="db-profile-preview">
        <div className="db-avatar">{name.slice(0,1).toUpperCase()}</div>
        <div className="db-preview-text">
          <div className="db-preview-name">{name}</div>
          <div className="db-preview-email">{user.email}</div>
        </div>
      </div>
    </aside>
  );
}
