import React from 'react';

export default function EmptyPortfolioState({ onAddClick }) {
  return (
    <div className="empty-portfolio-wrap">
      <div className="glass-empty-card">
        <div className="empty-icon-wrap">Portfolio</div>
        <h3>No portfolio available</h3>
        <p>Showcase your work so clients can quickly understand your style and experience.</p>
        {onAddClick && (
          <button className="db-primary" onClick={onAddClick}>
            Add Your First Portfolio Item
          </button>
        )}
      </div>
    </div>
  );
}
