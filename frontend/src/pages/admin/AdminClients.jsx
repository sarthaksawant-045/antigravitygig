import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import { Check, X, AlertCircle, Search, Trash2, Filter, Phone, Calendar, Briefcase, IndianRupee } from 'lucide-react';
import { adminUsersApi } from '../../services/adminApi';

export default function AdminClients() {
  const [clients, setClients] = useState([]);
  const [filteredClients, setFilteredClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(null);
  
  // Search and Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    loadClients();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [clients, searchQuery, statusFilter]);

  const loadClients = async () => {
    try {
      const response = await adminUsersApi.getClients();
      setClients(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load clients');
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let result = [...clients];
    
    // Status Filter
    if (statusFilter !== 'all') {
      result = result.filter(c => c.status === statusFilter);
    }
    
    // Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c => 
        c.name?.toLowerCase().includes(q) || 
        c.email?.toLowerCase().includes(q) || 
        c.id.toString().includes(q)
      );
    }
    
    setFilteredClients(result);
  };

  const handleToggleStatus = async (clientId, currentStatus) => {
    if (!confirm(`Are you sure you want to ${currentStatus === 'enabled' ? 'disable' : 'enable'} this user?`)) return;
    setActionLoading(clientId);
    try {
      if (currentStatus === 'enabled') {
        await adminUsersApi.disableUser('client', clientId);
      } else {
        await adminUsersApi.enableUser('client', clientId);
      }
      await loadClients();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update client status');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteUser = async (clientId) => {
    if (!confirm('Are you sure you want to permanently soft-delete this client? This action cannot be easily undone.')) return;
    setActionLoading(clientId);
    try {
      await adminUsersApi.deleteUser('client', clientId);
      await loadClients();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete client');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <AdminLayout title="Client Management">
      <div className="mb-6 space-y-4">
        {/* Search and Filters */}
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search by name, email, or ID..."
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-10 pr-4 py-2 text-white focus:outline-none focus:border-sky-500 transition-colors"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          <div className="flex items-center gap-2 w-full md:w-auto">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-sky-500 transition-colors"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Status</option>
              <option value="enabled">Active</option>
              <option value="disabled">Suspended</option>
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
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Client</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Contact</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Activity</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Signed Up</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Status</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {filteredClients.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                      No clients matching your search
                    </td>
                  </tr>
                ) : (
                  filteredClients.map((client) => (
                    <tr key={client.id} className="hover:bg-zinc-800/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="text-white font-medium">{client.name}</div>
                        <div className="text-xs text-gray-500 font-mono">ID: {client.id}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-300">{client.email}</div>
                        {client.phone && (
                          <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                            <Phone className="w-3 h-3" /> {client.phone}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1 text-sm text-gray-300">
                          <Briefcase className="w-3 h-3 text-sky-500" /> {client.total_projects} Projects
                        </div>
                        <div className="flex items-center gap-1 text-sm text-gray-300 mt-1">
                          <IndianRupee className="w-3 h-3 text-emerald-500" /> ₹{client.total_spent?.toLocaleString()} Spent
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1 text-sm text-gray-400">
                          <Calendar className="w-3 h-3" /> {client.created_at || 'N/A'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                            client.status === 'enabled'
                              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                              : 'bg-red-500/10 text-red-400 border border-red-500/20'
                          }`}
                        >
                          {client.status === 'enabled' ? 'Active' : 'Suspended'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleToggleStatus(client.id, client.status)}
                            disabled={actionLoading === client.id}
                            className={`p-2 rounded-lg transition-colors ${
                              client.status === 'enabled'
                                ? 'text-red-400 hover:bg-red-500/10'
                                : 'text-green-400 hover:bg-green-500/10'
                            }`}
                            title={client.status === 'enabled' ? 'Suspend Account' : 'Enable Account'}
                          >
                            {client.status === 'enabled' ? <X className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => handleDeleteUser(client.id)}
                            disabled={actionLoading === client.id}
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
