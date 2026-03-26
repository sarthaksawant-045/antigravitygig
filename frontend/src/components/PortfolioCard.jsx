import React from 'react';

export default function PortfolioCard({ project, onDelete }) {
  const imageSrc = project.image || project.image_url || 'https://via.placeholder.com/600x400?text=Portfolio';

  return (
    <div className="portfolio-card-item">
      <div className="portfolio-card-img-wrap">
        <img src={imageSrc} alt={project.title} />
      </div>
      <div className="portfolio-card-content">
        <h4 className="portfolio-card-title">{project.title}</h4>
        <p className="portfolio-card-desc">{project.description}</p>
        {!!project.tags?.length && (
          <div className="portfolio-card-tags">
            {project.tags.map((tag, idx) => (
              <span key={idx} className="portfolio-tag">{tag}</span>
            ))}
          </div>
        )}
      </div>
      {onDelete && (
        <div className="portfolio-card-actions">
          <button className="action-btn delete" onClick={onDelete} title="Delete Project">
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
