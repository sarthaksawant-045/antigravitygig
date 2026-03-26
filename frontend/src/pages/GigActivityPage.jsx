import React, { useState, useMemo, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import DashboardHeader from '../components/DashboardHeader';
import DashboardSidebar from '../components/DashboardSidebar';
import GigActivityCard from '../components/GigActivityCard';
import WeeklySummaryCard from '../components/WeeklySummaryCard';
import MonthlyStatsSection from '../components/MonthlyStatsSection';
import AddGigModal from '../components/AddGigModal';
import EmptyStateCard from '../components/EmptyStateCard';
import { useAuth } from '../context/AuthContext';
import { freelancerService, artistService } from '../services';
import './dashboard.css';
import './gigActivity.css';

export default function GigActivityPage() {
  const { user } = useAuth();
  const { id } = useParams();
  const [active, setActive] = useState("projects");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [gigs, setGigs] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch real project data from backend
  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    artistService.getContractProjects(user.id)
      .then(res => {
        const projects = res.projects || [];
        const mapped = projects.map(p => {
          return {
            id: p.id,
            freelancer_id: p.freelancer_id,
            title: p.title || `Project from ${p.client_name || "Client"}`,
            description: `Project for ${p.client_name}. Status: ${p.status}`,
            category: p.category || "General",
            date: p.start_date,
            hours: 0,
            status: p.status, // ACCEPTED, IN_PROGRESS, COMPLETED, VERIFIED
            payment_status: "Paid", 
            event_status: p.status.toLowerCase(),
            payout_status: "Pending",
          };
        }).sort((a, b) => {
          if (!id) return 0;
          if (String(a.id) === String(id)) return -1;
          if (String(b.id) === String(id)) return 1;
          return 0;
        });
        setGigs(mapped);
      })
      .catch(err => {
        console.error("Failed to load project activity:", err);
        setGigs([]);
      })
      .finally(() => setLoading(false));
  }, [user?.id, id]);

  const weeklySummary = useMemo(() => {
    const totalGigs = gigs.filter(g => g.status === 'Completed' || g.status === 'Ongoing').length;
    const totalHours = gigs.reduce((acc, curr) => acc + (curr.hours || 0), 0);
    const categoryBreakdown = gigs.reduce((acc, curr) => {
      acc[curr.category] = (acc[curr.category] || 0) + 1;
      return acc;
    }, {});
    return { totalGigs, totalHours, categoryBreakdown };
  }, [gigs]);

  const monthlyStats = useMemo(() => {
    const completed = gigs.filter(g => g.status === 'Completed');
    return {
      totalGigs: gigs.length,
      performanceHours: gigs.reduce((acc, g) => acc + (g.hours || 0), 0),
      eventsWorked: completed.length,
      estimatedEarnings: 0, // will be populated when payment tracking is added
    };
  }, [gigs]);

  const handleAddGig = (newGig) => {
    setGigs(prev => [{ ...newGig, id: Date.now() }, ...prev]);
    setIsModalOpen(false);
  };

  const handleCompleteGig = async (gigId, freelancerId) => {
    if (!window.confirm("Are you sure you want to mark this project as completed?")) return;
    try {
      setLoading(true);
      const res = await artistService.completeProject(freelancerId, gigId, "Completed from activity page", "");
      if (res.success) {
        alert("Project marked as completed!");
        // Refresh
        const projRes = await artistService.getContractProjects(user.id);
        const projects = projRes.projects || [];
        const mapped = projects.map(p => ({
          id: p.id,
          freelancer_id: p.freelancer_id,
          title: p.title || `Project from ${p.client_name || "Client"}`,
          description: `Project for ${p.client_name}. Status: ${p.status}`,
          category: p.category || "General",
          date: p.start_date,
          hours: 0,
          status: p.status,
          payment_status: "Paid",
          event_status: p.status.toLowerCase(),
          payout_status: "Pending",
        }));
        setGigs(mapped);
      } else {
        alert(res.msg || "Error completing project.");
      }
    } catch (err) {
      alert("Error completing gig. Try again later.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="db-layout">
      <DashboardHeader />
      <div className="db-shell">
        <DashboardSidebar active={active} onSelect={setActive} />
        <main className="db-main gig-activity-page">
          <div className="gig-activity-grid">
            {/* Left Section: Activity Logs */}
            <div className="gig-activity-logs">
              <div className="section-header">
                <h3>Recent Gig Activity</h3>
                <button className="add-entry-btn" onClick={() => setIsModalOpen(true)}>
                  <span className="plus-icon">+</span> Add Gig Activity
                </button>
              </div>

              <div className="gig-cards-container">
                {loading ? (
                  <p style={{ textAlign: "center", color: "#94a3b8", padding: "2rem" }}>Loading gig activity...</p>
                ) : gigs.length > 0 ? (
                  gigs.map(gig => (
                    <GigActivityCard key={gig.id} gig={gig} onComplete={handleCompleteGig} />
                  ))
                ) : (
                  <EmptyStateCard onAdd={() => setIsModalOpen(true)} />
                )}
              </div>
            </div>

            {/* Right Section: Weekly Summary */}
            <div className="gig-activity-summary">
              <WeeklySummaryCard summary={weeklySummary} />
            </div>
          </div>

          {/* Bottom Section: Monthly Stats */}
          <MonthlyStatsSection stats={monthlyStats} />
        </main>
      </div>

      {isModalOpen && (
        <AddGigModal 
          onClose={() => setIsModalOpen(false)}
          onSave={handleAddGig}
        />
      )}
    </div>
  );
}
