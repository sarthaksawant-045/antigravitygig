import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import ProfileFormLayout from "../components/ProfileFormLayout.jsx";
import { freelancerService } from "../services/freelancerService.js";
import { useAuth } from "../context/AuthContext.jsx";

const DRAFT_KEY = "fp_draft";
const PIN_ERR_KEY = "fp_error_pin";

function getPricingType(category) {
  const hourly = ["DJ", "Singer", "Anchor", "Band / Live Music", "Dancer", "Magician / Entertainer"];
  const perPerson = ["Makeup Artist", "Mehendi Artist"];
  const packageType = ["Photographer", "Videographer", "Choreographer", "Artist"];
  const project = ["Decorator", "Wedding Planner", "Event Organizer"];

  if (hourly.includes(category)) return "HOURLY";
  if (perPerson.includes(category)) return "PER_PERSON";
  if (packageType.includes(category)) return "PACKAGE";
  if (project.includes(category)) return "PROJECT";
  return "HOURLY"; // Default
}

export default function FreelancerProfileStep2() {
  const navigate = useNavigate();
  const { user, markProfileCompleted } = useAuth();
  const [basic, setBasic] = useState(null);
  
  const [form, setForm] = useState({
    title: "",
    skills: "",
    bio: "",
    dob: "",
    phone: "",
  });
  const [profileImage, setProfileImage] = useState(null);
  const [profileImagePreview, setProfileImagePreview] = useState("");

  const [pricing, setPricing] = useState({
    type: "HOURLY",
    hourlyRate: "",
    hasOvertime: false,
    overtimeRate: "",
    perPersonRate: "",
    projectPrice: 25000,
    description: "",
    services: "",
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setBasic(parsed);
        if (parsed.category) {
          setPricing((prev) => ({
            ...prev,
            type: getPricingType(parsed.category)
          }));
        }
      }
    } catch {}
  }, []);

  const onField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const handleImageUpload = (e) => {
    const file = e.target.files?.[0] || null;
    setProfileImage(file);
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setProfileImagePreview(String(reader.result || ""));
    reader.readAsDataURL(file);
  };
  
  const onPricingField = (k) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setPricing((p) => ({ ...p, [k]: val }));
  };

  const goBack = () => navigate("/freelancer/create-profile/step-1");

  const submitProfile = async (e) => {
    e.preventDefault();
    if (!basic) {
      setError("Please complete Step 1 first.");
      return;
    }

    // Validate required pricing fields based on type
    if (pricing.type === "HOURLY" && (!pricing.hourlyRate || parseFloat(pricing.hourlyRate) <= 0)) {
      setError("Hourly rate is required and must be greater than 0");
      return;
    }
    if (pricing.type === "PER_PERSON" && (!pricing.perPersonRate || parseFloat(pricing.perPersonRate) <= 0)) {
      setError("Per person rate is required and must be greater than 0");
      return;
    }
    if (pricing.type === "PROJECT" && (!pricing.projectPrice || parseFloat(pricing.projectPrice) <= 0)) {
      setError("Starting price is required and must be greater than 0");
      return;
    }
    if (pricing.type === "PROJECT" && !pricing.description) {
      setError("Work description is required for project categories");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const payload = new FormData();
      payload.append("freelancer_id", user?.id);
      payload.append("title", form.title || `${basic.category || "Artist"} Performer`);
      payload.append("skills", form.skills || basic.category || "Artist");
      payload.append("experience_years", parseInt(basic.experience_years || "0", 10));
      payload.append("bio", form.bio || "");
      payload.append("category", basic.category || "");
      payload.append("location", basic.location || "");
      payload.append("dob", form.dob || "");
      payload.append("pincode", basic.pincode || "");
      payload.append("phone", form.phone || "");
      payload.append("pricing_type", pricing.type);

      if (profileImage) {
        payload.append("profile_image", profileImage);
      }

      if (pricing.type === "HOURLY") {
        payload.append("hourly_rate", parseFloat(pricing.hourlyRate));
        if (pricing.hasOvertime && pricing.overtimeRate) {
          payload.append("overtime_rate_per_hour", parseFloat(pricing.overtimeRate));
        }
      } else if (pricing.type === "PER_PERSON") {
        payload.append("per_person_rate", parseFloat(pricing.perPersonRate));
      } else if (pricing.type === "PROJECT") {
        payload.append("starting_price", parseFloat(pricing.projectPrice));
        payload.append("work_description", pricing.description || "Project work");
        payload.append("services_included", pricing.services || "");
      }

      const res = await freelancerService.createProfile(payload);
      console.log("Profile response:", res);
      if (res && res.success) {
        localStorage.removeItem(DRAFT_KEY);
        localStorage.removeItem(PIN_ERR_KEY);
        markProfileCompleted();
        navigate("/artist/dashboard", { replace: true });
      } else {
        console.log("Profile error:", res);
        const msg = res?.msg || "Failed to create profile";
        if (msg.includes("pincode")) {
          localStorage.setItem(PIN_ERR_KEY, msg);
          navigate("/freelancer/create-profile/step-1");
        } else {
          setError(msg);
        }
      }
    } catch (err) {
      const msg = err?.message || "Network error";
      if (msg.includes("pincode")) {
        localStorage.setItem(PIN_ERR_KEY, msg);
        navigate("/freelancer/create-profile/step-1");
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const renderPricingUI = () => {
    switch (pricing.type) {
      case "HOURLY":
        return (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
            <label>
              <span style={{ fontWeight: 600, color: '#1e293b' }}>Hourly Rate (₹/hour) *</span>
              <input 
                type="number" 
                min="0" 
                value={pricing.hourlyRate} 
                onChange={onPricingField("hourlyRate")}
                placeholder="e.g., 200"
                required
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '6px' }}>
              <input type="checkbox" checked={pricing.hasOvertime} onChange={onPricingField("hasOvertime")} style={{ width: 'auto', height: 'auto', margin: 0 }} />
              <span style={{ margin: 0, fontSize: '14px', color: '#475569' }}>Set overtime rate?</span>
            </label>
            {pricing.hasOvertime && (
              <label className="fade-in" style={{ marginTop: '8px' }}>
                <span style={{ fontWeight: 600, color: '#1e293b' }}>Overtime Rate (₹/hour)</span>
                <input type="number" min="0" value={pricing.overtimeRate} onChange={onPricingField("overtimeRate")} placeholder="e.g., 300" />
              </label>
            )}
          </div>
        );
      case "PER_PERSON":
        return (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
            <label>
              <span style={{ fontWeight: 600, color: '#1e293b' }}>Per Person Rate (₹/person) *</span>
              <input 
                type="number" 
                min="0" 
                value={pricing.perPersonRate} 
                onChange={onPricingField("perPersonRate")}
                placeholder="e.g., 500"
                required
              />
            </label>
          </div>
        );
      case "PACKAGE":
        return (
          <div className="fade-in" style={{ padding: '16px', background: '#eef6ff', borderRadius: '12px', color: '#2563eb', fontWeight: '500', textAlign: 'center', marginBottom: '16px', border: '1px solid #bfdbfe' }}>
            Packages will be managed separately
          </div>
        );
      case "PROJECT":
        return (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
            <label>
              <span style={{ fontWeight: 600, color: '#1e293b' }}>Starting Project Price (₹) *</span>
              <input 
                type="number" 
                min="0" 
                value={pricing.projectPrice} 
                onChange={onPricingField("projectPrice")}
                placeholder="e.g., 25000"
                required
              />
            </label>
            <label>
              <span style={{ fontWeight: 600, color: '#1e293b' }}>Work Description *</span>
              <textarea 
                rows="3" 
                value={pricing.description} 
                onChange={onPricingField("description")}
                placeholder="Describe your project services..."
                required
              />
            </label>
            <label>
              <span style={{ fontWeight: 600, color: '#1e293b' }}>Services Included</span>
              <input type="text" placeholder="Comma-separated (optional)" value={pricing.services} onChange={onPricingField("services")} />
            </label>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <ProfileFormLayout step={2}>
      <form className="cp-form cp-slide-in" onSubmit={submitProfile}>
        <label>
          <span>Title *</span>
          <input
            type="text"
            placeholder="e.g. Professional Wedding Photographer / DJ for Events"
            value={form.title}
            onChange={onField("title")}
            required
          />
        </label>
        
        <label>
          <span>Skills *</span>
          <input
            type="text"
            placeholder="e.g. Video Editing, Lighting, Drone (comma separated)"
            value={form.skills}
            onChange={onField("skills")}
            required
          />
        </label>

        <label>
          <span>Bio *</span>
          <textarea
            rows="4"
            placeholder="Write a short bio..."
            value={form.bio}
            onChange={onField("bio")}
            required
          />
        </label>

        <div style={{ marginTop: '24px', marginBottom: '8px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', marginBottom: '12px' }}>Pricing Information</h3>
          {renderPricingUI()}
        </div>

        <label>
          <span>Date of Birth</span>
          <input
            type="date"
            value={form.dob}
            onChange={onField("dob")}
          />
        </label>

        <label>
          <span>Phone</span>
          <input
            type="text"
            placeholder="Enter phone number"
            value={form.phone}
            onChange={onField("phone")}
          />
        </label>

        <label>
          <span>Profile Image</span>
          <div className="cp-upload-field">
            <label className="cp-upload-box">
              <input type="file" accept="image/*" onChange={handleImageUpload} />
              <span className="cp-upload-button">Choose Image</span>
              <span className="cp-upload-text">
                {profileImage?.name || "Upload a profile photo"}
              </span>
            </label>
            <div className="cp-upload-preview">
              {profileImagePreview ? (
                <img
                  src={profileImagePreview}
                  alt="Profile preview"
                  className="cp-upload-avatar"
                />
              ) : (
                <div className="cp-upload-avatar cp-upload-avatar-fallback" aria-hidden="true">
                  {form.title?.trim()?.charAt(0)?.toUpperCase() || basic?.category?.trim()?.charAt(0)?.toUpperCase() || "A"}
                </div>
              )}
              <div className="cp-upload-meta">
                <span className="cp-upload-title">Optional profile image</span>
                <span className="cp-upload-subtitle">PNG, JPG, WEBP or GIF</span>
              </div>
            </div>
          </div>
        </label>
        
        {error && (
          <div style={{ color: "#dc2626", fontSize: 12 }}>
            {error}
          </div>
        )}
        
        <div className="cp-actions" style={{ marginTop: '24px' }}>
          <button type="button" className="cp-ghost" onClick={goBack}>← Back</button>
          <button className="cp-primary" disabled={submitting}>
            Submit Profile
          </button>
        </div>
      </form>
    </ProfileFormLayout>
  );
}
