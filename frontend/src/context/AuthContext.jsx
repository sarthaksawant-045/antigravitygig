import { createContext, useContext, useState, useEffect, useCallback } from "react";

const AuthContext = createContext(null);

const KEYS = {
  auth: "gb_auth",
  user: "gb_user_data",
  profile: "gb_profile_done",
};

function readStorage() {
  try {
    const raw = localStorage.getItem(KEYS.user);
    const userData = raw ? JSON.parse(raw) : {};
    return {
      isAuthenticated: localStorage.getItem(KEYS.auth) === "true",
      profileCompleted: localStorage.getItem(KEYS.profile) === "true",
      ...userData,
    };
  } catch {
    return { isAuthenticated: false, profileCompleted: false };
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStorage);

  // ----------------------------------------------------------------
  // login – called after backend returns successful auth response
  // data shape: { id, name, email, role, profile_completed, client_id?, freelancer_id? }
  // ----------------------------------------------------------------
  const login = useCallback((data) => {
    const id = data.id || data.client_id || data.freelancer_id;
    const userData = {
      id,
      name: data.name || "",
      email: data.email || "",
      role: data.role || (data.client_id ? "client" : "freelancer"),
      isAuthenticated: true,
      profileCompleted: !!data.profile_completed,
    };

    localStorage.setItem(KEYS.auth, "true");
    localStorage.setItem(KEYS.profile, String(!!data.profile_completed));
    localStorage.setItem(KEYS.user, JSON.stringify(userData));

    setUser({ ...userData });
  }, []);

  const logout = useCallback(() => {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    setUser({ isAuthenticated: false, profileCompleted: false });
  }, []);

  const markProfileCompleted = useCallback(() => {
    localStorage.setItem(KEYS.profile, "true");
    setUser(prev => {
      const next = { ...prev, profileCompleted: true };
      localStorage.setItem(KEYS.user, JSON.stringify(next));
      return next;
    });
  }, []);

  // Sync across browser tabs
  useEffect(() => {
    const onStorage = (e) => {
      if ([KEYS.auth, KEYS.user, KEYS.profile].includes(e.key)) {
        setUser(readStorage());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, markProfileCompleted }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
