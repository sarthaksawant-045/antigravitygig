import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { clientService } from "../services";
import "./MyProjects.css";

export default function MyProjects() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
          style={{ marginTop: '0.5rem' }}
        >
          + Post New Project
        </button>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', color: '#dc2626', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {/* Active Contracts Section */}
      <div className="section-divider" style={{ margin: '2rem 0', borderTop: '2px solid #e2e8f0' }}></div>
      <div className="my-projects-header">
        <h1>Active Contracts</h1>
        <p>Direct hires and ongoing projects</p>
      </div>

      {contracts.length === 0 ? (
        <div className="empty-state" style={{ padding: '2rem' }}>
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
                <span>👤 {contract.freelancer_name}</span>
                <span> · 📅 {contract.start_date}</span>
              </div>

              <div className="project-meta">
                <span className="budget">💰 ₹{contract.agreed_price?.toLocaleString()}</span>
              </div>

              <div className="card-footer" style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #f1f5f9' }}>
                {contract.status === "COMPLETED" ? (
                  <button 
                    style={{ background: '#10b981', color: 'white', border: 'none', padding: '10px 16px', borderRadius: '8px', width: '100%', fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => handleVerify(contract.id)}
                  >
                    Verify & Release Payout
                  </button>
                ) : (
                  <div style={{ color: '#64748b', fontSize: '0.85rem', textAlign: 'center' }}>
                    {contract.status === "VERIFIED" ? "✅ Payout Requested" : "⏳ Work in Progress"}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-divider" style={{ margin: '2rem 0', borderTop: '2px solid #e2e8f0' }}></div>
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
                  <span>🗂️ {project.category}</span>
                  {project.location && <span> · 📍 {project.location}</span>}
                </div>

                <p className="description">{project.description}</p>

                <div className="project-meta">
                  {project.budget_type && (
                    <span className="budget">💰 {project.budget_type}</span>
                  )}
                  <span className="deadline">📅 {project.created_at ? new Date(project.created_at * 1000).toLocaleDateString() : ""}</span>
                </div>

                <div className="card-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #f1f5f9' }}>
                  <span className={`status-text ${project.status === "ASSIGNED" ? "active" : "pending"}`} style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                    {project.status === "ASSIGNED" ? "✅ Artist Hired" : "⏳ Awaiting Applications"}
                  </span>
                  <button 
                    style={{ background: '#2563eb', color: 'white', border: 'none', padding: '8px 14px', borderRadius: '8px', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600 }}
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
    </div>
  );
}
