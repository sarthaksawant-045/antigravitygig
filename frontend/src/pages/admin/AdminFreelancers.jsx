import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import { Check, X, AlertCircle, Shield, Star, Search, Trash2, Filter, Phone, Calendar, Briefcase, IndianRupee, ExternalLink } from 'lucide-react';
import { adminUsersApi } from '../../services/adminApi';

export default function AdminFreelancers() {
  const [freelancers, setFreelancers] = useState([]);
  const [filteredFreelancers, setFilteredFreelancers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(null);
  
  // Search and Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [kycFilter, setKycFilter] = useState('all');

  useEffect(() => {
    loadFreelancers();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [freelancers, searchQuery, statusFilter, kycFilter]);

  const loadFreelancers = async () => {
    try {
      const response = await adminUsersApi.getFreelancers();
      setFreelancers(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load freelancers');
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let result = [...freelancers];
    
    // Status Filter
    if (statusFilter !== 'all') {
      result = result.filter(f => f.status === statusFilter);
    }
    
    // KYC Filter
    if (kycFilter !== 'all') {
      result = result.filter(f => (f.kyc_status || 'Pending').toLowerCase() === kycFilter.toLowerCase());
    }
    
    // Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(f => 
        f.name?.toLowerCase().includes(q) || 
        f.email?.toLowerCase().includes(q) || 
        f.skills?.toLowerCase().includes(q) ||
        f.id.toString().includes(q)
      );
    }
    
    setFilteredFreelancers(result);
  };

  const handleToggleStatus = async (freelancerId, currentStatus) => {
    if (!confirm(`Are you sure you want to ${currentStatus === 'enabled' ? 'disable' : 'enable'} this user?`)) return;
    setActionLoading(freelancerId);
    try {
      if (currentStatus === 'enabled') {
        await adminUsersApi.disableUser(freelancerId);
      } else {
        await adminUsersApi.enableUser(freelancerId);
      }
      await loadFreelancers();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update freelancer status');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteUser = async (freelancerId) => {
    if (!confirm('Are you sure you want to delete this user? This will be a soft-delete.')) return;
    setActionLoading(freelancerId);
    try {
      await adminUsersApi.deleteUser(freelancerId);
      await loadFreelancers();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete user');
    } finally {
      setActionLoading(null);
    }
  };

  const getPricingDisplay = (f) => {
    if (f.pricing_type === 'hourly') return `₹${f.hourly_rate}/hr`;
    if (f.pricing_type === 'fixed') return `₹${f.fixed_price} (Fixed)`;
    if (f.starting_price) return `Starts at ₹${f.starting_price}`;
    return 'N/A';
  };

  return (
    <AdminLayout title="Freelancer Management">
      <div className="mb-6 space-y-4">
        {/* Search and Filters */}
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search by name, skills, email, or ID..."
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-10 pr-4 py-2 text-white focus:outline-none focus:border-sky-500 transition-colors"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          <div className="flex flex-wrap items-center gap-4 w-full md:w-auto">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <select
                className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-sky-500 transition-colors text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">Account Status</option>
                <option value="enabled">Active</option>
                <option value="disabled">Suspended</option>
              </select>
            </div>
            
            <select
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-sky-500 transition-colors text-sm"
              value={kycFilter}
              onChange={(e) => setKycFilter(e.target.value)}
            >
              <option value="all">KYC Status</option>
              <option value="verified">Verified</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-red-400">{error}</p>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-500"></div>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-zinc-800 border-b border-zinc-700">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Freelancer</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Expertise</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Contact</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Pricing</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">KYC</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Status</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {filteredFreelancers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                      No freelancers matching your search
                    </td>
                  </tr>
                ) : (
                  filteredFreelancers.map((f) => (
                    <tr key={f.id} className="hover:bg-zinc-800/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-medium">{f.name}</span>
                          {f.kyc_status === 'Verified' && (
                            <Shield className="w-3.5 h-3.5 text-sky-500" title="Verified" />
                          )}
                        </div>
                        <div className="text-xs text-gray-500 font-mono">ID: {f.id}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs text-sky-400 font-medium bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20 inline-block mb-1">
                          {f.category || 'Uncategorized'}
                        </div>
                        <div className="text-sm text-gray-400 line-clamp-1 max-w-[200px]" title={f.skills}>
                          {f.skills || 'No skills listed'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-300">{f.email}</div>
                        {f.phone && (
                          <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                            <Phone className="w-3 h-3" /> {f.phone}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-emerald-400 font-medium">
                          {getPricingDisplay(f)}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                          <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" /> {f.rating?.toFixed(1) || '0.0'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                            f.kyc_status === 'Verified'
                              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                              : f.kyc_status === 'Pending'
                              ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                              : 'bg-red-500/10 text-red-400 border border-red-500/20'
                          }`}
                        >
                          {f.kyc_status || 'Pending'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                            f.status === 'enabled'
                              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                              : 'bg-red-500/10 text-red-400 border border-red-500/20'
                          }`}
                        >
                          {f.status === 'enabled' ? 'Active' : 'Suspended'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleToggleStatus(f.id, f.status)}
                            disabled={actionLoading === f.id}
                            className={`p-2 rounded-lg transition-colors ${
                              f.status === 'enabled'
                                ? 'text-red-400 hover:bg-red-500/10'
                                : 'text-green-400 hover:bg-green-500/10'
                            }`}
                            title={f.status === 'enabled' ? 'Suspend Account' : 'Enable Account'}
                          >
                            {f.status === 'enabled' ? <X className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => handleDeleteUser(f.id)}
                            disabled={actionLoading === f.id}
                            className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                            title="Delete User"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
