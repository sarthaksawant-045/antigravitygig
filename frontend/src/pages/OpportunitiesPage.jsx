import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { freelancerService, clientService } from "../services";
import socketService from "../services/socketService";
import "./opportunities.css";

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
      {req.status === "ACCEPTED" && (
        <p style={{ marginTop: "0.75rem", color: "#16a34a", fontSize: "0.85rem", fontWeight: 600 }}>
          ✓ Accepted. Awaiting Client payment to begin the gig.
        </p>
      )}
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
function ProjectCard({ project, onApply }) {
  return (
    <article className="opp-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h3 style={{ margin: 0 }}>{project.title || project.category}</h3>
          <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: "0.9rem" }}>
            📂 {project.category} · 📍 {project.location || "Remote"} · 💰 {project.budget_type || "Budget TBD"}
          </p>
        </div>
        {project.has_applied && (
          <span style={{ background: "#16a34a", color: "white", padding: "2px 10px", borderRadius: "12px", fontSize: "0.80rem", fontWeight: 600 }}>
            APPLIED
          </span>
        )}
      </div>
      
      {project.description && (
        <p style={{ marginTop: "0.5rem", color: "#475569", fontSize: "0.9rem", lineHeight: 1.5 }}>
          {project.description.slice(0, 200)}{project.description.length > 200 ? "…" : ""}
        </p>
      )}
      
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1rem" }}>
        {project.created_at && (
          <p style={{ fontSize: "0.75rem", color: "#94a3b8", margin: 0 }}>
            Posted: {new Date(project.created_at * 1000).toLocaleDateString()}
          </p>
        )}
        
        {!project.has_applied && (
          <button 
            className="btn-apply"
            onClick={() => onApply(project)}
            style={{ 
              padding: "6px 20px", background: "#3b82f6", color: "white", 
              border: "none", borderRadius: "6px", cursor: "pointer", 
              fontWeight: 600, fontSize: "0.85rem"
            }}
          >
            Apply Now
          </button>
        )}
      </div>
    </article>
  );
}

// ─── ApplyModal ─────────────────────────────────────────────────────────────
function ApplyModal({ project, onClose, onSubmit, submitting, errorMessage }) {
  const [proposal, setProposal] = useState("");
  const [bid, setBid] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!proposal || !bid) return alert("Please fill all fields.");
    onSubmit(project.id, proposal, bid);
  };

  return (
    <div className="modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div className="modal-content" style={{ background: "white", padding: "2rem", borderRadius: "12px", width: "100%", maxWidth: "500px", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
        <h2 style={{ marginBottom: "0.5rem" }}>Apply for {project.title}</h2>
        <p style={{ color: "#64748b", marginBottom: "1.5rem", fontSize: "0.9rem" }}>Explain why you're the best fit and suggest your bid.</p>
        
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {errorMessage && (
            <div style={{ background: "#fef2f2", color: "#dc2626", padding: "10px 12px", borderRadius: "8px", fontSize: "0.9rem" }}>
              {errorMessage}
            </div>
          )}
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, fontSize: "0.9rem" }}>Your Proposal</label>
            <textarea 
              value={proposal}
              onChange={e => setProposal(e.target.value)}
              placeholder="Describe your approach, relevant experience..."
              style={{ width: "100%", padding: "10px", border: "1px solid #ddd", borderRadius: "8px", minHeight: "120px", fontSize: "0.95rem", boxSizing: "border-box" }}
              required
            />
          </div>
          
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, fontSize: "0.9rem" }}>Bid Amount (₹)</label>
            <input 
              type="number"
              value={bid}
              onChange={e => setBid(e.target.value)}
              placeholder="e.g. 5000"
              style={{ width: "100%", padding: "10px", border: "1px solid #ddd", borderRadius: "8px", fontSize: "0.95rem", boxSizing: "border-box" }}
              required
            />
          </div>
          
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
            <button 
              type="submit"
              disabled={submitting}
              style={{ flex: 1, padding: "12px", background: "#3b82f6", color: "white", border: "none", borderRadius: "8px", fontWeight: 700, cursor: "pointer", opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? "Submitting..." : "Submit Application"}
            </button>
            <button 
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{ padding: "12px 20px", background: "#f1f5f9", color: "#475569", border: "none", borderRadius: "8px", fontWeight: 600, cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ApplySuccessModal({ projectTitle }) {
  return (
    <div className="modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div className="modal-content" style={{ background: "white", padding: "2rem", borderRadius: "12px", width: "100%", maxWidth: "460px", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)", textAlign: "center" }}>
        <h2 style={{ marginBottom: "0.5rem" }}>Application Sent Successfully</h2>
        <p style={{ color: "#64748b", margin: 0 }}>
          {projectTitle ? `Your application for ${projectTitle} was submitted.` : "Your application was submitted."}
        </p>
        <p style={{ color: "#94a3b8", marginTop: "0.75rem", fontSize: "0.9rem" }}>
          Redirecting to your dashboard...
        </p>
      </div>
    </div>
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

  const [selectedProject, setSelectedProject] = useState(null);
  const [submittingApply, setSubmittingApply] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [applySuccess, setApplySuccess] = useState(null);

  // Load hire requests for this freelancer
  const loadHireRequests = useCallback(() => {
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

  useEffect(() => {
    loadHireRequests();
  }, [loadHireRequests]);

  const [categoryFilter, setCategoryFilter] = useState("");
  const [budgetFilter, setBudgetFilter] = useState("");

  // Load available projects - dynamic based on search
  const loadProjects = useCallback(() => {
    setLoadingProjects(true);
    setProjectError("");

    const projectsPromise = search.trim()
      ? clientService.searchProjects(search.trim(), user?.id)
      : clientService.getAllProjects(user?.id);
    const applicationsPromise = user?.id
      ? freelancerService.getApplications(user.id)
      : Promise.resolve({ applications: [] });

    Promise.all([projectsPromise, applicationsPromise])
      .then(([projectRes, applicationRes]) => {
        const fetchedProjects = projectRes.projects || [];
        const applications = applicationRes.applications || [];
        const normalizedSearch = search.trim().toLowerCase();
        const applicationProjectMap = new Map();

        applications.forEach((application) => {
          const project = application.project || {};
          if (
            normalizedSearch &&
            ![project.title, project.category, project.description, project.location]
              .filter(Boolean)
              .some((value) => String(value).toLowerCase().includes(normalizedSearch))
          ) {
            return;
          }

          applicationProjectMap.set(application.project_id, {
            id: application.project_id,
            client_id: project.client_id,
            title: project.title || "Untitled Project",
            category: project.category || "",
            location: project.location || "",
            budget_type: project.budget_type || "",
            description: project.description || "",
            status: project.status || "active",
            created_at: application.created_at,
            has_applied: true,
            application_id: application.application_id,
            application_status: application.status,
            client_name: project.client_name || "",
          });
        });

        fetchedProjects.forEach((project) => {
          if (applicationProjectMap.has(project.id)) {
            const applicationProject = applicationProjectMap.get(project.id);
            applicationProjectMap.set(project.id, {
              ...project,
              has_applied: true,
              application_id: applicationProject.application_id,
              application_status: applicationProject.application_status,
              client_name: applicationProject.client_name || project.client_name || "",
            });
          } else {
            applicationProjectMap.set(project.id, project);
          }
        });

        setProjects(Array.from(applicationProjectMap.values()));
      })
      .catch(() => setProjectError("Could not load available projects."))
      .finally(() => setLoadingProjects(false));
  }, [search, user?.id]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadProjects();
    }, 300);
    return () => clearTimeout(timer);
  }, [loadProjects]);

  useEffect(() => {
    if (!user?.id) return;

    const connectPromise = socketService.connected
      ? Promise.resolve()
      : socketService.connect(user.id, user.role || "freelancer").catch(() => null);

    const handleApplicationSent = (payload) => {
      const application = payload?.application;
      if (!application || application.freelancer_id !== user.id) return;

      const project = application.project || {};
      setProjects((prev) => {
        const next = [...prev];
        const index = next.findIndex((item) => item.id === application.project_id);
        const updatedProject = {
          id: application.project_id,
          client_id: project.client_id,
          title: project.title || "Untitled Project",
          category: project.category || "",
          location: project.location || "",
          budget_type: project.budget_type || "",
          description: project.description || "",
          status: project.status || "active",
          created_at: application.created_at,
          has_applied: true,
          application_id: application.application_id,
          application_status: application.status,
          client_name: project.client_name || "",
        };

        if (index >= 0) next[index] = { ...next[index], ...updatedProject };
        else next.unshift(updatedProject);
        return next;
      });
    };

    connectPromise.finally(() => {
      socketService.on("applicationSent", handleApplicationSent);
    });

    return () => {
      socketService.off("applicationSent", handleApplicationSent);
    };
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!applySuccess) return undefined;
    const timer = setTimeout(() => {
      setApplySuccess(null);
      navigate("/artist/dashboard");
    }, 2500);
    return () => clearTimeout(timer);
  }, [applySuccess, navigate]);

  const handleRespond = useCallback(async (requestId, action) => {
    if (!user?.id) return;
    try {
      await freelancerService.respondToHire(user.id, requestId, action);
      loadHireRequests();
    } catch (err) {
      alert(err.message || "Failed to respond.");
    }
  }, [user?.id, loadHireRequests]);

  const handleApplySubmit = async (projectId, proposal, bidAmount) => {
    if (!user?.id) return;
    const targetProject = projects.find(p => p.id === projectId) || selectedProject;
    if (targetProject?.has_applied) {
      setApplyError("You have already applied to this project.");
      return;
    }

    setSubmittingApply(true);
    setApplyError("");
    try {
      const res = await freelancerService.applyToProject(user.id, projectId, proposal, bidAmount);
      const application = res.application;
      const project = application?.project || targetProject || {};

      setProjects((prev) => {
        const next = [...prev];
        const index = next.findIndex((item) => item.id === projectId);
        const updatedProject = {
          id: projectId,
          client_id: project.client_id,
          title: project.title || targetProject?.title || "Untitled Project",
          category: project.category || targetProject?.category || "",
          location: project.location || targetProject?.location || "",
          budget_type: project.budget_type || targetProject?.budget_type || "",
          description: project.description || targetProject?.description || "",
          status: project.status || targetProject?.status || "active",
          created_at: application?.created_at || targetProject?.created_at,
          has_applied: true,
          application_id: application?.application_id,
          application_status: application?.status || "PENDING",
          client_name: project.client_name || targetProject?.client_name || "",
        };

        if (index >= 0) next[index] = { ...next[index], ...updatedProject };
        else next.unshift(updatedProject);
        return next;
      });
      setSelectedProject(null);
      setApplySuccess({ projectTitle: project.title || targetProject?.title || "this project" });
    } catch (err) {
      if (err?.data?.application) {
        const application = err.data.application;
        const project = application.project || targetProject || {};
        setProjects((prev) => prev.map((item) => (
          item.id === projectId
            ? {
                ...item,
                has_applied: true,
                application_id: application.application_id,
                application_status: application.status || "PENDING",
                client_name: project.client_name || item.client_name || "",
              }
            : item
        )));
        setSelectedProject(null);
      }
      setApplyError(err.message || "Failed to submit application.");
    } finally {
      setSubmittingApply(false);
    }
  };

  // Client-side filtering ONLY for hire requests
  const filteredHire = hireRequests.filter(r =>
    (r.job_title || "").toLowerCase().includes(search.toLowerCase()) ||
    (r.client_name || "").toLowerCase().includes(search.toLowerCase())
  );
  
  // Projects are already server-filtered by search, now apply optional UI filters
  const filteredProjects = projects.filter(p => {
    if (categoryFilter && p.category !== categoryFilter) return false;
    if (budgetFilter && p.budget_type !== budgetFilter) return false;
    return true;
  });

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

      <div style={{ display: "flex", gap: "10px", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={`Search ${tab === "hireRequests" ? "hire requests" : "projects"}…`}
          style={{ flex: "1 1 300px", padding: "10px 16px", border: "1px solid #ddd", borderRadius: "8px", fontSize: "0.95rem", boxSizing: "border-box" }}
        />
        {tab === "projects" && (
          <>
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              style={{ padding: "10px", border: "1px solid #ddd", borderRadius: "8px", fontSize: "0.95rem", background: "white", cursor: "pointer" }}
            >
              <option value="">All Categories</option>
              {["Photographer","Videographer","DJ","Singer","Dancer","Anchor","Makeup Artist","Mehendi Artist","Decorator","Wedding Planner","Choreographer","Band / Live Music","Magician / Entertainer","Artist","Event Organizer"].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              value={budgetFilter}
              onChange={e => setBudgetFilter(e.target.value)}
              style={{ padding: "10px", border: "1px solid #ddd", borderRadius: "8px", fontSize: "0.95rem", background: "white", cursor: "pointer" }}
            >
              <option value="">All Budgets</option>
              <option value="hourly">Hourly Rate</option>
              <option value="fixed">Fixed Price</option>
            </select>
          </>
        )}
      </div>

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
              <ProjectCard 
                key={p.id} 
                project={p} 
                onApply={(project) => {
                  setApplyError("");
                  setSelectedProject(project);
                }}
              />
            ))
          )}
        </section>
      )}

      {selectedProject && (
        <ApplyModal 
          project={selectedProject}
          onClose={() => {
            setApplyError("");
            setSelectedProject(null);
          }}
          onSubmit={handleApplySubmit}
          submitting={submittingApply}
          errorMessage={applyError}
        />
      )}

      {applySuccess && <ApplySuccessModal projectTitle={applySuccess.projectTitle} />}
    </main>
  );
}
