import React from 'react';

const CATEGORY_MAP = {
  'Dance': 'dance',
  'Photography': 'photography',
  'Music Band': 'music',
  'DJ Performance': 'dj',
  'Makeup Artist': 'makeup',
  'Event Host': 'host'
};

export default function GigActivityCard({ gig }) {
  const categoryClass = CATEGORY_MAP[gig.category] || 'default';
  const statusClass = gig.status.toLowerCase();

  return (
    <div className="gig-activity-card">
      <div className="gig-card-left">
        <h4 className="gig-title">{gig.title}</h4>
        <p className="gig-desc">{gig.description}</p>
        <div className="gig-meta">
          <span className={`category-pill ${categoryClass}`}>{gig.category}</span>
          <span>📅 {gig.date}</span>
        </div>
      </div>
      <div className="gig-card-right" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div className="gig-hours">{gig.hours}h</div>
          <span className={`status-badge ${statusClass}`}>{gig.status}</span>
        </div>
        
        {gig.payment_status === "paid" && gig.event_status !== "completed" && gig.status !== "Completed" && onComplete && (
          <button 
            onClick={() => onComplete(gig.id, gig.freelancer_id)}
            style={{
              padding: '0.4rem 0.8rem',
              backgroundColor: '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Mark as Complete
          </button>
        )}
      </div>
    </div>
  );
}
