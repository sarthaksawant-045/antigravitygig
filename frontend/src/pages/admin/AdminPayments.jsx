import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import { IndianRupee, AlertCircle, Search, Filter, Calendar, User, Briefcase, CheckCircle, XCircle } from 'lucide-react';
import { adminPaymentsApi } from '../../services/adminApi';

export default function AdminPayments() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    loadPayments();
  }, [searchQuery, statusFilter]);

  const loadPayments = async () => {
    setLoading(true);
    try {
      const response = await adminPaymentsApi.getPayments({
        status: statusFilter === 'all' ? '' : statusFilter,
        search: searchQuery
      });
      setPayments(response.data);
    } catch (err) {
      setError(err.message || 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  };

  const handleOverride = async (id, newStatus) => {
    if (!confirm(`Manual Override: Mark transaction #${id} as ${newStatus}?`)) return;
    try {
      await adminPaymentsApi.overridePayment(id, newStatus);
      loadPayments();
    } catch (err) {
      alert(err.message || 'Override failed');
    }
  };

  const getStatusStyle = (status) => {
    const s = status?.toLowerCase();
    if (s === 'paid') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (s === 'pending') return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
    if (s === 'failed') return 'bg-red-500/10 text-red-400 border-red-500/20';
    return 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20';
  };

  return (
    <AdminLayout title="Payment Monitoring">
      <div className="mb-6 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search by name or project ID..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-10 pr-4 py-2 text-white focus:outline-none focus:border-sky-500 transition-colors"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-sky-500 transition-colors"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Payment Status</option>
            <option value="Paid">Paid</option>
            <option value="Pending">Pending</option>
            <option value="Failed">Failed</option>
          </select>
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
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Transaction ID</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Project</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Parties</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Amount</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Status</th>
                <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Override</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-400">Loading payments...</td>
                </tr>
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-400">No transactions found</td>
                </tr>
              ) : (
                payments.map((p) => (
                  <tr key={p.id} className="hover:bg-zinc-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="text-white font-medium font-mono text-sm">#{p.id}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">
                        {new Date(p.date).toLocaleString()}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-300">
                      {p.projectId ? `Project #${p.projectId}` : 'N/A'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1 text-xs text-gray-400">
                          <User className="w-3 h-3 text-sky-500" /> {p.clientName}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-400">
                          <Briefcase className="w-3 h-3 text-purple-500" /> {p.freelancerName}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-white font-bold">
                        <IndianRupee className="w-3 h-3 text-emerald-500" />
                        {p.amount?.toLocaleString()}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${getStatusStyle(p.status)}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {p.status !== 'Paid' && (
                          <button 
                            onClick={() => handleOverride(p.id, 'Paid')}
                            className="p-1.5 text-emerald-500 hover:bg-emerald-500/10 rounded transition-colors"
                            title="Mark as Paid"
                          >
                            <CheckCircle className="w-4 h-4" />
                          </button>
                        )}
                        {p.status !== 'Failed' && (
                          <button 
                            onClick={() => handleOverride(p.id, 'Failed')}
                            className="p-1.5 text-red-500 hover:bg-red-500/10 rounded transition-colors"
                            title="Mark as Failed"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
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
