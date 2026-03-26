import React, { useState, useEffect } from "react";
import DashboardHeader from "../components/DashboardHeader";
import DashboardSidebar from "../components/DashboardSidebar";
import ProfileCompletionCard from "../components/ProfileCompletionCard";
import ProfileHeader from "../components/ProfileHeader";
import ProfileDetails from "../components/ProfileDetails";
import CategoryDynamicSection from "../components/CategoryDynamicSection";
import PortfolioPreview from "../components/PortfolioPreview";
import EditProfileModal from "../components/EditProfileModal";
import { freelancerService } from "../services/freelancerService";
import { useAuth } from "../context/AuthContext.jsx";
import "./dashboard.css";
import "./freelancerProfile.css";

export default function FreelancerProfilePage() {
  const [active, setActive] = useState("profile");
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const { user } = useAuth();

  const normalizePortfolio = (items) => (
    (items || []).map((item) => ({
      id: item.id || item.portfolio_id,
      title: item.title || "Untitled",
      description: item.description || "",
      image: item.image_url || item.media_url || item.image || item.image_path || "https://via.placeholder.com/600x400?text=Portfolio",
    }))
  );

  // Fetch freelancer profile data
  useEffect(() => {
    const fetchProfile = async () => {
      if (!user.isAuthenticated || !user.id) {
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(`http://localhost:5000/freelancer/profile/${user.id}`);
        const data = await response.json();
        
        if (data.success) {
          let portfolioItems = [];
          try {
            const portfolioRes = await freelancerService.getPortfolio(user.id);
            portfolioItems = normalizePortfolio(portfolioRes.portfolio || portfolioRes.portfolio_items || []);
          } catch {
            portfolioItems = [];
          }

          // Transform backend data to match frontend structure
          const transformedProfile = {
            id: data.id,
            name: data.name || user.name,
            email: data.email || user.email,
            phone: data.phone || "Not Available",
            location: data.location || "",
            hourlyRate: data.hourly_rate || data.min_budget || 0,
            price_display: data.price_display || "Not specified",
            price_per_hour: data.hourly_rate || 0,
            price_per_person: data.per_person_rate || 0,
            price_per_event: data.fixed_price || data.starting_price || data.min_budget || 0,
            bio: data.bio || "",
            category: data.category || "",
            skills: data.skills ? (typeof data.skills === 'string' ? data.skills.split(',').map(s => s.trim()) : data.skills) : [],
            availability: data.availability_status === 'AVAILABLE',
            profileImage: data.profile_image || null,
            portfolio: portfolioItems,
            experience: data.experience || 0,
            completion: {
              basicInfo: !!(data.name && data.email && (data.phone || data.phone_number)),
              skills: !!(data.skills && data.skills.length > 0),
              verification: false,
              portfolio: portfolioItems.length > 0
            }
          };

          // Debugging logs as requested
          console.log("Profile Data:", data);
          console.log("Transformed Profile:", transformedProfile);
          console.log("Category:", transformedProfile.category);
          console.log("Phone:", transformedProfile.phone);

          setProfile(transformedProfile);
        } else {
          setError(data.msg || "Failed to load profile");
        }
      } catch (err) {
        console.error("Error fetching profile:", err);
        setError("Failed to load profile");
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [user]);

  const handleUpdateProfile = async (updatedData) => {
    try {
      const payload = {
        freelancer_id: user.id,
        ...updatedData,
        // Ensure availability status is correctly mapped if needed
        availability_status: updatedData.availability ? "AVAILABLE" : "UNAVAILABLE"
      };
      
      const res = await freelancerService.createProfile(payload);
      if (res.success) {
        setProfile(prev => ({ ...prev, ...updatedData }));
        setIsEditModalOpen(false);
      } else {
        alert(res.msg || "Failed to update profile");
      }
    } catch (err) {
      console.error("Error updating profile:", err);
      alert("Failed to update profile");
    }
  };

  const handleToggleAvailability = async (val) => {
    try {
      const res = await freelancerService.updateAvailability(user.id, val ? "AVAILABLE" : "UNAVAILABLE");
      if (res.success) {
        setProfile(prev => ({ ...prev, availability: val }));
      } else {
        alert(res.msg || "Failed to update availability");
      }
    } catch (err) {
      console.error("Error updating availability:", err);
      alert("Failed to update availability");
    }
  };

  if (loading) {
    return (
      <div className="db-layout">
        <DashboardHeader />
        <div className="db-shell">
          <DashboardSidebar active={active} onSelect={setActive} />
          <main className="db-main profile-page">
            <div className="profile-top-bar">
               <div className="skeleton skeleton-title"></div>
            </div>
            <div className="skeleton" style={{ height: '100px', borderRadius: '12px', margin: '20px 0' }}></div>
            <div className="profile-content-card" style={{ padding: '24px' }}>
               <div style={{ display: 'flex', gap: '20px', marginBottom: '30px' }}>
                  <div className="skeleton skeleton-avatar" style={{ width: '100px', height: '100px' }}></div>
                  <div style={{ flex: 1 }}>
                     <div className="skeleton skeleton-title"></div>
                     <div className="skeleton skeleton-subtitle"></div>
                  </div>
               </div>
               <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px' }}>
                  <div className="skeleton skeleton-text" style={{ height: '100px' }}></div>
                  <div className="skeleton skeleton-text" style={{ height: '100px' }}></div>
               </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="db-layout">
        <DashboardHeader />
        <div className="db-shell">
          <DashboardSidebar active={active} onSelect={setActive} />
          <main className="db-main profile-page">
            <div className="error-message">{error}</div>
          </main>
        </div>
      </div>
    );
  }

  // Fallback profile if API fails
  const fallbackProfile = {
    name: user.name || "User",
    email: user.email || "",
    phone: "",
    location: "",
    hourlyRate: 0,
    bio: "",
    category: "",
    skills: [],
    availability: false,
    profileImage: null,
    portfolio: [],
    experience: 0,
    completion: {
      basicInfo: !!(user.name && user.email),
      skills: false,
      verification: false,
      portfolio: false
    }
  };

  const displayProfile = profile || fallbackProfile;

  return (
    <div className="db-layout">
      <DashboardHeader />
      <div className="db-shell">
        <DashboardSidebar active={active} onSelect={setActive} />
        <main className="db-main profile-page">
          <div className="profile-top-bar">
            <div className="db-welcome">
              <h2>Profile</h2>
              <p>Manage your freelancer profile and preferences</p>
            </div>
            <button className="db-primary edit-btn" onClick={() => setIsEditModalOpen(true)}>
              <span className="btn-icon">✎</span> Edit Profile
            </button>
          </div>

          <ProfileCompletionCard completion={displayProfile.completion} />

          <div className="profile-content-card">
            <ProfileHeader profile={displayProfile} />
            <ProfileDetails profile={displayProfile} onToggleAvailability={handleToggleAvailability} />
            
            <div className="profile-section-divider" />
            
            <CategoryDynamicSection profile={displayProfile} />
            
            <div className="profile-section-divider" />
            
            <PortfolioPreview portfolio={displayProfile.portfolio} />
          </div>
        </main>
      </div>

      {isEditModalOpen && (
        <EditProfileModal 
          profile={displayProfile} 
          onClose={() => setIsEditModalOpen(false)} 
          onSave={handleUpdateProfile} 
        />
      )}
    </div>
  );
}
