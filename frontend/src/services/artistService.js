import { api } from './api';

export const artistService = {
  // FIXED: was calling /api/artist/dashboard (non-existent). Now calls /freelancer/stats.
  getDashboard: async (freelancerId) => {
    try {
      const res = await api.get(`/freelancer/stats?freelancer_id=${freelancerId}`);
      if (res.success && res.artist) {
        localStorage.setItem('gb_artist_category', res.artist.category || 'Artist');
      }
      return res;
    } catch {
      const cachedCategory = localStorage.getItem('gb_artist_category') || 'Singer';
      return {
        success: true,
        artist: { name: 'Artist', category: cachedCategory },
        progress: { completeness: 0.65 },
        stats: {
          earnings: 0,
          bookings: 0,
          requests: 0,
          successRate: 0,
          growthText: {
            earnings: '', bookings: '', requests: '', successRate: '',
          },
        },
      };
    }
  },

  // FIXED: was calling /api/artist/bookings. Now calls /freelancer/hire/inbox.
  getBookings: async (freelancerId) => {
    try {
      const res = await api.get(`/freelancer/hire/inbox?freelancer_id=${freelancerId}`);
      // Map hire_request shape to booking shape for the UI
      const bookings = (res.requests || []).map((r) => ({
        id: r.request_id,
        event: r.job_title || 'Booking',
        client: r.client_name || 'Client',
        date: r.created_at ? new Date(r.created_at * 1000).toISOString().split('T')[0] : '',
        value: r.proposed_budget || 0,
        status: r.status || 'PENDING',
        progress: r.status === 'ACCEPTED' ? 90 : r.status === 'PENDING' ? 40 : 10,
      }));
      return { success: true, bookings };
    } catch {
      return { success: true, bookings: [] };
    }
  },

  // FIXED: was calling /api/artist/activity. Now calls /freelancer/notifications.
  getActivity: async (freelancerId) => {
    try {
      const res = await api.get(`/freelancer/notifications?freelancer_id=${freelancerId}`);
      const items = (res.notifications || []).slice(0, 10).map((n, i) => ({
        id: `n${n.id || i}`,
        icon: n.type === 'hire_request' ? '📩' : n.type === 'payment' ? '💸' : '🔔',
        text: n.message || 'Notification',
        time: n.createdAt ? new Date(n.createdAt * 1000).toLocaleString() : 'Recently',
      }));
      return { success: true, items };
    } catch {
      return { success: true, items: [] };
    }
  },
};
