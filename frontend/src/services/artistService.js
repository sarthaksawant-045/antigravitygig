import { api } from './api';

export const artistService = {
  // Fetch real stats based on hire requests
  getDashboard: async (freelancerId) => {
    try {
      // 1. Get profile data
      let artistName = "Artist";
      let artistCategory = "Artist";
      let completeness = 0.5;
      
      try {
        const pRes = await api.get(`/freelancers/${freelancerId}`);
        if (pRes.success) {
          artistName = pRes.name || "Artist";
          artistCategory = pRes.category || "Artist";
          if (pRes.bio && pRes.skills && pRes.portfolio_images?.length > 0) {
            completeness = 0.9;
          } else if (pRes.bio) {
            completeness = 0.7;
          }
          localStorage.setItem('gb_artist_category', artistCategory);
        }
      } catch (err) {
        console.error("Failed to fetch profile for dashboard:", err);
      }

      // 2. Get hire inbox for stats
      let earnings = 0;
      let bookings = 0;
      let requests = 0;
      let successRate = 0;

      try {
        const hRes = await api.get(`/freelancer/hire/inbox?freelancer_id=${freelancerId}`);
        if (hRes.success && hRes.requests) {
          const allReqs = hRes.requests;
          requests = allReqs.filter(r => r.status === "PENDING").length;
          
          const accepted = allReqs.filter(r => r.status === "ACCEPTED" || r.status === "COMPLETED");
          bookings = accepted.length;
          
          earnings = accepted.reduce((acc, curr) => acc + (curr.final_agreed_amount || curr.proposed_budget || 0), 0);
          
          const resolved = allReqs.filter(r => r.status !== "PENDING");
          if (resolved.length > 0) {
            successRate = Math.round((bookings / resolved.length) * 100);
          }
        }
      } catch (err) {
        console.error("Failed to fetch hire stats for dashboard:", err);
      }

      return {
        success: true,
        artist: { name: artistName, category: artistCategory },
        progress: { completeness },
        stats: {
          earnings,
          bookings,
          requests,
          successRate,
          growthText: {
            earnings: '', bookings: '', requests: '', successRate: '',
          },
        },
      };
    } catch (e) {
      console.error(e);
      return { success: false };
    }
  },

  // Get real bookings from hire inbox
  getBookings: async (freelancerId) => {
    try {
      const res = await api.get(`/freelancer/hire/inbox?freelancer_id=${freelancerId}`);
      if (res.success) {
        const bookings = (res.requests || [])
          .filter(r => r.status === 'ACCEPTED' || r.status === 'PENDING') // Only show active/upcoming
          .map((r) => ({
            id: r.request_id,
            event: r.job_title || 'Gig Booking',
            client: r.client_name || 'Client',
            date: r.created_at ? new Date(r.created_at * 1000).toLocaleDateString() : '',
            value: r.final_agreed_amount || r.proposed_budget || 0,
            status: r.status,
            progress: r.status === 'ACCEPTED' ? 90 : 40,
          }));
        return { success: true, bookings };
      }
      return { success: false, bookings: [] };
    } catch {
      return { success: false, bookings: [] };
    }
  },

  // Get real notifications
  getActivity: async (freelancerId) => {
    try {
      // First try notifications endpoint
      const res = await api.get(`/freelancer/notifications?freelancer_id=${freelancerId}`);
      if (res.success && res.notifications?.length > 0) {
        const items = res.notifications.slice(0, 10).map((n, i) => ({
          id: `n${n.id || i}`,
          icon: n.type === 'hire_request' ? '📩' : n.type === 'payment' ? '💸' : '🔔',
          text: n.message || 'Notification',
          time: n.createdAt ? new Date(n.createdAt * 1000).toLocaleString() : 'Recently',
        }));
        return { success: true, items };
      }
      
      // Fallback: build activity from recent hire requests
      const hRes = await api.get(`/freelancer/hire/inbox?freelancer_id=${freelancerId}`);
      if (hRes.success && hRes.requests) {
        const items = hRes.requests.slice(0, 5).map(r => {
          let actionText = "New hire request received";
          let icon = '📩';
          if (r.status === 'ACCEPTED') { actionText = "You accepted a booking"; icon = '✅'; }
          else if (r.status === 'REJECTED') { actionText = "You declined a booking"; icon = '❌'; }
          
          return {
            id: `h${r.request_id}`,
            icon,
            text: `${actionText} from ${r.client_name || "Client"}`,
            time: r.created_at ? new Date(r.created_at * 1000).toLocaleDateString() : 'Recently'
          };
        });
        return { success: true, items };
      }

      return { success: true, items: [] };
    } catch {
      return { success: true, items: [] };
    }
  },
  // NEW: Project Lifecycle (Contracts)
  getContractProjects: async (freelancerId) => {
    return await api.get(`/projects/list?user_id=${freelancerId}&role=freelancer`);
  },

  completeProject: async (freelancerId, projectId, note, proof) => {
    return await api.post('/project/complete', {
      freelancer_id: freelancerId,
      project_id: projectId,
      completion_note: note,
      proof: proof
    });
  },

  raiseTicket: async (projectId, userId, reason) => {
    return await api.post('/api/tickets/raise', {
      project_id: projectId,
      user_id: userId,
      role: 'artist',
      reason,
    });
  },
};
