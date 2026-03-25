import React from "react";

export default function ProfileDetails({ profile, onToggleAvailability }) {
  const category = (profile.category || "").toLowerCase();
  
  let pricingLabel = "Price";
  let pricingValue = profile.hourlyRate || 0;

  if (category === "mehndi_artist" || category === "mehndi artist") {
    pricingLabel = "Per Person";
    pricingValue = profile.price_per_person;
  } else if (category === "dancer" || category === "dance") {
    pricingLabel = "Per Hour";
    pricingValue = profile.price_per_hour;
  } else if (category === "photographer" || category === "photography") {
    pricingLabel = "Per Event";
    pricingValue = profile.price_per_event;
  } else {
    // Default fallback
    pricingLabel = "Starting Price";
    pricingValue = profile.hourlyRate || profile.price_per_hour || 0;
  }

  // Debugging logs as requested
  console.log("Profile Data (Details):", profile);
  console.log("Category:", profile.category);
  console.log("Pricing:", pricingValue);
  console.log("Phone:", profile.phone);

  return (
    <div className="profile-details-grid">
      <div className="detail-col">
        <div className="detail-item">
          <span className="detail-label">Full Name</span>
          <span className="detail-value">{profile.name}</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Phone</span>
          <span className="detail-value">{profile.phone}</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">{pricingLabel}</span>
          <span className="detail-value">₹{pricingValue}{pricingLabel === "Per Hour" ? "/hour" : ""}</span>
        </div>
        <div className="detail-item full-width">
          <span className="detail-label">Bio</span>
          <span className="detail-value bio">{profile.bio}</span>
        </div>
      </div>
      
      <div className="detail-col">
        <div className="detail-item">
          <span className="detail-label">Email</span>
          <span className="detail-value">{profile.email}</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Location</span>
          <span className="detail-value">{profile.location}</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Availability</span>
          <div className="availability-toggle" onClick={() => onToggleAvailability(!profile.availability)}>
            <div className={`toggle-switch ${profile.availability ? 'on' : ''}`}>
              <div className="toggle-knob" />
            </div>
            <span className="availability-status">
              {profile.availability ? "Available for work" : "Not available"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
