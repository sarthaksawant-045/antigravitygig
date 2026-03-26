import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Briefcase,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  FolderKanban,
  MapPin,
  Search,
  User,
  XCircle,
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { freelancerService, clientService } from "../services";
import socketService from "../services/socketService";
import "./opportunities.css";

function fmt(v) {
  if (!v && v !== 0) return "—";
  return `₹${Number(v).toLocaleString("en-IN")}`;
}

function formatShortDate(value) {
  if (!value) return "";
  return new Date(value * 1000).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getRequestStatusMeta(status) {
  switch (status) {
    case "ACCEPTED":
      return {
        cardClass: "is-accepted",
        badgeClass: "is-accepted",
        icon: CheckCircle2,
        label: "Accepted",
      };
    case "REJECTED":
      return {
        cardClass: "is-rejected",
        badgeClass: "is-rejected",
        icon: XCircle,
        label: "Rejected",
      };
    case "COMPLETED":
      return {
        cardClass: "is-completed",
        badgeClass: "is-completed",
        icon: CheckCircle2,
        label: "Completed",
      };
    case "PENDING":
      return {
        cardClass: "is-pending",
        badgeClass: "is-pending",
        icon: Briefcase,
        label: "Pending",
      };
    case "COUNTERED":
      return {
        cardClass: "is-countered",
        badgeClass: "is-countered",
        icon: FileText,
        label: "Countered",
      };
    default:
      return {
        cardClass: "is-default",
        badgeClass: "is-default",
        icon: Briefcase,
        label: status || "Updated",
      };
  }
}

function HireRequestCard({ req, onRespond }) {
  const statusMeta = getRequestStatusMeta(req.status);
  const StatusIcon = statusMeta.icon;

  return (
    <article className={`opp-card ${statusMeta.cardClass}`}>
      <div className="opp-card-header-row">
        <div className="opp-title-group">
          <div className="opp-card-icon">
            <Briefcase size={18} />
          </div>
          <div className="opp-title-copy">
            <h3>{req.job_title || "Hire Request"}</h3>
          </div>
        </div>

        <span className={`opp-status-badge ${statusMeta.badgeClass}`}>
          <StatusIcon size={14} />
          <span>{statusMeta.label}</span>
        </span>
      </div>

      <div className="opp-meta-row">
        <span className="opp-meta-item">
          <User size={14} />
          <span>{req.client_name || "Client"}</span>
        </span>
        <span className="opp-meta-item opp-meta-budget">
          <CircleDollarSign size={14} />
          <span>{fmt(req.proposed_budget)}</span>
        </span>
      </div>

      {(req.note || req.status === "ACCEPTED") && (
        <div className="opp-description">
          {req.note ? (
            <p>{req.note}</p>
          ) : (
            <p>Accepted. Awaiting client payment to begin the gig.</p>
          )}
        </div>
      )}

      <div className="opp-footer-row">
        {req.created_at ? (
          <span className="opp-footer-item">
            <CalendarDays size={14} />
            <span>Received {formatShortDate(req.created_at)}</span>
          </span>
        ) : (
          <span className="opp-footer-item">
            <CalendarDays size={14} />
            <span>Recently received</span>
          </span>
        )}
      </div>

      {req.status === "PENDING" && (
        <div className="opp-actions">
          <button className="opp-action-btn opp-action-primary" onClick={() => onRespond(req.request_id, "ACCEPT")}>
            Accept
          </button>
          <button className="opp-action-btn opp-action-danger" onClick={() => onRespond(req.request_id, "REJECT")}>
            Decline
          </button>
        </div>
      )}
    </article>
  );
}

function ProjectCard({ project, onApply }) {
  return (
    <article className="opp-card is-project">
      <div className="opp-card-header-row">
        <div className="opp-title-group">
          <div className="opp-card-icon">
            <FolderKanban size={18} />
          </div>
          <div className="opp-title-copy">
            <h3>{project.title || project.category}</h3>
          </div>
        </div>

        {project.has_applied && (
          <span className="opp-status-badge is-accepted">
            <CheckCircle2 size={14} />
            <span>Applied</span>
          </span>
        )}
      </div>

      <div className="opp-meta-row opp-meta-row-wrap">
        <span className="opp-meta-item">
          <User size={14} />
          <span>{project.client_name || "Client"}</span>
        </span>
        <span className="opp-meta-item opp-meta-budget">
          <CircleDollarSign size={14} />
          <span>{project.budget_type || "Budget TBD"}</span>
        </span>
        <span className="opp-meta-item">
          <MapPin size={14} />
          <span>{project.location || "Remote"}</span>
        </span>
      </div>

      {project.description && (
        <div className="opp-description">
          <p>
            {project.description.slice(0, 200)}
            {project.description.length > 200 ? "…" : ""}
          </p>
        </div>
      )}

      <div className="opp-footer-row">
        {project.created_at ? (
          <span className="opp-footer-item">
            <CalendarDays size={14} />
            <span>Posted {formatShortDate(project.created_at)}</span>
          </span>
        ) : (
          <span className="opp-footer-item">
            <CalendarDays size={14} />
            <span>Recently posted</span>
          </span>
        )}

        {!project.has_applied && (
          <button className="opp-action-btn opp-action-primary" onClick={() => onApply(project)}>
            Apply Now
          </button>
        )}
      </div>
    </article>
  );
}

function ApplyModal({ project, onClose, onSubmit, submitting, errorMessage }) {
  const [proposal, setProposal] = useState("");
  const [bid, setBid] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!proposal || !bid) return alert("Please fill all fields.");
    onSubmit(project.id, proposal, bid);
  };

  return (
    <div className="opp-modal-overlay">
      <div className="opp-modal-card">
        <div className="opp-modal-header">
          <h2>Apply for {project.title}</h2>
          <p>Explain why you're the best fit and suggest your bid.</p>
        </div>

        <form onSubmit={handleSubmit} className="opp-modal-form">
          {errorMessage && <div className="opp-modal-error">{errorMessage}</div>}

          <div className="opp-field">
            <label>Your Proposal</label>
            <textarea
              value={proposal}
              onChange={(e) => setProposal(e.target.value)}
              placeholder="Describe your approach, relevant experience..."
              required
            />
          </div>

          <div className="opp-field">
            <label>Bid Amount (₹)</label>
            <input
              type="number"
              value={bid}
              onChange={(e) => setBid(e.target.value)}
              placeholder="e.g. 5000"
              required
            />
          </div>

          <div className="opp-modal-actions">
            <button type="submit" disabled={submitting} className="opp-action-btn opp-action-primary opp-modal-submit">
              {submitting ? "Submitting..." : "Submit Application"}
            </button>
            <button type="button" onClick={onClose} disabled={submitting} className="opp-action-btn opp-action-secondary">
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
    <div className="opp-modal-overlay">
      <div className="opp-modal-card opp-modal-card-success">
        <div className="opp-success-icon">
          <CheckCircle2 size={28} />
        </div>
        <h2>Application Sent Successfully</h2>
        <p>
          {projectTitle ? `Your application for ${projectTitle} was submitted.` : "Your application was submitted."}
        </p>
        <span>Redirecting to your dashboard...</span>
      </div>
    </div>
  );
}

export default function OpportunitiesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState("hireRequests");
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

  const loadHireRequests = useCallback(() => {
    if (!user?.id) return;
    setLoadingHire(true);
    setHireError("");
    freelancerService
      .getHireInbox(user.id)
      .then((res) => {
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

  const loadProjects = useCallback(() => {
    setLoadingProjects(true);
    setProjectError("");

    const projectsPromise = search.trim()
      ? clientService.searchProjects(search.trim(), user?.id)
      : clientService.getAllProjects(user?.id);
    const applicationsPromise = user?.id
      ? freelancerService.getApplications(user.id)
      : Promise.resolve({ applications: [] });

    Promise.allSettled([projectsPromise, applicationsPromise])
      .then(([projectResult, applicationResult]) => {
        if (projectResult.status !== "fulfilled") {
          throw projectResult.reason;
        }

        const projectRes = projectResult.value || {};
        const applicationRes =
          applicationResult.status === "fulfilled" ? applicationResult.value || {} : { applications: [] };

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

  const handleRespond = useCallback(
    async (requestId, action) => {
      if (!user?.id) return;
      try {
        await freelancerService.respondToHire(user.id, requestId, action);
        loadHireRequests();
      } catch (err) {
        alert(err.message || "Failed to respond.");
      }
    },
    [user?.id, loadHireRequests]
  );

  const handleApplySubmit = async (projectId, proposal, bidAmount) => {
    if (!user?.id) return;
    const targetProject = projects.find((p) => p.id === projectId) || selectedProject;
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
        setProjects((prev) =>
          prev.map((item) =>
            item.id === projectId
              ? {
                  ...item,
                  has_applied: true,
                  application_id: application.application_id,
                  application_status: application.status || "PENDING",
                  client_name: project.client_name || item.client_name || "",
                }
              : item
          )
        );
        setSelectedProject(null);
      }
      setApplyError(err.message || "Failed to submit application.");
    } finally {
      setSubmittingApply(false);
    }
  };

  const filteredHire = hireRequests.filter(
    (r) =>
      (r.job_title || "").toLowerCase().includes(search.toLowerCase()) ||
      (r.client_name || "").toLowerCase().includes(search.toLowerCase())
  );

  const filteredProjects = projects.filter((p) => {
    if (categoryFilter && p.category !== categoryFilter) return false;
    return true;
  });

  const pendingHireCount = hireRequests.filter((r) => r.status === "PENDING").length;

  return (
    <main className="opportunities-shell">
      <div className="opportunities-page">
        <header className="opps-header">
          <h1>Opportunities</h1>
          <p>Browse hire requests and available projects in your area.</p>
        </header>

        <div className="opps-tabs" role="tablist" aria-label="Opportunity sections">
          {[
            { id: "hireRequests", label: "Hire Requests" },
            { id: "projects", label: "Available Projects" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`opps-tab ${tab === t.id ? "active" : ""}`}
            >
              <span>{t.label}</span>
              {t.id === "hireRequests" && hireRequests.length > 0 && (
                <span className={`tab-badge ${tab === t.id ? "tab-badge-active" : ""}`}>{pendingHireCount}</span>
              )}
            </button>
          ))}
        </div>

        <div className="opps-toolbar">
          <label className="opps-search">
            <Search size={18} className="opps-search-icon" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${tab === "hireRequests" ? "hire requests" : "projects"}...`}
            />
          </label>

          {tab === "projects" && (
            <div className="opps-filters">
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="opps-select">
                <option value="">All Categories</option>
                {[
                  "Photographer",
                  "Videographer",
                  "DJ",
                  "Singer",
                  "Dancer",
                  "Anchor",
                  "Makeup Artist",
                  "Mehendi Artist",
                  "Decorator",
                  "Wedding Planner",
                  "Choreographer",
                  "Band / Live Music",
                  "Magician / Entertainer",
                  "Artist",
                  "Event Organizer",
                ].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {tab === "hireRequests" && (
          <section className="opps-list">
            {loadingHire ? (
              <p className="opps-feedback">Loading hire requests...</p>
            ) : hireError ? (
              <p className="opps-feedback is-error">{hireError}</p>
            ) : filteredHire.length === 0 ? (
              <div className="opps-empty">
                <div className="opps-empty-icon">
                  <Briefcase size={32} />
                </div>
                <p>No hire requests yet. Make sure your profile is complete!</p>
              </div>
            ) : (
              filteredHire.map((r) => <HireRequestCard key={r.request_id} req={r} onRespond={handleRespond} />)
            )}
          </section>
        )}

        {tab === "projects" && (
          <section className="opps-list">
            {loadingProjects ? (
              <p className="opps-feedback">Loading projects...</p>
            ) : projectError ? (
              <p className="opps-feedback is-error">{projectError}</p>
            ) : filteredProjects.length === 0 ? (
              <div className="opps-empty">
                <div className="opps-empty-icon">
                  <FolderKanban size={32} />
                </div>
                <p>No open projects available right now.</p>
              </div>
            ) : (
              filteredProjects.map((p) => (
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
      </div>

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
