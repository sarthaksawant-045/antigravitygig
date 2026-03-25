import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { clientService } from "../services";
import "./MyProjects.css";

export default function MyProjects() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.id) return;

    async function fetchProjects() {
      setLoading(true);
      setError("");
      try {
        const res = await clientService.getProjects(user.id);
        if (res.success) {
          setProjects(res.projects || []);
        } else {
          setError(res.msg || "Failed to load projects.");
        }
      } catch (err) {
        setError("Could not load projects. Please try again.");
      } finally {
        setLoading(false);
      }
    }
    fetchProjects();
  }, [user?.id]);

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
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Loading your projects…</p>
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
