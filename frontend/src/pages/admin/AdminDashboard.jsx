import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import { Users, Briefcase, MessageSquare, FileCheck, CheckCircle, Send } from 'lucide-react';
import { adminDashboardApi } from '../../services/adminApi';

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const response = await adminDashboardApi.getStats();
      setStats(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load statistics');
    } finally {
      setLoading(false);
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
      color: 'bg-red-500',
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
      )}
    </AdminLayout>
  );
}
