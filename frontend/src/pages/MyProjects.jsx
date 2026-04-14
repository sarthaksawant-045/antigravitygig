import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { clientService } from "../services";
import RaiseDisputeModal from "../components/RaiseDisputeModal.jsx";
import "./MyProjects.css";

const ICONS = {
  user: "\u{1F464}",
  date: "\u{1F4C5}",
  money: "\u{1F4B0}",
  folder: "\u{1F5C2}\uFE0F",
  location: "\u{1F4CD}",
  check: "\u2705",
  pending: "\u23F3",
  separator: "\u00B7",
  rupee: "\u20B9",
};

export default function MyProjects() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedContract, setSelectedContract] = useState(null);
  const [disputeModalOpen, setDisputeModalOpen] = useState(false);
  const [submittingDispute, setSubmittingDispute] = useState(false);

  useEffect(() => {
    if (!user?.id) return;

    async function fetchData() {
      setLoading(true);
      setError("");
      try {
        // 1. Fetch posted projects
        const res = await clientService.getProjects(user.id);
        if (res.success) {
          setProjects(res.projects || []);
        }
        
        // 2. Fetch contract projects (hires)
        const cRes = await clientService.getContractProjects(user.id);
        if (cRes.success) {
          setContracts(cRes.projects || []);
        }
      } catch (err) {
        setError("Could not load data. Please try again.");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [user?.id]);

  const handleVerify = async (projectId) => {
    if (!window.confirm("Approve this work and release payment?")) return;
    try {
      const res = await clientService.verifyProject(user.id, projectId);
      if (res.success) {
        alert("Project verified! Payout requested.");
        // Refresh contracts
        const cRes = await clientService.getContractProjects(user.id);
        if (cRes.success) setContracts(cRes.projects || []);
      } else {
        alert(res.msg || "Failed to verify.");
      }
    } catch (err) {
      alert("Error verifying project.");
    }
  };

  const handleOpenDispute = (contract) => {
    setSelectedContract(contract);
    setDisputeModalOpen(true);
  };

  const handleRaiseDispute = async (reason) => {
    if (!selectedContract || !user?.id) return false;
    setSubmittingDispute(true);
    try {
      const res = await clientService.raiseTicket(selectedContract.id, user.id, reason);
      if (res.success) {
        alert(res.msg || "Dispute raised successfully.");
        const cRes = await clientService.getContractProjects(user.id);
        if (cRes.success) setContracts(cRes.projects || []);
        setDisputeModalOpen(false);
        setSelectedContract(null);
        return true;
      }
      alert(res.msg || "Failed to raise dispute.");
      return false;
    } catch (err) {
      alert(err.message || "Failed to raise dispute.");
      return false;
    } finally {
      setSubmittingDispute(false);
    }
  };

  const getStatusBadge = (project) => {
    if (project.status === "completed") return { text: "Completed", color: "gray" };
    if (project.status === "active") return { text: "Active", color: "blue" };
    return { text: "Pending", color: "yellow" };
  };

  if (!user?.isAuthenticated) {
    navigate("/login/client");
    return null;
  }

  if (loading) {
    return (
      <div className="my-projects-container">
        <div className="my-projects-header">
          <div className="skeleton skeleton-title"></div>
          <div className="skeleton skeleton-subtitle"></div>
        </div>
        <div className="projects-grid">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="project-card" style={{ padding: '20px' }}>
               <div className="skeleton skeleton-title" style={{ width: '80%' }}></div>
               <div className="skeleton skeleton-text" style={{ width: '100%', height: '80px', margin: '16px 0' }}></div>
               <div className="skeleton skeleton-text" style={{ width: '40%' }}></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="my-projects-container">
      <div className="my-projects-header">
        <h1>My Projects</h1>
        <p>Manage and track your posted projects</p>
        <button
          className="post-project-btn"
          onClick={() => navigate("/client/post-project")}
        >
          + Post New Project
        </button>
      </div>

      {error && (
        <div className="projects-alert">
          {error}
        </div>
      )}

      {/* Active Contracts Section */}
      <div className="section-divider"></div>
      <div className="my-projects-header">
        <h1>Active Contracts</h1>
        <p>Direct hires and ongoing projects</p>
      </div>

      {contracts.length === 0 ? (
        <div className="empty-state">
          <p>No active contracts found.</p>
        </div>
      ) : (
        <div className="projects-grid">
          {contracts.map(contract => (
            <div key={contract.id} className="project-card contract-card">
              <div className="card-header">
                <h3>{contract.title || 'Gig Project'}</h3>
                <span className={`status-badge ${contract.status.toLowerCase()}`}>
                  {contract.status}
                </span>
              </div>
              
              <div className="location-info">
                <span>{ICONS.user} {contract.freelancer_name}</span>
                <span>{ICONS.separator} {ICONS.date} {contract.start_date}</span>
              </div>

              <div className="project-meta">
                <span className="budget">{ICONS.money} {ICONS.rupee}{contract.agreed_price?.toLocaleString()}</span>
              </div>

              <div className="card-footer">
                <div className="project-contract-actions">
                  {contract.status === "COMPLETED" ? (
                    <button 
                      className="project-action-btn"
                      onClick={() => handleVerify(contract.id)}
                    >
                      Verify & Release Payout
                    </button>
                  ) : (
                    <div className="contract-status-note">
                      {contract.status === "VERIFIED" ? `${ICONS.check} Payout Requested` : `${ICONS.pending} Work in Progress`}
                    </div>
                  )}

                  {['ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED'].includes(String(contract.status || '').toUpperCase()) &&
                    !['PAID', 'REFUNDED', 'DISPUTED'].includes(String(contract.payment_status || '').toUpperCase()) && (
                      <button
                        className="project-action-btn-danger"
                        onClick={() => handleOpenDispute(contract)}
                      >
                        Raise Dispute
                      </button>
                    )}

                  {String(contract.payment_status || '').toUpperCase() === 'DISPUTED' && (
                    <div className="contract-status-note disputed">
                      Dispute Raised
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-divider"></div>
      <div className="my-projects-header">
        <h1>Job Posts</h1>
        <p>Marketplace listings</p>
      </div>

      {projects.length === 0 ? (
        <div className="empty-state">
          <h3>No projects posted yet</h3>
          <p>Start by posting your first project to connect with talented artists</p>
          <button className="post-project-btn" onClick={() => navigate("/client/post-project")}>
            Post a Project
          </button>
        </div>
      ) : (
        <div className="projects-grid">
          {projects.map(project => {
            const statusBadge = getStatusBadge(project);
            return (
              <div key={project.id} className="project-card">
                <div className="card-header">
                  <h3>{project.title || project.category}</h3>
                  <span className={`status-badge ${statusBadge.color}`}>
                    {statusBadge.text}
                  </span>
                </div>

                <div className="location-info">
                  <span>{ICONS.folder} {project.category}</span>
                  {project.location && <span>{ICONS.separator} {ICONS.location} {project.location}</span>}
                </div>

                <p className="description">{project.description}</p>

                <div className="project-meta">
                  {project.budget_type && (
                    <span className="budget">{ICONS.money} {project.budget_type}</span>
                  )}
                  <span className="deadline">{ICONS.date} {project.created_at ? new Date(project.created_at * 1000).toLocaleDateString() : ""}</span>
                </div>

                <div className="card-footer project-card-footer">
                  <span className={`status-text ${project.status === "ASSIGNED" ? "active" : "pending"}`}>
                    {project.status === "ASSIGNED" ? `${ICONS.check} Artist Hired` : `${ICONS.pending} Awaiting Applications`}
                  </span>
                  <button 
                    className="view-applicants-btn"
                    onClick={() => navigate(`/project/${project.id}/applicants`)}
                  >
                    View Applicants
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <RaiseDisputeModal
        open={disputeModalOpen}
        projectTitle={selectedContract?.title || "Gig Project"}
        onClose={() => {
          if (submittingDispute) return;
          setDisputeModalOpen(false);
          setSelectedContract(null);
        }}
        onSubmit={handleRaiseDispute}
        loading={submittingDispute}
      />
    </div>
  );
}

