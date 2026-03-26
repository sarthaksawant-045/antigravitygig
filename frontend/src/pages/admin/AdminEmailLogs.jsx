import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import { Mail, Search, Filter, AlertCircle, RefreshCcw, Send, CheckCircle, XCircle, Clock, Eye } from 'lucide-react';
import { adminEmailApi } from '../../services/adminApi';

export default function AdminEmailLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedEmail, setSelectedEmail] = useState(null);

  useEffect(() => {
    loadLogs();
  }, [searchQuery, statusFilter]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const response = await adminEmailApi.getEmailLogs({
        status: statusFilter === 'all' ? '' : statusFilter,
        search: searchQuery
      });
      setLogs(response.data);
    } catch (err) {
      setError(err.message || 'Failed to load email logs');
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async (id) => {
    try {
      await adminEmailApi.retryEmail(id);
      loadLogs();
      alert('Email retry initiated successfully');
    } catch (err) {
      alert(err.message || 'Retry failed');
    }
  };

  return (
    <AdminLayout title="Email Communication Logs">
      <div className="mb-6 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search by email address or subject..."
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
            <option value="all">All Delivery Status</option>
            <option value="Sent">Sent</option>
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
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Recipient & Subject</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Project ID</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Status</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Date & Time</th>
                <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-400">Loading logs...</td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-400">No email logs found</td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-zinc-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="text-white font-medium text-sm">{log.to_email}</div>
                      <div className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                        <Mail className="w-3 h-3" /> {log.subject}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-400">
                      {log.project_id ? `#${log.project_id}` : 'Platform'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                          log.status === 'Sent' ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'
                        }`}>
                          {log.status === 'Sent' ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                          {log.status}
                        </span>
                        {log.error_message && (
                          <div className="text-[10px] text-red-400 max-w-[200px] truncate" title={log.error_message}>
                            {log.error_message}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-xs text-gray-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {new Date(log.created_at * 1000).toLocaleString()}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => setSelectedEmail(log)}
                          className="p-2 text-gray-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
                          title="View Message Content"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {log.status === 'Failed' && (
                          <button 
                            onClick={() => handleRetry(log.id)}
                            className="p-2 text-sky-400 hover:bg-sky-500/10 rounded-lg transition-colors"
                            title="Retry Sending"
                          >
                            <RefreshCcw className="w-4 h-4" />
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

      {/* Message Content Modal */}
      {selectedEmail && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Email Content Preview</h3>
              <button 
                onClick={() => setSelectedEmail(null)}
                className="text-gray-400 hover:text-white p-1"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Subject</div>
                  <div className="text-white font-medium">{selectedEmail.subject}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Recipient</div>
                  <div className="text-white">{selectedEmail.to_email}</div>
                </div>
                <div className="pt-4 border-t border-zinc-800">
                  <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Body</div>
                  <div className="bg-zinc-950 p-4 rounded-lg text-gray-300 whitespace-pre-wrap font-mono text-sm border border-zinc-800">
                    {selectedEmail.body}
                  </div>
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-zinc-800 flex justify-end">
              <button 
                onClick={() => setSelectedEmail(null)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
