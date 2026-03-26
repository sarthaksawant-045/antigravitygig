import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/admin/AdminLayout';
import { CheckCircle, XCircle, AlertCircle, FileText, User, Calendar } from 'lucide-react';
import { adminKycApi } from '../../services/adminApi';

export default function AdminKYCReview() {
  const { doc_id } = useParams();
  const navigate = useNavigate();
  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);

  useEffect(() => {
    if (doc_id) {
      loadDocument();
    }
  }, [doc_id]);

  const loadDocument = async () => {
    try {
      const response = await adminKycApi.getKycDocument(doc_id);
      setDocument(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load document');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    setActionLoading(true);
    try {
      await adminKycApi.verifyKyc(doc_id, 'approved');
      alert('Document approved successfully');
      navigate('/admin/kyc');
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to approve document');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      alert('Please provide a rejection reason');
      return;
    }

    setActionLoading(true);
    try {
      await adminKycApi.verifyKyc(doc_id, 'rejected', rejectionReason);
      alert('Document rejected successfully');
      navigate('/admin/kyc');
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to reject document');
    } finally {
      setActionLoading(false);
      setShowRejectModal(false);
    }
  };

  return (
    <AdminLayout title="KYC Document Review">
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-400">Loading document...</div>
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-400">{error}</p>
        </div>
      ) : document ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-sky-500" />
                  Document Preview
                </h3>
                <div className="bg-black border border-zinc-700 rounded-lg p-4 aspect-video flex items-center justify-center">
                  {document.documentUrl ? (
                    <img
                      src={document.documentUrl}
                      alt="KYC Document"
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <p className="text-gray-400">Document preview not available</p>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <User className="w-5 h-5 text-sky-500" />
                  Freelancer Details
                </h3>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Name</p>
                    <p className="text-sm text-white font-medium">{document.freelancerName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Email</p>
                    <p className="text-sm text-white">{document.freelancerEmail}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Freelancer ID</p>
                    <p className="text-sm text-white font-mono">{document.freelancerId}</p>
                  </div>
                </div>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-sky-500" />
                  Document Information
                </h3>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Document Type</p>
                    <span className="inline-block px-3 py-1 bg-sky-500/10 text-sky-400 text-xs font-medium rounded-full border border-sky-500/20">
                      {document.documentType}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Status</p>
                    <span
                      className={`inline-block px-3 py-1 text-xs font-medium rounded-full ${
                        document.status === 'pending'
                          ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                          : document.status === 'approved'
                          ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                          : 'bg-red-500/10 text-red-400 border border-red-500/20'
                      }`}
                    >
                      {document.status}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Uploaded At</p>
                    <p className="text-sm text-white">{new Date(document.uploadedAt).toLocaleString()}</p>
                  </div>
                  {document.reviewedAt && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Reviewed At</p>
                      <p className="text-sm text-white">{new Date(document.reviewedAt).toLocaleString()}</p>
                    </div>
                  )}
                  {document.rejectionReason && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Rejection Reason</p>
                      <p className="text-sm text-red-400">{document.rejectionReason}</p>
                    </div>
                  )}
                </div>
              </div>

              {document.status === 'pending' && (
                <div className="space-y-3">
                  <button
                    onClick={handleApprove}
                    disabled={actionLoading}
                    className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 disabled:bg-green-500/50 text-white font-semibold py-3 rounded-lg transition-colors"
                  >
                    <CheckCircle className="w-5 h-5" />
                    Approve Document
                  </button>
                  <button
                    onClick={() => setShowRejectModal(true)}
                    disabled={actionLoading}
                    className="w-full flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 disabled:bg-red-500/50 text-white font-semibold py-3 rounded-lg transition-colors"
                  >
                    <XCircle className="w-5 h-5" />
                    Reject Document
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {showRejectModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-4">Reject Document</h3>
            <p className="text-gray-400 mb-4">Please provide a reason for rejection:</p>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              className="w-full px-4 py-3 bg-black border border-zinc-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-sky-500 transition-colors mb-4"
              rows={4}
              placeholder="Enter rejection reason..."
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowRejectModal(false)}
                className="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={actionLoading}
                className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 disabled:bg-red-500/50 text-white font-medium rounded-lg transition-colors"
              >
                {actionLoading ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
