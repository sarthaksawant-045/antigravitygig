import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { clientService } from "../services";
import "./PostProject.css";

const CATEGORIES = [
  { id: "photographer", name: "Photographer", icon: "📷" },
  { id: "videographer", name: "Videographer", icon: "🎥" },
  { id: "dj", name: "DJ", icon: "🎵" },
  { id: "singer", name: "Singer", icon: "🎤" },
  { id: "dancer", name: "Dancer", icon: "💃" },
  { id: "anchor", name: "Anchor", icon: "🎙️" },
  { id: "makeup_artist", name: "Makeup Artist", icon: "💄" },
  { id: "mehendi_artist", name: "Mehendi Artist", icon: "✋" },
  { id: "decorator", name: "Decorator", icon: "🎨" },
  { id: "wedding_planner", name: "Wedding Planner", icon: "💍" },
  { id: "choreographer", name: "Choreographer", icon: "🩰" },
  { id: "band_live_music", name: "Band / Live Music", icon: "🎸" },
  { id: "magician_entertainer", name: "Magician / Entertainer", icon: "🎭" },
  { id: "artist", name: "Artist", icon: "🖌️" },
  { id: "event_organizer", name: "Event Organizer", icon: "📋" },
];

export default function PostProject() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [form, setForm] = useState({
    title: "",
    category: "",
    location: "",
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
        setForm({ title: "", category: "", location: "", description: "" });
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
