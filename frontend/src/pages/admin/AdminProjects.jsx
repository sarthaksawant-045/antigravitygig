import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import { Search, Filter, AlertCircle, Briefcase, User, Calendar, IndianRupee, ExternalLink } from 'lucide-react';
import { adminProjectsApi } from '../../services/adminApi';

export default function AdminProjects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const response = await adminProjectsApi.getProjects({
        status: statusFilter === 'all' ? '' : statusFilter,
        search: searchQuery
      });
      setProjects(response.data);
    } catch (err) {
      setError(err.message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (id, newStatus) => {
    if (!confirm(`Are you sure you want to change project status to ${newStatus}?`)) return;
    try {
      await adminProjectsApi.updateProjectStatus(id, newStatus);
      loadProjects();
    } catch (err) {
      alert(err.message || 'Update failed');
    }
  };

  return (
    <AdminLayout title="Project Management">
      <div className="mb-6 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search projects, clients, freelancers..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-10 pr-4 py-2 text-white focus:outline-none focus:border-sky-500 transition-colors"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadProjects()}
          />
        </div>
        
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-sky-500 transition-colors"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All States</option>
            <option value="ACCEPTED">Accepted</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="COMPLETED">Completed</option>
            <option value="VERIFIED">Verified</option>
          </select>
          <button 
            onClick={loadProjects}
            className="bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 mt-0.5" />
          <p className="text-red-400">{error}</p>
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-800 border-b border-zinc-700">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Project Details</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Participants</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Timeline</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Value</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Status</th>
                <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-400">Loading...</td>
                </tr>
              ) : projects.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-400">No projects found</td>
                </tr>
              ) : (
                projects.map((p) => (
                  <tr key={p.id} className="hover:bg-zinc-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="text-white font-medium">{p.title}</div>
                      <div className="text-xs text-gray-500">ID: {p.id} | Hire ID: {p.hire_id}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-sm text-gray-300">
                          <User className="w-3 h-3 text-sky-400" /> Client: {p.client_name}
                        </div>
                        <div className="flex items-center gap-1.5 text-sm text-gray-300">
                          <Briefcase className="w-3 h-3 text-purple-400" /> Artist: {p.freelancer_name}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-xs text-gray-400">
                          <Calendar className="w-3 h-3 text-green-500" /> Start: {p.start_date}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-gray-400">
                          <Calendar className="w-3 h-3 text-red-500" /> End: {p.end_date}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-white font-medium">
                      ₹{p.agreed_price?.toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-md text-xs font-medium ${
                        p.status === 'VERIFIED' ? 'bg-green-500/20 text-green-400' :
                        p.status === 'COMPLETED' ? 'bg-blue-500/20 text-blue-400' :
                        p.status === 'IN_PROGRESS' ? 'bg-sky-500/20 text-sky-400' :
                        'bg-zinc-500/20 text-zinc-400'
                      }`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <select 
                        className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white"
                        onChange={(e) => handleUpdateStatus(p.id, e.target.value)}
                        value={p.status}
                      >
                        <option value="ACCEPTED">Accepted</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="COMPLETED">Completed</option>
                        <option value="VERIFIED">Verified</option>
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
