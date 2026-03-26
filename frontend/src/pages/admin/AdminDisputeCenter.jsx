import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, RotateCcw, Search } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout';
import { adminTicketsApi } from '../../services/adminApi';

export default function AdminDisputeCenter() {
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState('');

  const loadTickets = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminTicketsApi.getTickets();
      setTickets(response.data || []);
    } catch (err) {
      setError(err.message || 'Failed to load dispute tickets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTickets();
  }, []);

  const handleResolve = async (verdict) => {
    if (!selectedTicket || resolving) return;
    const verdictLabel = verdict === 'PAY_ARTIST' ? 'release payment to the artist' : 'refund the client';
    if (!window.confirm(`Resolve ticket #${selectedTicket.ticketId} and ${verdictLabel}?`)) return;

    setResolving(true);
    try {
      await adminTicketsApi.resolveTicket(selectedTicket.ticketId, verdict);
      setSelectedTicket(null);
      await loadTickets();
    } catch (err) {
      alert(err.message || 'Failed to resolve ticket');
    } finally {
      setResolving(false);
    }
  };

  return (
    <AdminLayout title="Dispute Center">
      <div className="space-y-6">
        <div className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <div>
            <h2 className="text-2xl font-semibold text-white">Active Disputes</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Review project complaints and decide whether to release payment or refund the client.
            </p>
          </div>
          <button
            onClick={loadTickets}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-sky-500 hover:text-white"
          >
            <RotateCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-400">
            <AlertCircle className="mt-0.5 h-5 w-5" />
            <p>{error}</p>
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
          <div className="border-b border-zinc-800 px-6 py-4">
            <div className="flex items-center gap-3 text-zinc-300">
              <Search className="h-4 w-4" />
              <span className="text-sm font-medium">Open tickets requiring review</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-800">
              <thead className="bg-zinc-950/60">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-zinc-300">Project Name</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-zinc-300">Complainer</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-zinc-300">Reason</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-zinc-300">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-zinc-400">Loading disputes...</td>
                  </tr>
                ) : tickets.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-zinc-400">No open tickets right now.</td>
                  </tr>
                ) : (
                  tickets.map((ticket) => (
                    <tr key={ticket.ticketId} className="hover:bg-zinc-800/40">
                      <td className="px-6 py-4">
                        <div className="font-medium text-white">{ticket.projectTitle}</div>
                        <div className="mt-1 text-xs text-zinc-500">Project #{ticket.projectId}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-zinc-200">{ticket.complainerName}</div>
                        <div className="mt-1 text-xs uppercase tracking-wide text-zinc-500">{ticket.complainerRole}</div>
                      </td>
                      <td className="max-w-md px-6 py-4 text-sm text-zinc-400">
                        {ticket.reason}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => setSelectedTicket(ticket)}
                          className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-400"
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selectedTicket && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
            <div className="flex items-start justify-between border-b border-zinc-800 px-6 py-5">
              <div>
                <h3 className="text-xl font-semibold text-white">{selectedTicket.projectTitle}</h3>
                <p className="mt-2 text-sm text-zinc-400">
                  Ticket #{selectedTicket.ticketId} raised by {selectedTicket.complainerName} ({selectedTicket.complainerRole})
                </p>
              </div>
              <button
                onClick={() => setSelectedTicket(null)}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="space-y-5 px-6 py-6">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Reason</div>
                <p className="mt-2 text-sm leading-6 text-zinc-200">{selectedTicket.reason}</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Client</div>
                  <p className="mt-2 text-sm text-zinc-200">{selectedTicket.clientName}</p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Artist</div>
                  <p className="mt-2 text-sm text-zinc-200">{selectedTicket.artistName}</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-zinc-800 px-6 py-5 md:flex-row md:justify-end">
              <button
                onClick={() => handleResolve('PAY_ARTIST')}
                disabled={resolving}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-700"
              >
                <CheckCircle2 className="h-4 w-4" />
                Release Payment to Artist
              </button>
              <button
                onClick={() => handleResolve('REFUND')}
                disabled={resolving}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-zinc-700"
              >
                <AlertCircle className="h-4 w-4" />
                Refund to Client
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
