import React, { useEffect, useState } from 'react';
import { useFavorites } from '../hooks/useFavorites';
import { useNavigate } from 'react-router-dom';
import { clientService } from '../services';
import { useAuth } from '../context/AuthContext';

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

function mapFreelancer(f) {
  return {
    id: f.freelancer_id || f.id,
    name: f.name || "Artist",
    category: f.category || "",
    rating: parseFloat(f.rating) || 0,
    description: f.bio || "",
    image: f.profile_image || `https://ui-avatars.com/api/?name=${encodeURIComponent(f.name || "A")}&background=random&size=128`,
    experience: f.experience ? `${f.experience} Years` : "",
    portfolio: f.skills ? (typeof f.skills === "string" ? f.skills.split(",").map(s => s.trim()).filter(Boolean) : f.skills) : [],
    priceRange: getPriceDisplay(f),
    availability: f.availability_status === "AVAILABLE" ? "Immediate" : "Flexible",
    online: f.availability_status === "AVAILABLE",
  };
}

export default function FavoritesPage() {
  const { toggleFavorite } = useFavorites();
  const { user } = useAuth();
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    
    clientService.getSavedFreelancers(user.id)
      .then((data) => {
        const arr = Array.isArray(data) ? data : (data?.results || []);
        setArtists(arr.map(mapFreelancer));
      })
      .catch(() => setError("Failed to load liked artists."))
      .finally(() => setLoading(false));
  }, [user]);

  const handleToggleFav = async (id) => {
    await toggleFavorite(id);
    // Optimistic remove from local view for better UX on Favorites page
    setArtists(prev => prev.filter(a => a.id !== id));
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh', fontSize: '18px', color: '#64748b' }}>
        Loading favorites...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0', color: '#ef4444' }}>
        {error}
      </div>
    );
  }

  return (
    <main className="ba-wrap" style={{ marginTop: '24px' }}>
      <header className="ba-header">
        <h1>My Liked Freelancers</h1>
        <p style={{ color: '#64748b', fontSize: '15px' }}>Here are all the artists you've saved.</p>
      </header>

      <section className="ba-grid" style={{ gridTemplateColumns: '1fr', marginTop: '24px' }}>
        <div className="ba-results">
          {artists.length === 0 ? (
            <div className="ba-empty" style={{ padding: '60px 0', background: '#fff', borderRadius: '16px', border: '1px solid #e9f0ff' }}>
              <div className="ba-empty-illus" style={{ fontSize: '48px', marginBottom: '16px' }}>❤️</div>
              <div className="ba-empty-title">No liked freelancers</div>
              <div className="ba-empty-sub">Explore artists and click the heart icon to save them here.</div>
              <button 
                onClick={() => navigate('/browse-artists')} 
                style={{ marginTop: '24px', padding: '12px 24px', background: '#2563eb', color: 'white', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 600 }}
              >
                Browse Artists
              </button>
            </div>
          ) : (
            artists.map((a) => (
              <article className="ba-card" key={a.id} style={{ position: 'relative' }}>
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
                    <button className="ba-view">Message</button>
                  </div>
                </div>
                <div className="ba-card-right" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                  <button 
                    onClick={() => handleToggleFav(a.id)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '24px', padding: '0', margin: '0', transition: 'transform 0.2s' }}
                    title="Remove from favorites"
                    onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                    onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    ❤️
                  </button>
                  <div className="ba-rating">⭐ {a.rating}</div>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
