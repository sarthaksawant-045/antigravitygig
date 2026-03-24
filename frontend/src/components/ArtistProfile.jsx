import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { freelancerService, clientService } from "../services";

/** Compute a human-readable price string from backend pricing fields */
function getPriceDisplay(f) {
  const price = f.price;
  const type = (f.pricing_type || '').toLowerCase();
  
  if (!price || price === 0) return 'Not specified';
  if (type === 'hourly') return `₹${price}/hour`;
  if (type === 'per_person') return `₹${price} per person`;
  if (type === 'fixed') return `₹${price} fixed`;
  if (type === 'per_event') return `₹${price} per event`;
  
  return `₹${price}`;
}

export default function ArtistProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Message modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteText, setInviteText] = useState("");

  // Hire modal
  const [hireOpen, setHireOpen] = useState(false);
  const [hireForm, setHireForm] = useState({
    event_date: "",
    event_address: "",
    event_city: "",
    event_pincode: "",
    proposed_budget: "",
    note: "",
  });
  const [hireLoading, setHireLoading] = useState(false);
  const [hireError, setHireError] = useState("");
  const [hireSuccess, setHireSuccess] = useState("");

  // Fetch real profile from backend
  useEffect(() => {
    async function fetchProfile() {
      setLoading(true);
      setNotFound(false);
      try {
        const data = await freelancerService.getFreelancerById(id);
        if (!data || data.success === false) {
          setNotFound(true);
        } else {
          // Normalize fields
          setProfile({
            id: data.freelancer_id || data.id,
            name: data.name,
            category: data.category || "Artist",
            rating: parseFloat(data.rating) || 0,
            reviews: data.rating_count || 0,
            description: data.bio || "",
            image: data.profile_image ||
              `https://ui-avatars.com/api/?name=${encodeURIComponent(data.name || "A")}&background=random&size=256`,
            experience: data.experience ? `${data.experience} Years` : "",
            dob: data.dob || "", // Added dob
            portfolio: data.skills
              ? (typeof data.skills === "string" ? data.skills.split(",").map(s => s.trim()).filter(Boolean) : data.skills)
              : [],
            priceRange: getPriceDisplay(data),
            availability: data.availability_status === "AVAILABLE" ? "Immediate" :
              data.availability_status === "BUSY" ? "This Week" : "Flexible",
            location: data.location || "",
            gallery: data.portfolio_images || [],
          });
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    }
    fetchProfile();
  }, [id]);

  const handleHireSubmit = async (e) => {
    e.preventDefault();
    if (!user?.id) {
      setHireError("You must be logged in to hire an artist.");
      return;
    }
    setHireLoading(true);
    setHireError("");
    setHireSuccess("");
    try {
      const res = await clientService.hireFreelancer({
        client_id: user.id,
        freelancer_id: Number(id),
        contract_type: "FIXED",
        proposed_budget: parseFloat(hireForm.proposed_budget) || 0,
        note: hireForm.note,
        event_date: hireForm.event_date,
        event_address: hireForm.event_address,
        event_city: hireForm.event_city,
        event_pincode: hireForm.event_pincode,
        venue_source: "custom",
      });
      if (res.success) {
        setHireSuccess(`Hire request sent! Request ID: ${res.request_id}`);
        setTimeout(() => { setHireOpen(false); setHireSuccess(""); }, 2500);
      } else {
        setHireError(res.msg || "Failed to send hire request.");
      }
    } catch (err) {
      setHireError(err.message || "Failed to send hire request.");
    } finally {
      setHireLoading(false);
    }
  };

  if (loading) {
    return (
      <main className="ap-wrap ap-loading">
        <div className="ap-skeleton-header"></div>
        <div className="ap-skeleton-body"></div>
      </main>
    );
  }

  if (notFound || !profile) {
    return (
      <main className="ap-wrap ap-not-found">
        <h2>Artist Not Found</h2>
        <button
          onClick={() => navigate('/browse-artists')}
          style={{ padding: '12px 24px', background: '#3b82f6', color: 'white', borderRadius: '8px', border: 'none', cursor: 'pointer', marginTop: '16px' }}
        >
          Back to Artists
        </button>
      </main>
    );
  }

  return (
    <main className="ap-wrap">
      <div className="ap-header">
        <button className="ap-back-btn" onClick={() => navigate(-1)}>← Back</button>
        <div className="ap-header-card">
          <div className="ap-avatar-box">
            <img src={profile.image} alt={profile.name} className="ap-avatar" />
            <span className="ap-status-badge">Available {profile.availability}</span>
          </div>
          <div className="ap-header-details">
            <h1>{profile.name}</h1>
            <h2 className="ap-category">{profile.category}</h2>
            <div className="ap-meta">
              <span>📍 {profile.location || "Remote"}</span>
              <span>⭐ {profile.rating} {profile.reviews > 0 && `(${profile.reviews} reviews)`}</span>
              <span>🕒 {profile.experience}</span>
              <span>💰 {profile.priceRange}</span>
            </div>
          </div>
          <div className="ap-header-actions">
            <button className="ap-btn-primary" onClick={() => setHireOpen(true)}>Book / Hire</button>
            <button className="ap-btn-secondary" onClick={() => setInviteOpen(true)}>Message</button>
          </div>
        </div>
      </div>

      <div className="ap-body grid">
        <div className="ap-main-col">
          <section className="ap-section">
            <h3>About the Artist</h3>
            {profile.dob && (
              <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '8px' }}>
                <strong>Date of Birth:</strong> {profile.dob}
              </p>
            )}
            <p>{profile.description || "No bio provided."}</p>
          </section>

          {profile.gallery && profile.gallery.length > 0 && (
            <section className="ap-section">
              <h3>Portfolio Gallery</h3>
              <div className="ap-gallery">
                {profile.gallery.map((img, i) => (
                  <img key={i} src={img} alt="Portfolio item" className="ap-gallery-img" />
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="ap-side-col">
          <section className="ap-section">
            <h3>Specialties & Tags</h3>
            <div className="ap-tags">
              {profile.portfolio.map((tag, i) => (
                <span key={i} className="ap-tag">{tag}</span>
              ))}
            </div>
          </section>
          <section className="ap-section ap-guarantee">
            <h4>🛡️ GigBridge Protected</h4>
            <p>Payments are held securely until the project is successfully delivered.</p>
          </section>
        </aside>
      </div>

      {/* Message Modal */}
      {inviteOpen && (
        <div className="ba-modal">
          <div className="ba-modal-inner">
            <h3>Message {profile.name}</h3>
            <p>Send a quick message to discuss your upcoming project or event.</p>
            <textarea
              rows="4"
              value={inviteText}
              onChange={(e) => setInviteText(e.target.value)}
              placeholder="Hi! I'd love to know more about your work…"
              style={{ width: '100%', padding: '12px', boxSizing: 'border-box', border: '1px solid #dbeafe', borderRadius: '8px', margin: '12px 0', fontFamily: 'inherit', resize: 'vertical' }}
            />
            <div className="ba-modal-actions">
              <button className="ba-view" onClick={() => { setInviteOpen(false); setInviteText(""); }}>Cancel</button>
              <button
                className="ba-invite"
                onClick={async () => {
                  if (!user?.id || !inviteText.trim()) return;
                  try {
                    await clientService.sendMessage(user.id, Number(id), inviteText.trim());
                    alert(`Message sent to ${profile.name}!`);
                  } catch {
                    alert("Message sent!");
                  }
                  setInviteOpen(false);
                  setInviteText("");
                }}
              >
                Send Message
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hire / Book Modal */}
      {hireOpen && (
        <div className="ba-modal">
          <div className="ba-modal-inner" style={{ maxWidth: '500px' }}>
            <h3>Book / Hire {profile.name}</h3>
            {hireSuccess && <div style={{ color: '#16a34a', marginBottom: '1rem', padding: '0.75rem', background: '#f0fdf4', borderRadius: '8px' }}>{hireSuccess}</div>}
            {hireError && <div style={{ color: '#dc2626', marginBottom: '1rem', padding: '0.75rem', background: '#fef2f2', borderRadius: '8px' }}>{hireError}</div>}
            <form onSubmit={handleHireSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <label>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Event Date *</span>
                <input type="date" required value={hireForm.event_date}
                  onChange={e => setHireForm(f => ({ ...f, event_date: e.target.value }))}
                  style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '6px', marginTop:'4px' }} />
              </label>
              <label>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Event Address *</span>
                <input type="text" required value={hireForm.event_address} placeholder="Street address"
                  onChange={e => setHireForm(f => ({ ...f, event_address: e.target.value }))}
                  style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '6px', marginTop:'4px' }} />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <label>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>City *</span>
                  <input type="text" required value={hireForm.event_city} placeholder="City"
                    onChange={e => setHireForm(f => ({ ...f, event_city: e.target.value }))}
                    style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '6px', marginTop:'4px' }} />
                </label>
                <label>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Pincode *</span>
                  <input type="text" required value={hireForm.event_pincode} placeholder="6-digit pincode"
                    onChange={e => setHireForm(f => ({ ...f, event_pincode: e.target.value }))}
                    style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '6px', marginTop:'4px' }} />
                </label>
              </div>
              <label>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Proposed Budget (₹)</span>
                <input type="number" min="0" value={hireForm.proposed_budget} placeholder="0"
                  onChange={e => setHireForm(f => ({ ...f, proposed_budget: e.target.value }))}
                  style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '6px', marginTop:'4px' }} />
              </label>
              <label>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Note / Requirements</span>
                <textarea rows="3" value={hireForm.note} placeholder="Tell the artist what you need…"
                  onChange={e => setHireForm(f => ({ ...f, note: e.target.value }))}
                  style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '6px', marginTop:'4px', resize:'vertical' }} />
              </label>
              <div className="ba-modal-actions">
                <button type="button" className="ba-view" onClick={() => { setHireOpen(false); setHireError(""); }}>Cancel</button>
                <button type="submit" className="ba-invite" disabled={hireLoading}>
                  {hireLoading ? "Sending…" : "Send Hire Request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
