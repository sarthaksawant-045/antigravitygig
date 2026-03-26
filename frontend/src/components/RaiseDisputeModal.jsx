import { useState } from 'react';

export default function RaiseDisputeModal({ open, projectTitle, onClose, onSubmit, loading = false }) {
  const [reason, setReason] = useState('');

  if (!open) return null;

  const handleClose = () => {
    if (loading) return;
    setReason('');
    onClose?.();
  };

  const handleSubmit = async () => {
    const trimmedReason = reason.trim();
    if (!trimmedReason) return;
    const success = await onSubmit?.(trimmedReason);
    if (success !== false) {
      setReason('');
    }
  };

  return (
    <div
      onClick={handleClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: '16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '520px',
          background: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 20px 45px rgba(15, 23, 42, 0.18)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #e2e8f0' }}>
          <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>Raise Dispute</h3>
          <p style={{ margin: '8px 0 0', fontSize: '14px', color: '#64748b' }}>
            {projectTitle ? `Tell us what went wrong in "${projectTitle}".` : 'Tell us what went wrong with this project.'}
          </p>
        </div>

        <div style={{ padding: '24px' }}>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe the issue in detail so the admin team can review it."
            rows={6}
            style={{
              width: '100%',
              border: '1px solid #cbd5e1',
              borderRadius: '12px',
              padding: '14px 16px',
              fontSize: '14px',
              color: '#0f172a',
              outline: 'none',
              resize: 'vertical',
            }}
          />
        </div>

        <div style={{ padding: '0 24px 24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            style={{
              padding: '10px 16px',
              borderRadius: '10px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#334155',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !reason.trim()}
            style={{
              padding: '10px 18px',
              borderRadius: '10px',
              border: 'none',
              background: loading || !reason.trim() ? '#94a3b8' : '#dc2626',
              color: '#ffffff',
              fontWeight: 700,
              cursor: loading || !reason.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Submitting...' : 'Submit Dispute'}
          </button>
        </div>
      </div>
    </div>
  );
}
