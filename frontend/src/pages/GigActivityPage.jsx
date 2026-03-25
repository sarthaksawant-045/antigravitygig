import React, { useState, useMemo, useEffect } from 'react';
import DashboardHeader from '../components/DashboardHeader';
import DashboardSidebar from '../components/DashboardSidebar';
import GigActivityCard from '../components/GigActivityCard';
import WeeklySummaryCard from '../components/WeeklySummaryCard';
import MonthlyStatsSection from '../components/MonthlyStatsSection';
import AddGigModal from '../components/AddGigModal';
import EmptyStateCard from '../components/EmptyStateCard';
import { useAuth } from '../context/AuthContext';
import { freelancerService } from '../services';
import './dashboard.css';
import './gigActivity.css';

export default function GigActivityPage() {
  const { user } = useAuth();
  const [active, setActive] = useState("projects");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [gigs, setGigs] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch real hire data from backend
  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    freelancerService.getHireInbox(user.id)
      .then(res => {
        const requests = res.requests || [];
        // Map hire requests to gig activity format
        const mapped = requests.map(r => {
          let status = "Upcoming";
          if (r.status === "ACCEPTED") status = "Ongoing";
          else if (r.status === "REJECTED") status = "Cancelled";
          else if (r.status === "COMPLETED") status = "Completed";
          else if (r.status === "PENDING") status = "Upcoming";

          return {
            id: r.request_id,
            freelancer_id: r.freelancer_id,
            title: r.job_title || `Gig from ${r.client_name || "Client"}`,
            description: r.note || "No description provided.",
            category: r.contract_type || "General",
            date: r.created_at ? new Date(r.created_at * 1000).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "",
            hours: r.max_daily_hours || r.event_included_hours || 0,
            status,
            payment_status: r.payment_status,
            event_status: r.event_status,
            payout_status: r.payout_status,
          };
        });
        setGigs(mapped);
      })
      .catch(err => {
        console.error("Failed to load gig activity:", err);
        setGigs([]);
      })
      .finally(() => setLoading(false));
  }, [user?.id]);

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
      await freelancerService.completeWork(freelancerId, gigId, "Work finished");
      // Refresh the inbox locally to update status
      const res = await freelancerService.getHireInbox(user.id);
      const requests = res.requests || [];
      const mapped = requests.map(r => {
        let status = "Upcoming";
        if (r.status === "ACCEPTED") status = "Ongoing";
        else if (r.status === "REJECTED") status = "Cancelled";
        else if (r.status === "COMPLETED") status = "Completed";
        else if (r.status === "PENDING") status = "Upcoming";

        return {
          id: r.request_id,
          freelancer_id: r.freelancer_id,
          title: r.job_title || `Gig from ${r.client_name || "Client"}`,
          description: r.note || "No description provided.",
          category: r.contract_type || "General",
          date: r.created_at ? new Date(r.created_at * 1000).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "",
          hours: r.max_daily_hours || r.event_included_hours || 0,
          status,
          payment_status: r.payment_status,
          event_status: r.event_status,
          payout_status: r.payout_status,
        };
      });
      setGigs(mapped);
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
