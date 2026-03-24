import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { freelancerService, clientService } from "../services";

// ─── Utility: format budget ────────────────────────────────────────────────
function fmt(v) {
  if (!v && v !== 0) return "—";
  return `₹${Number(v).toLocaleString("en-IN")}`;
}

// ─── HireRequestCard ──────────────────────────────────────────────────────
function HireRequestCard({ req, onRespond }) {
  const [open, setOpen] = useState(false);
  const statusColor = {
    PENDING: "#f59e0b", ACCEPTED: "#16a34a", REJECTED: "#dc2626",
    COUNTERED: "#7c3aed",
  }[req.status] || "#64748b";

  return (
    <article className="opp-card" style={{ borderLeft: `4px solid ${statusColor}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h3 style={{ margin: 0 }}>{req.job_title || "Hire Request"}</h3>
          <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: "0.9rem" }}>
            From: {req.client_name || "Client"} · {fmt(req.proposed_budget)}
          </p>
        </div>
        <span style={{ background: statusColor, color: "white", padding: "2px 10px", borderRadius: "12px", fontSize: "0.8rem", fontWeight: 600 }}>
          {req.status}
        </span>
      </div>
      {req.note && <p style={{ marginTop: "0.5rem", color: "#475569", fontSize: "0.9rem" }}>{req.note}</p>}
      {req.created_at && (
        <p style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "0.25rem" }}>
          Received: {new Date(req.created_at * 1000).toLocaleDateString()}
        </p>
      )}
      {req.status === "PENDING" && (
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
          <button
            style={{ padding: "6px 18px", background: "#16a34a", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 600 }}
            onClick={() => onRespond(req.request_id, "ACCEPT")}
          >Accept</button>
          <button
            style={{ padding: "6px 18px", background: "#dc2626", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: 600 }}
            onClick={() => onRespond(req.request_id, "REJECT")}
          >Decline</button>
        </div>
      )}
    </article>
  );
}

// ─── ProjectCard (browse available projects) ───────────────────────────────
function ProjectCard({ project }) {
  return (
    <article className="opp-card">
      <h3 style={{ margin: 0 }}>{project.title || project.category}</h3>
      <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: "0.9rem" }}>
        📂 {project.category} · 📍 {project.location || "Remote"} · 💰 {project.budget_type || "Budget TBD"}
      </p>
      {project.description && (
        <p style={{ marginTop: "0.5rem", color: "#475569", fontSize: "0.9rem", lineHeight: 1.5 }}>
          {project.description.slice(0, 200)}{project.description.length > 200 ? "…" : ""}
        </p>
      )}
      {project.created_at && (
        <p style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "0.25rem" }}>
          Posted: {new Date(project.created_at * 1000).toLocaleDateString()}
        </p>
      )}
    </article>
  );
}

// ─── MAIN PAGE ─────────────────────────────────────────────────────────────
export default function OpportunitiesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState("hireRequests"); // 'hireRequests' | 'projects'
  const [hireRequests, setHireRequests] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loadingHire, setLoadingHire] = useState(true);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [hireError, setHireError] = useState("");
  const [projectError, setProjectError] = useState("");
  const [search, setSearch] = useState("");

  // Load hire requests for this freelancer
  useEffect(() => {
    if (!user?.id) return;
    setLoadingHire(true);
    setHireError("");
    freelancerService.getHireInbox(user.id)
      .then(res => {
        const reqs = res.requests || [];
        setHireRequests(reqs);
      })
      .catch(() => setHireError("Could not load hire requests."))
      .finally(() => setLoadingHire(false));
  }, [user?.id]);

  // Load available projects
  useEffect(() => {
    setLoadingProjects(true);
    setProjectError("");
    clientService.getProjects(null) // null gets all active projects (no client_id filter)
      .then(res => {
        // getProjects(null) sends /client/projects with no client_id which returns all active
        setProjects(res.projects || []);
      })
      .catch(() => {
        // Fallback: try /projects/all
        fetch(`${import.meta.env.VITE_API_BASE_URL || "http://localhost:5000"}/projects/all`)
          .then(r => r.json())
          .then(data => setProjects(data.projects || []))
          .catch(() => setProjectError("Could not load available projects."))
          .finally(() => setLoadingProjects(false));
      })
      .finally(() => setLoadingProjects(false));
  }, []);

  const handleRespond = useCallback(async (requestId, action) => {
    if (!user?.id) return;
    try {
      await freelancerService.respondToHire(user.id, requestId, action);
      setHireRequests(prev =>
        prev.map(r => r.request_id === requestId ? { ...r, status: action === "ACCEPT" ? "ACCEPTED" : "REJECTED" } : r)
      );
    } catch (err) {
      alert(err.message || "Failed to respond.");
    }
  }, [user?.id]);

  const filteredHire = hireRequests.filter(r =>
    (r.job_title || "").toLowerCase().includes(search.toLowerCase()) ||
    (r.client_name || "").toLowerCase().includes(search.toLowerCase())
  );
  const filteredProjects = projects.filter(p =>
    (p.title || p.category || "").toLowerCase().includes(search.toLowerCase()) ||
    (p.description || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <main style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem 1rem" }}>
      <h1 style={{ marginBottom: "0.25rem" }}>Opportunities</h1>
      <p style={{ color: "#64748b", marginBottom: "1.5rem" }}>
        Browse hire requests and available projects in your area.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        {[{ id: "hireRequests", label: "Hire Requests" }, { id: "projects", label: "Available Projects" }].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 20px", borderRadius: "20px", border: "none", cursor: "pointer",
              fontWeight: 600, fontSize: "0.9rem",
              background: tab === t.id ? "#3b82f6" : "#f1f5f9",
              color: tab === t.id ? "white" : "#475569",
              transition: "all 0.2s",
            }}
          >
            {t.label}
            {t.id === "hireRequests" && hireRequests.length > 0 && (
              <span style={{ marginLeft: "6px", background: "rgba(255,255,255,0.3)", padding: "0 7px", borderRadius: "10px", fontSize: "0.8rem" }}>
                {hireRequests.filter(r => r.status === "PENDING").length}
              </span>
            )}
          </button>
        ))}
      </div>

      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={`Search ${tab === "hireRequests" ? "hire requests" : "projects"}…`}
        style={{ width: "100%", padding: "10px 16px", border: "1px solid #ddd", borderRadius: "8px", marginBottom: "1.25rem", fontSize: "0.95rem", boxSizing: "border-box" }}
      />

      {tab === "hireRequests" && (
        <section>
          {loadingHire ? (
            <p style={{ textAlign: "center", color: "#94a3b8" }}>Loading hire requests…</p>
          ) : hireError ? (
            <p style={{ color: "#dc2626", textAlign: "center" }}>{hireError}</p>
          ) : filteredHire.length === 0 ? (
            <div style={{ textAlign: "center", padding: "3rem 0", color: "#64748b" }}>
              <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📬</div>
              <p>No hire requests yet. Make sure your profile is complete!</p>
            </div>
          ) : (
            filteredHire.map(r => (
              <HireRequestCard key={r.request_id} req={r} onRespond={handleRespond} />
            ))
          )}
        </section>
      )}

      {tab === "projects" && (
        <section>
          {loadingProjects ? (
            <p style={{ textAlign: "center", color: "#94a3b8" }}>Loading projects…</p>
          ) : projectError ? (
            <p style={{ color: "#dc2626", textAlign: "center" }}>{projectError}</p>
          ) : filteredProjects.length === 0 ? (
            <div style={{ textAlign: "center", padding: "3rem 0", color: "#64748b" }}>
              <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📋</div>
              <p>No open projects available right now.</p>
            </div>
          ) : (
            filteredProjects.map(p => (
              <ProjectCard key={p.id} project={p} />
            ))
          )}
        </section>
      )}
    </main>
  );
}
