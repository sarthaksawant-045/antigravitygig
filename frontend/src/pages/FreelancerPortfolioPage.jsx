import React, { useEffect, useState } from 'react';
import DashboardHeader from '../components/DashboardHeader';
import DashboardSidebar from '../components/DashboardSidebar';
import PortfolioHeader from '../components/PortfolioHeader';
import PortfolioGrid from '../components/PortfolioGrid';
import EmptyPortfolioState from '../components/EmptyPortfolioState';
import AddProjectModal from '../components/AddProjectModal';
import { useAuth } from '../context/AuthContext.jsx';
import { freelancerService } from '../services/freelancerService';
import './dashboard.css';
import './portfolio.css';

function normalizePortfolioItems(items) {
  return (items || []).map((item) => ({
    id: item.id || item.portfolio_id,
    portfolio_id: item.portfolio_id || item.id,
    title: item.title || 'Untitled',
    description: item.description || '',
    image_url: item.image_url || item.media_url || item.image || item.image_path || 'https://via.placeholder.com/600x400?text=Portfolio',
  }));
}

export default function FreelancerPortfolioPage() {
  const [active, setActive] = useState("portfolio");
  const [projects, setProjects] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { user } = useAuth();

  useEffect(() => {
    const fetchPortfolio = async () => {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      try {
        const response = await freelancerService.getPortfolio(user.id);
        const items = Array.isArray(response) ? response : (response?.portfolio || response?.portfolio_items || []);
        setProjects(normalizePortfolioItems(items));
        setError('');
      } catch (err) {
        const status = err?.status;
        const msg = err?.message || '';

        const isNetworkError = status === 0 || msg.includes('Failed to fetch') || msg.includes('Unable to connect');
        const isServerError = status >= 500;
        const isBadRequest = status === 400; // Only capture true bad requests, not 404s

        if (isNetworkError || isServerError || isBadRequest) {
          setError(msg || 'Failed to load portfolio');
        } else {
          setProjects([]);
          setError('');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchPortfolio();
  }, [user?.id]);

  const handleAddProject = async (newProject) => {
    if (!user?.id) return;

    setSaving(true);
    setError('');
    try {
      await freelancerService.addPortfolioItem({
        freelancer_id: user.id,
        title: newProject.title,
        description: newProject.description,
        image_url: newProject.image_url,
        media_url: newProject.image_url,
        media_type: 'VIDEO',
      });

      const response = await freelancerService.getPortfolio(user.id);
      const items = response.portfolio || response.portfolio_items || [];
      setProjects(normalizePortfolioItems(items));
      setIsModalOpen(false);
    } catch (err) {
      setError(err.message || 'Failed to save portfolio item');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="db-layout">
      <DashboardHeader />
      <div className="db-shell">
        <DashboardSidebar active={active} onSelect={setActive} />
        <main className="db-main portfolio-page">
          <PortfolioHeader onAddClick={() => setIsModalOpen(true)} />

          {error && (
            <div style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', padding: '12px 16px', borderRadius: '12px', marginBottom: '20px' }}>
              {error}
            </div>
          )}

          {loading ? (
            <div style={{ color: '#64748b', padding: '20px 0' }}>Loading portfolio...</div>
          ) : projects?.length > 0 ? (
            <PortfolioGrid projects={projects} />
          ) : (
            !error && <EmptyPortfolioState onAddClick={() => setIsModalOpen(true)} />
          )}
        </main>
      </div>

      {isModalOpen && (
        <AddProjectModal
          onClose={() => setIsModalOpen(false)}
          onSave={handleAddProject}
          saving={saving}
        />
      )}
    </div>
  );
}
