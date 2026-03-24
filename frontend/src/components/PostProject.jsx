import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { clientService } from "../services";

const CATEGORIES = [
  "Photography","Videography","DJ","Catering","Decoration",
  "Music / Band","Dance & Choreography","Anchor / Emcee","Web & App Dev",
  "Graphic Design","Content Writing","Video Editing","Animation","Other"
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
    <div className="pp-wrap">
      <header className="pp-header">
        <h1>Post a New Project</h1>
        <p>Find talented artists and freelancers for your event or project.</p>
      </header>

      {success && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#16a34a', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', textAlign: 'center' }}>
          {success}
        </div>
      )}
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', textAlign: 'center' }}>
          {error}
        </div>
      )}

      <form className="pp-form" onSubmit={handleSubmit}>
        <div className="pp-field">
          <label>Project Title</label>
          <input
            type="text"
            value={form.title}
            onChange={set("title")}
            placeholder="e.g. Wedding Photography for 200 guests"
            required
            className="pp-input"
          />
        </div>

        <div className="pp-field">
          <label>Category *</label>
          <select value={form.category} onChange={set("category")} required className="pp-input">
            <option value="">Select a category…</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="pp-field">
          <label>Location</label>
          <input
            type="text"
            value={form.location}
            onChange={set("location")}
            placeholder="City or area"
            className="pp-input"
          />
        </div>

        <div className="pp-field">
          <label>Budget Type</label>
          <select value={form.budgetType} onChange={set("budgetType")} className="pp-input">
            <option value="">Select budget type…</option>
            <option value="fixed">Fixed Price</option>
            <option value="hourly">Hourly Rate</option>
            <option value="negotiable">Negotiable</option>
          </select>
        </div>

        <div className="pp-field">
          <label>Project Description *</label>
          <textarea
            value={form.description}
            onChange={set("description")}
            placeholder="Describe your project, requirements, timeline, and any special details…"
            required
            rows="5"
            className="pp-input"
          />
          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
            {form.description.length} characters (min 20)
          </span>
        </div>

        <button type="submit" className="pp-submit" disabled={loading}>
          {loading ? "Posting…" : "Find Artists for My Project"}
        </button>
      </form>

      <section className="pp-info-cards">
        <article className="pp-info-card">
          <div className="pp-card-ico">🎯</div>
          <h4>Smart Matching</h4>
          <p>We match your project with the most relevant artists.</p>
        </article>
        <article className="pp-info-card">
          <div className="pp-card-ico">🔒</div>
          <h4>Secure Payments</h4>
          <p>Your payment is protected until work is complete.</p>
        </article>
        <article className="pp-info-card">
          <div className="pp-card-ico">⚡</div>
          <h4>Fast Responses</h4>
          <p>Artists typically respond within a few hours.</p>
        </article>
      </section>
    </div>
  );
}
