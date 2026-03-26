import React from "react";

export default function PortfolioPreview({ portfolio }) {
  const items = Array.isArray(portfolio) ? portfolio : [];

  return (
    <div className="portfolio-preview">
      <h3 className="section-title">Portfolio Preview</h3>
      {items.length === 0 ? (
        <p className="portfolio-desc">No portfolio available</p>
      ) : (
        <div className="portfolio-grid">
          {items.map((item, index) => (
            <div key={item.id || item.portfolio_id || index} className="portfolio-card">
              <img
                src={item.image || item.image_url || item.media_url}
                alt={item.title}
                className="portfolio-img"
              />
              <div className="portfolio-info">
                <h4 className="portfolio-title">{item.title}</h4>
                <p className="portfolio-desc">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
