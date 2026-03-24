import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { clientService } from "../services";
import "./PostProject.css";

const CATEGORIES = [
  { id: "photography", name: "Photography", icon: "📷" },
  { id: "videography", name: "Videography", icon: "🎥" },
  { id: "dj", name: "DJ", icon: "🎵" },
  { id: "catering", name: "Catering", icon: "🍽️" },
  { id: "decoration", name: "Decoration", icon: "🎨" },
  { id: "music", name: "Music / Band", icon: "🎸" },
  { id: "dance", name: "Dance & Choreography", icon: "💃" },
  { id: "anchor", name: "Anchor / Emcee", icon: "🎤" },
  { id: "web", name: "Web & App Dev", icon: "💻" },
  { id: "graphic", name: "Graphic Design", icon: "🎨" },
  { id: "content", name: "Content Writing", icon: "✍️" },
  { id: "editing", name: "Video Editing", icon: "🎬" },
  { id: "animation", name: "Animation", icon: "🎭" },
  { id: "other", name: "Other", icon: "⭐" }
];

export default function PostProject() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [form, setForm] = useState({
    title: "",
    category: "",
    location: "",
    budgetType: "",
    description: "",
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!user?.id) {
      setError("You must be logged in as a client to post a project.");
      return;
    }
    if (!form.category.trim()) {
      setError("Please select a category.");
      return;
    }
    if (form.description.trim().length < 20) {
      setError("Please provide a more detailed description (at least 20 characters).");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const res = await clientService.postProject(user.id, form);
      if (res.success) {
        setSuccess(`Project posted! (ID: ${res.project_id})`);
        setForm({ title: "", category: "", location: "", budgetType: "", description: "" });
        setTimeout(() => navigate("/client/projects"), 1800);
      } else {
        setError(res.msg || "Failed to post project. Please try again.");
      }
    } catch (err) {
      setError(err.message || "Failed to post project.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="post-project-page">
      {/* Hero Section */}
      <div className="post-project-hero">
        <div className="post-project-hero-content">
          <h1>Post a New Project</h1>
          <p>Find talented artists and freelancers for your event or project.</p>
        </div>
        <div className="post-project-float post-project-f1">🎯</div>
        <div className="post-project-float post-project-f2">⭐</div>
        <div className="post-project-float post-project-f3">🚀</div>
        <div className="post-project-float post-project-f4">💎</div>
      </div>

      {/* Success/Error Messages */}
      {success && (
        <div className="post-project-message post-project-success">
          {success}
        </div>
      )}
      {error && (
        <div className="post-project-message post-project-error">
          {error}
        </div>
      )}

      {/* Main Content */}
      <div className="post-project-grid">
        {/* Form Section */}
        <div className="post-project-form-section">
          <form className="post-project-form" onSubmit={handleSubmit}>
            <div className="post-project-field">
              <label className="post-project-label">Project Title</label>
              <input
                type="text"
                value={form.title}
                onChange={set("title")}
                placeholder="e.g. Wedding Photography for 200 guests"
                required
                className="post-project-input"
              />
            </div>

            <div className="post-project-field">
              <label className="post-project-label">Category *</label>
              <div className="post-project-category-grid">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, category: cat.name }))}
                    className={`post-project-category-item ${
                      form.category === cat.name ? "post-project-category-active" : ""
                    }`}
                  >
                    <span className="post-project-category-icon">{cat.icon}</span>
                    <span className="post-project-category-name">{cat.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="post-project-row">
              <div className="post-project-field">
                <label className="post-project-label">Location</label>
                <input
                  type="text"
                  value={form.location}
                  onChange={set("location")}
                  placeholder="City or area"
                  className="post-project-input"
                />
              </div>

              <div className="post-project-field">
                <label className="post-project-label">Budget Type</label>
                <select 
                  value={form.budgetType} 
                  onChange={set("budgetType")} 
                  className="post-project-input"
                >
                  <option value="">Select budget type…</option>
                  <option value="fixed">Fixed Price</option>
                  <option value="hourly">Hourly Rate</option>
                  <option value="negotiable">Negotiable</option>
                </select>
              </div>
            </div>

            <div className="post-project-field">
              <label className="post-project-label">Project Description *</label>
              <textarea
                value={form.description}
                onChange={set("description")}
                placeholder="Describe your project, requirements, timeline, and any special details…"
                required
                rows="5"
                className="post-project-input post-project-textarea"
              />
              <div className="post-project-char-count">
                {form.description.length} characters (min 20)
              </div>
            </div>

            <button 
              type="submit" 
              className="post-project-submit" 
              disabled={loading}
            >
              {loading ? "Posting…" : "Find Artists for My Project"}
            </button>
          </form>
        </div>

        {/* Side Panel */}
        <div className="post-project-side">
          <div className="post-project-info-card">
            <div className="post-project-card-icon">🎯</div>
            <h4>Smart Matching</h4>
            <p>We match your project with the most relevant artists based on skills, location, and availability.</p>
          </div>

          <div className="post-project-info-card">
            <div className="post-project-card-icon">🔒</div>
            <h4>Secure Payments</h4>
            <p>Your payment is protected until work is complete. We hold funds in escrow for your safety.</p>
          </div>

          <div className="post-project-info-card">
            <div className="post-project-card-icon">⚡</div>
            <h4>Fast Responses</h4>
            <p>Artists typically respond within a few hours. Get multiple quotes to compare and choose the best fit.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
