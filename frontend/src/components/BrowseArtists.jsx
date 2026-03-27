import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { freelancerService } from "../services";
import { useFavorites } from "../hooks/useFavorites";
import socketService from '../services/socketService';

const VALID_CATEGORIES = [
  "Photographer","Videographer","DJ","Singer","Dancer","Anchor",
  "Makeup Artist","Mehendi Artist","Decorator","Wedding Planner",
  "Choreographer","Band / Live Music","Magician / Entertainer","Artist","Event Organizer"
];

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

/** Map backend freelancer object to the shape the card renders */
function mapFreelancer(f) {
  return {
    id: f.freelancer_id || f.id,
    name: f.name || "Artist",
    category: f.category || "",
    rating: parseFloat(f.rating) || 0,
    description: f.bio || f.description || "",
    image: f.profile_image || `https://ui-avatars.com/api/?name=${encodeURIComponent(f.name || "A")}&background=random&size=128`,
    experience: f.experience ? `${f.experience} Years` : "",
    portfolio: f.skills ? (typeof f.skills === "string" ? f.skills.split(",").map(s => s.trim()).filter(Boolean) : f.skills) : [],
    priceRange: getPriceDisplay(f),
    availability: f.availability_status === "AVAILABLE" ? "Immediate" : f.availability_status === "BUSY" ? "This Week" : "Flexible",
    online: f.availability_status === "AVAILABLE",
  };
}

export default function BrowseArtists() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toggleFavorite, isFavorite } = useFavorites();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("relevant");

  const [inviteId, setInviteId] = useState(null);
  const [inviteText, setInviteText] = useState("");
  const [resetPulse, setResetPulse] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);

  const [selectedCategories, setSelectedCategories] = useState([]);
  const [budget, setBudget] = useState("");
  const [avail, setAvail] = useState("");

  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Fetch real artists from backend
  useEffect(() => {
    async function fetchArtists() {
      setLoading(true);
      setError("");
      try {
        const res = await freelancerService.getAllFreelancers();
        const results = res.results || [];
        setArtists(results.map(mapFreelancer));
      } catch (err) {
        setError("Could not load artists. Please try again.");
        setArtists([]);
      } finally {
        setLoading(false);
      }
    }
    fetchArtists();
  }, []);

  const toggle = (arr, setter, v) =>
    setter((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  const filteredArtists = useMemo(() => {
    const base = artists.filter(
      (a) =>
        a.name.toLowerCase().includes(q.toLowerCase()) ||
        (a.category || "").toLowerCase().includes(q.toLowerCase()) ||
        (a.portfolio || []).join(" ").toLowerCase().includes(q.toLowerCase())
    );
    const byCat = selectedCategories.length ? base.filter((a) => selectedCategories.includes(a.category)) : base;
    const byAvail = avail ? byCat.filter((a) => a.availability === avail) : byCat;
    if (sort === "rating") return [...byAvail].sort((a, b) => b.rating - a.rating);
    return byAvail;
  }, [artists, q, sort, selectedCategories, avail]);

  // Handle sending message to freelancer
  const handleSendMessage = async (freelancerId) => {
    if (!user.isAuthenticated || !user.id) {
      alert("Please login to send messages.");
      return;
    }

    if (!inviteText.trim()) {
      alert("Please enter a message.");
      return;
    }

    setSendingMessage(true);
    
    try {
      // Step 1: Create or get conversation
      console.log('[BROWSE] Creating/getting conversation...');
      // The second request is 'fetch' for the created conversation json... wait! 
      // I am just modifying fetch options for formatting but I need to make sure the curly brace matches!
      // Here I am just preserving the fetch block for conversations:
      const convResponse = await fetch('https://antigravitygig-2.onrender.com/conversations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender_id: user.id,
          receiver_id: freelancerId,
          sender_role: user.role
        })
      });

      const convData = await convResponse.json();
      
      if (!convResponse.ok || !convData.success) {
        console.error('[BROWSE] Failed to create/get conversation:', convData.msg || convData);
        alert('Failed to start conversation. Please try again.');
        setSendingMessage(false);
        return;
      }

      const conversationId = convData.conversation_id;
      console.log('[BROWSE] Conversation ID:', conversationId);

      // Step 2: Send message using unified message API
      const apiUrl = 'https://antigravitygig-2.onrender.com/message/send';
      
      const payload = {
        conversation_id: conversationId,
        sender_id: user.id,
        sender_role: user.role,
        message: inviteText.trim()
      };

      console.log('[BROWSE] Sending message:', payload);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      
      if (response.ok && data.success) {
        console.log('[BROWSE] Message sent successfully');
        
        // Close modal and reset form
        setInviteId(null);
        setInviteText("");
        
        // Navigate to messages page to show the conversation
        navigate('/messages');
        
        // Show success message
        alert('Message sent successfully! You can continue the conversation in Messages.');
        
      } else {
        console.error('[BROWSE] Failed to send message:', data.msg);
        alert('Failed to send message. Please try again.');
      }
    } catch (error) {
      console.error('[BROWSE] Error sending message:', error);
      alert('Failed to send message. Please try again.');
    } finally {
      setSendingMessage(false);
    }
  };

  return (
    <main className="ba-wrap">
      <header className="ba-header">
        <h1>Browse Artists</h1>
        <div className="ba-searchbar">
          <div className="ba-search">
            <span className="ba-search-ico">🔎</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search for dancers, singers, photographers, and more…"
            />
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="ba-sort">
            <option value="relevant">Most Relevant</option>
            <option value="rating">Highest Rated</option>
          </select>
        </div>
      </header>

      <section className="ba-grid">
        <aside className="ba-filters">
          <div className="ba-f-title">Filters</div>

          <div className="ba-filter-sec">
            <div className="ba-sec-title">Artist Categories</div>
            <div className="ba-pills">
              {VALID_CATEGORIES.map((x) => (
                <button
                  key={x}
                  className={`chip ${selectedCategories.includes(x) ? "chip-active" : ""}`}
                  onClick={() => toggle(selectedCategories, setSelectedCategories, x)}
                >
                  {x}
                </button>
              ))}
            </div>
          </div>

          <div className="ba-filter-sec">
            <div className="ba-sec-title">Availability</div>
            <div className="ba-pills">
              {["Immediate", "This Week", "Flexible"].map((x) => (
                <button
                  key={x}
                  className={`seg ${avail === x ? "seg-active" : ""}`}
                  onClick={() => setAvail(avail === x ? "" : x)}
                >
                  {x}
                </button>
              ))}
            </div>
          </div>

          <button
            className="ba-clear"
            onClick={() => {
              setSelectedCategories([]); setBudget(""); setAvail("");
              setResetPulse(true); setTimeout(() => setResetPulse(false), 240);
            }}
          >
            Reset Filters
          </button>
        </aside>

        <div className={`ba-results ${resetPulse ? "ba-pulse" : ""}`}>
          <div className="ba-meta">Showing {filteredArtists.length} talented artists</div>

          {error && (
            <div style={{ color: "#dc2626", padding: "1rem", textAlign: "center" }}>{error}</div>
          )}

          {loading ? (
            <>
              {[1, 2, 3].map(n => (
                <article className="ba-card skeleton-card-legacy" key={n}>
                  <div className="ba-card-left">
                    <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: '#e2e8f0', animation: 'shimmer 1.5s infinite linear' }}></div>
                  </div>
                  <div className="ba-card-mid" style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
                    <div style={{ width: '50%', height: '24px', background: '#e2e8f0', borderRadius: '4px', animation: 'shimmer 1.5s infinite linear' }}></div>
                    <div style={{ width: '30%', height: '16px', background: '#e2e8f0', borderRadius: '4px', animation: 'shimmer 1.5s infinite linear' }}></div>
                    <div style={{ width: '90%', height: '12px', background: '#e2e8f0', borderRadius: '4px', marginTop: '10px', animation: 'shimmer 1.5s infinite linear' }}></div>
                  </div>
                </article>
              ))}
            </>
          ) : filteredArtists.length === 0 ? (
            <div className="ba-empty">
              <div className="ba-empty-illus">🎭</div>
              <div className="ba-empty-title">No artists found</div>
              <div className="ba-empty-sub">Try adjusting your filters or check back later.</div>
            </div>
          ) : (
            filteredArtists.map((a) => (
              <article className="ba-card" key={a.id}>
                <div className="ba-card-left">
                  <div className="ba-avatar-wrap">
                    <img src={a.image} alt={a.name} className="ba-avatar" />
                    {a.online && <span className="ba-online" />}
                  </div>
                </div>
                <div className="ba-card-mid">
                  <div className="ba-name">{a.name}</div>
                  <div className="ba-role" onClick={() => navigate(`/artist/${a.id}`)}>{a.category}</div>
                  <p className="ba-bio">{a.description}</p>
                  <div className="ba-tags">
                    {(a.portfolio || []).map((t) => <span key={t} className="ba-tag">{t}</span>)}
                  </div>
                  <div className="ba-actions">
                    <button className="ba-invite" onClick={() => navigate(`/artist/${a.id}`)}>Know More About</button>
                    <button className="ba-view" onClick={() => setInviteId(a.id)}>Message</button>
                  </div>
                </div>
                <div className="ba-card-right" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                  <button
                    onClick={() => toggleFavorite(a.id)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '24px', padding: '0', margin: '0', transition: 'transform 0.2s' }}
                    title={isFavorite(a.id) ? "Remove from favorites" : "Add to favorites"}
                    onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                    onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    {isFavorite(a.id) ? "❤️" : "🤍"}
                  </button>
                  <div className="ba-rating">⭐ {a.rating || "—"}</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{a.priceRange}</div>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      {inviteId && (
        <div className="ba-modal">
          <div className="ba-modal-inner">
            <h3>Message Artist</h3>
            <p>Send a quick message to discuss your project.</p>
            <textarea
              rows="4"
              value={inviteText}
              onChange={(e) => setInviteText(e.target.value)}
              placeholder="Hi! I'd love to know more about your work…"
            />
            <div className="ba-modal-actions">
              <button className="ba-view" onClick={() => { setInviteId(null); setInviteText(""); }}>Cancel</button>
              <button
                className="ba-invite"
                onClick={() => {
                  // Send the message directly
                  handleSendMessage(inviteId);
                }}
                disabled={sendingMessage}
              >
                {sendingMessage ? 'Sending...' : 'Send Message'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
