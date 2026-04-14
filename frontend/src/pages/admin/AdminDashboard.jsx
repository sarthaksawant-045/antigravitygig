import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import { Users, Briefcase, MessageSquare, FileCheck, CheckCircle, Send, Trash2, RefreshCcw, AlertTriangle } from 'lucide-react';
import { adminDashboardApi, adminUsersApi } from '../../services/adminApi';

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupResult, setCleanupResult] = useState(null);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setLoading(true);
    try {
      const response = await adminDashboardApi.getStats();
      setStats(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load statistics');
    } finally {
      setLoading(false);
    }
  };

  const handleCleanupTestData = async () => {
    const confirmed = window.confirm(
      '⚠️ This will soft-delete ALL users with placeholder email domains like @example.com, @test.com, @mailinator.com etc.\n\n' +
      'Real users will NOT be affected.\n\n' +
      'Are you sure you want to proceed?'
    );
    if (!confirmed) return;

    setCleanupLoading(true);
    setCleanupResult(null);
    try {
      const response = await adminUsersApi.cleanupTestData();
      setCleanupResult({ success: true, msg: response.data.msg });
    } catch (err) {
      setCleanupResult({ success: false, msg: err.message || 'Cleanup failed' });
    } finally {
      setCleanupLoading(false);
      loadStats(); // Refresh stats after cleanup
    }
  };

  const statCards = [
    {
      title: 'Total Clients',
      value: stats?.totalClients || 0,
      icon: Users,
      color: 'bg-blue-500',
    },
    {
      title: 'Total Freelancers',
      value: stats?.totalFreelancers || 0,
      icon: Briefcase,
      color: 'bg-purple-500',
    },
    {
      title: 'Total Revenue',
      value: `₹${(stats?.totalRevenue || 0).toLocaleString()}`,
      icon: CheckCircle,
      color: 'bg-emerald-500',
    },
    {
      title: 'Total Projects',
      value: stats?.totalProjects || 0,
      icon: Briefcase,
      color: 'bg-indigo-500',
    },
    {
      title: 'Active Projects',
      value: stats?.activeProjects || 0,
      icon: Briefcase,
      color: 'bg-sky-500',
    },
    {
      title: 'Completed Projects',
      value: stats?.completedProjects || 0,
      icon: CheckCircle,
      color: 'bg-green-500',
    },
    {
      title: 'Failed Emails',
      value: stats?.failedEmails || 0,
      icon: Send,
      color: stats?.failedEmails > 0 ? 'bg-red-500' : 'bg-zinc-600',
    },
    {
      title: 'Total Hire Requests',
      value: stats?.totalHireRequests || 0,
      icon: Send,
      color: 'bg-orange-500',
    },
    {
      title: 'Pending KYC',
      value: stats?.pendingKycDocuments || 0,
      icon: FileCheck,
      color: 'bg-yellow-500',
    },
    {
      title: 'Verified Freelancers',
      value: stats?.verifiedFreelancers || 0,
      icon: CheckCircle,
      color: 'bg-sky-500',
    },
  ];

  return (
    <AdminLayout title="Dashboard">
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-400">Loading statistics...</div>
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 text-red-400">
          {error}
        </div>
      ) : (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            {statCards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.title}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 hover:border-sky-500/50 transition-colors"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className={`${card.color} w-12 h-12 rounded-lg flex items-center justify-center`}>
                      <Icon className="w-6 h-6 text-white" />
                    </div>
                  </div>
                  <div className="text-3xl font-bold text-white mb-2">{card.value}</div>
                  <div className="text-gray-400 text-sm">{card.title}</div>
                </div>
              );
            })}
          </div>

          {/* Maintenance Tools */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              Maintenance &amp; Data Tools
            </h2>
            <p className="text-sm text-gray-400 mb-5">
              Use these tools carefully. Actions here affect live production data.
            </p>

            <div className="flex flex-wrap gap-4">
              {/* Cleanup Test Data Button */}
              <button
                id="btn-cleanup-test-data"
                onClick={handleCleanupTestData}
                disabled={cleanupLoading}
                className="flex items-center gap-2 px-5 py-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
                {cleanupLoading ? 'Cleaning up…' : 'Cleanup Test / Dummy Users'}
              </button>

              {/* Refresh Stats */}
              <button
                id="btn-refresh-stats"
                onClick={loadStats}
                disabled={loading}
                className="flex items-center gap-2 px-5 py-2.5 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-400 rounded-lg transition-colors text-sm font-medium"
              >
                <RefreshCcw className="w-4 h-4" />
                Refresh Stats
              </button>
            </div>

            {/* Cleanup Result */}
            {cleanupResult && (
              <div className={`mt-4 p-3 rounded-lg text-sm border ${
                cleanupResult.success
                  ? 'bg-green-500/10 border-green-500/20 text-green-400'
                  : 'bg-red-500/10 border-red-500/20 text-red-400'
              }`}>
                {cleanupResult.success ? '✅ ' : '❌ '}{cleanupResult.msg}
              </div>
            )}
          </div>
        </>
      )}
    </AdminLayout>
  );
}
