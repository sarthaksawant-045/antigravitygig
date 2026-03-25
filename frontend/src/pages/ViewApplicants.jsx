import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import "./ViewApplicants.css";

export default function ViewApplicants() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { user } = useAuth();
  
  const [project, setProject] = useState(null);
  const [applicants, setApplicants] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.id) {
      fetchProjectAndApplicants();
    }
  }, [id, user?.id]);

  const fetchProjectAndApplicants = async () => {
    setLoading(true);
    try {
      // 1. Fetch project details by finding it in client's project list
      const projRes = await clientService.getProjects(user.id);
      if (projRes.success) {
        const found = projRes.projects.find(p => p.id === parseInt(id));
        setProject(found || null);
      }

      // 2. Fetch applicants
      const appRes = await clientService.getProjectApplicants(user.id, id);
      if (appRes.success) {
        setApplicants(appRes.applicants || []);
      }
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (applicant) => {
    try {
      const res = await clientService.acceptApplication(user.id, id, applicant.application_id);
      if (res.success) {
        alert("Applicant selected successfully!");
        fetchProjectAndApplicants(); // reload
      } else {
        alert(res.msg || "Failed to accept applicant.");
      }
    } catch (err) {
      alert("Error accepting applicant.");
    }
  };

  const handleReject = (applicantId) => {
    alert("Reject API not fully wired on backend, but application can be ignored.");
  };

  const handleGoBack = () => {
    navigate("/my-projects");
  };

  const handleMessageArtist = (artistId) => {
    navigate(`/messages?artist=${artistId}`);
  };

  const viewPortfolio = (artist) => {
    // Mock portfolio view
    alert(`Viewing portfolio for ${artist.name}`);
  };

  if (!user.isAuthenticated) {
    navigate("/login/client");
    return null;
  }

  if (loading) {
    return (
      <div className="view-applicants-container">
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Loading project details...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="view-applicants-container">
        <div className="error-state">
          <h3>Project Not Found</h3>
          <p>The project you're looking for doesn't exist.</p>
          <button onClick={handleGoBack} className="back-btn">Back to My Projects</button>
        </div>
      </div>
    );
  }

  const selectedApp = applicants.find(a => a.status === "ACCEPTED");
  const pendingApps = applicants.filter(a => a.status === "PENDING" || a.status === "pending");

  return (
    <div className="view-applicants-container">
      <div className="applicants-header">
        <button className="back-btn" onClick={handleGoBack}>
          ← Back to My Projects
        </button>
        <div className="project-info">
          <h1>Applicants for {project?.category || "Project"}</h1>
          <p>{project?.location || "Remote"}</p>
          {project?.budget_type && (
            <span className="budget-badge">💰 Budget: {project.budget_type}</span>
          )}
        </div>
      </div>

      <div className="project-description">
        <h3>Project Description</h3>
        <p>{project?.description}</p>
      </div>

      {pendingApps.length === 0 && !selectedApp ? (
        <div className="no-applicants">
          <h3>No pending applicants</h3>
          <p>All applicants have been reviewed or no one has applied yet.</p>
        </div>
      ) : (
        <div className="applicants-list">
          <h2>Pending Applicants ({pendingApps.length})</h2>
          {pendingApps.map(applicant => (
            <div key={applicant.application_id} className="applicant-card">
              <div className="applicant-header">
                <div className="opp-avatar">
                  {applicant.freelancer_name?.slice(0,1).toUpperCase()}
                </div>
                <div className="applicant-info">
                  <h3>{applicant.freelancer_name}</h3>
                  <p className="applicant-category">{applicant.freelancer_title || "Freelancer"}</p>
                  <div className="applicant-meta">
                    {applicant.bid_amount > 0 && (
                      <div className="applicant-rate">
                        Bid: ₹{applicant.bid_amount}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="applicant-bio" style={{ marginTop: '1rem' }}>
                <h4>Proposal:</h4>
                <p>{applicant.proposal || "No proposal text provided."}</p>
              </div>

              {applicant.freelancer_skills && (
                <div className="applicant-skills">
                  <h4>Skills</h4>
                  <div className="skills-list">
                    {String(applicant.freelancer_skills).split(',').map((skill, index) => (
                      <span key={index} className="skill-tag">{skill.trim()}</span>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="applicant-actions">
                <button 
                  className="accept-btn"
                  onClick={() => handleAccept(applicant)}
                >
                  Hire
                </button>
                <button 
                  className="message-btn"
                  onClick={() => handleMessageArtist(applicant.freelancer_id)}
                >
                  Message
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedApp && (
        <div className="selected-notice" style={{ background: '#ecfdf5', border: '1px solid #10b981', padding: '1.5rem', borderRadius: '12px', marginTop: '2rem' }}>
          <h3 style={{ color: '#065f46', display: 'flex', alignItems: 'center', gap: '8px' }}>
            ✓ Hired Applicant
          </h3>
          <div className="selected-artist-info" style={{ display: 'flex', gap: '12px', alignItems: 'center', margin: '1rem 0' }}>
            <div className="opp-avatar" style={{ background: '#10b981', color: 'white' }}>
              {selectedApp.freelancer_name?.slice(0,1).toUpperCase()}
            </div>
            <div>
              <p style={{ margin: 0, fontWeight: 600 }}>{selectedApp.freelancer_name}</p>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#4b5563' }}>{selectedApp.freelancer_title}</p>
            </div>
          </div>
          <div className="selected-actions">
            <button className="message-btn" onClick={() => handleMessageArtist(selectedApp.freelancer_id)}>
              Message Artist
            </button>
            <button 
              style={{ background: '#2563eb', color: 'white', border: 'none', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, marginLeft: '10px' }}
              onClick={() => navigate("/payment")}
            >
              Go to Payments to pay invoice
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
