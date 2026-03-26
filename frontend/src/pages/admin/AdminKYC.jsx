import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/admin/AdminLayout';
import { Eye, AlertCircle, FileText } from 'lucide-react';
import { adminKycApi } from '../../services/adminApi';

export default function AdminKYC() {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      const response = await adminKycApi.getPendingKyc();
      setDocuments(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load KYC documents');
    } finally {
      setLoading(false);
    }
  };

  const handleViewDocument = (docId) => {
    navigate(`/admin/kyc/${docId}`);
  };

  return (
    <AdminLayout title="KYC Verification">
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-400">Loading KYC documents...</div>
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-400">{error}</p>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-zinc-800 border-b border-zinc-700">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Document ID</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Freelancer</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Document Type</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Status</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Uploaded At</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {documents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                      No pending KYC documents
                    </td>
                  </tr>
                ) : (
                  documents.map((doc) => (
                    <tr key={doc.id} className="hover:bg-zinc-800/50 transition-colors">
                      <td className="px-6 py-4 text-sm text-gray-400 font-mono">{doc.id}</td>
                      <td className="px-6 py-4">
                        <div>
                          <div className="text-sm text-white font-medium">{doc.freelancerName}</div>
                          <div className="text-xs text-gray-400 font-mono">{doc.freelancerId}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-2 px-3 py-1 bg-sky-500/10 text-sky-400 text-xs font-medium rounded-full border border-sky-500/20">
                          <FileText className="w-3 h-3" />
                          {doc.documentType}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                            doc.status === 'pending'
                              ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                              : doc.status === 'approved'
                              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                              : 'bg-red-500/10 text-red-400 border border-red-500/20'
                          }`}
                        >
                          {doc.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-400">
                        {new Date(doc.uploadedAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleViewDocument(doc.id)}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                          View
                        </button>
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
