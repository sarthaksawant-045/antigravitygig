import { API_BASE_URL } from '../config/runtime';

const API_URL = API_BASE_URL;

const getAdminToken = () => localStorage.getItem('admin_token');

const adminFetch = async (endpoint, options = {}) => {
  const token = getAdminToken();
  const headers = {
    'Accept': 'application/json; charset=utf-8',
    'Content-Type': 'application/json; charset=utf-8',
    ...options.headers,
  };

  if (token) {
    headers['X-ADMIN-TOKEN'] = token;
  }

  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 && !endpoint.includes('/login')) {
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_data');
        window.location.href = '/admin/login';
      }
      throw new Error(data.msg || `API Error: ${response.status}`);
    }
    return data;
  } catch (error) {
    console.error(`[AdminAPI] Fetch error for ${endpoint}:`, error);
    if (error.message.includes('Failed to fetch')) {
      throw new Error(`Network error or CORS blocked. Please ensure the backend is running on ${API_URL} and matches the allowed origins.`);
    }
    throw error;
  }
};

export const adminAuthApi = {
  login: async (email, password) => {
    const data = await adminFetch('/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (data.success) {
      localStorage.setItem('admin_token', data.token);
      localStorage.setItem('admin_data', JSON.stringify({
        id: data.admin_id,
        role: data.role,
        email: email
      }));
    }
    return { data };
  },

  logout: async () => {
    try {
      await adminFetch('/admin/logout', { method: 'POST' });
    } catch (e) {
      console.error('Logout failed', e);
    } finally {
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_data');
    }
  },
};

export const adminDashboardApi = {
  getStats: async () => {
    const response = await adminFetch('/admin/stats');
    const data = response.data;
    return {
      data: {
        totalClients: data.total_clients,
        totalFreelancers: data.total_freelancers,
        totalHireRequests: data.total_hire_requests,
        totalMessages: data.total_messages,
        pendingKycDocuments: data.pending_kyc_documents,
        verifiedFreelancers: data.verified_freelancers,
        totalRevenue: data.total_revenue,
        totalTransactions: data.total_transactions,
        totalProjects: data.total_projects,
        activeProjects: data.active_projects,
        completedProjects: data.completed_projects,
        failedEmails: data.failed_emails,
      },
    };
  },
};

export const adminUsersApi = {
  getClients: async () => {
    const data = await adminFetch('/admin/clients');
    return { data: data.results };
  },

  getFreelancers: async () => {
    const data = await adminFetch('/admin/freelancers');
    return { 
      data: data.results.map(f => ({
        ...f,
        verificationStatus: f.verification_status,
        isVerified: !!f.is_verified
      }))
    };
  },

  enableUser: async (id, role) => {
    const data = await adminFetch('/admin/user/enable', {
      method: 'POST',
      body: JSON.stringify({ id, role }),
    });
    return { data };
  },

  disableUser: async (id, role) => {
    const data = await adminFetch('/admin/user/disable', {
      method: 'POST',
      body: JSON.stringify({ id, role }),
    });
    return { data };
  },

  editUser: async (role, id, userData) => {
    const data = await adminFetch('/admin/user/edit', {
      method: 'POST',
      body: JSON.stringify({ role, id, ...userData }),
    });
    return { data };
  },

  deleteUser: async (role, id) => {
    const data = await adminFetch('/admin/user/delete', {
      method: 'POST',
      body: JSON.stringify({ role, id }),
    });
    return { data };
  },

  cleanupTestData: async () => {
    const data = await adminFetch('/admin/cleanup-test-data', {
      method: 'POST',
    });
    return { data };
  },

  verifyUserEmail: async (role, id) => {
    const data = await adminFetch('/admin/user/verify-email', {
      method: 'POST',
      body: JSON.stringify({ role, id }),
    });
    return { data };
  },
};

export const adminKycApi = {
  getPendingKyc: async () => {
    const data = await adminFetch('/admin/kyc/pending');
    return {
      data: data.results.map((r) => ({
        id: r.doc_id,
        freelancerId: r.freelancer_id,
        freelancerName: r.freelancer_name,
        freelancerEmail: r.freelancer_email,
        documentType: r.doc_type,
        status: 'PENDING',
        uploadedAt: new Date(r.uploaded_at * 1000).toISOString(),
      })),
    };
  },

  getKycDocument: async (docId) => {
    const { data: allPending } = await adminKycApi.getPendingKyc();
    const doc = allPending.find(d => String(d.id) === String(docId));
    
    if (doc) {
      return {
        data: {
          ...doc,
          documentUrl: `${API_URL}/admin/kyc/document/${docId}`,
        }
      };
    }
    
    return {
      data: {
        id: docId,
        documentUrl: `${API_URL}/admin/kyc/document/${docId}`,
      }
    };
  },

  verifyKyc: async (docId, status, reason) => {
    const data = await adminFetch('/admin/kyc/verify', {
      method: 'POST',
      body: JSON.stringify({
        doc_id: docId,
        action: status.toLowerCase(), // approve or reject
        reason,
      }),
    });
    return { data };
  },
};

export const adminProjectsApi = {
  getProjects: async (params = {}) => {
    const query = new URLSearchParams(params).toString();
    const data = await adminFetch(`/admin/projects${query ? `?${query}` : ''}`);
    return { data: data.results };
  },
  updateProjectStatus: async (id, status) => {
    return await adminFetch('/admin/project/update', {
      method: 'POST',
      body: JSON.stringify({ id, status }),
    });
  },
};

export const adminPaymentsApi = {
  getPayments: async (params = {}) => {
    const query = new URLSearchParams(params).toString();
    const data = await adminFetch(`/admin/payments${query ? `?${query}` : ''}`);
    return { 
      data: data.results.map(log => ({
        id: log.id,
        freelancerName: log.freelancer_name,
        clientName: log.client_name,
        amount: log.amount,
        status: log.status,
        date: log.date ? new Date(log.date * 1000).toISOString() : new Date(log.created_at * 1000).toISOString(),
        projectId: log.project_id,
        createdAt: log.created_at
      }))
    };
  },
  overridePayment: async (id, status) => {
    return await adminFetch('/admin/payment/override', {
      method: 'POST',
      body: JSON.stringify({ id, status }),
    });
  },
};

export const adminTicketsApi = {
  getTickets: async () => {
    const data = await adminFetch('/api/admin/tickets');
    return {
      data: (data.tickets || []).map((ticket) => ({
        ticketId: ticket.ticket_id,
        projectId: ticket.project_id,
        hireId: ticket.hire_id,
        projectTitle: ticket.project_title || `Project #${ticket.project_id}`,
        complainerId: ticket.complainer_id,
        complainerRole: ticket.complainer_role,
        complainerName: ticket.complainer_name || 'Unknown',
        reason: ticket.reason,
        status: ticket.status,
        paymentStatus: ticket.payment_status,
        clientName: ticket.client_name || 'Unknown',
        artistName: ticket.artist_name || 'Unknown',
        createdAt: ticket.created_at,
      })),
    };
  },

  resolveTicket: async (ticketId, verdict) => {
    return await adminFetch('/api/admin/tickets/resolve', {
      method: 'POST',
      body: JSON.stringify({
        ticket_id: ticketId,
        verdict,
      }),
    });
  },
};

export const adminEmailApi = {
  getEmailLogs: async (params = {}) => {
    const query = new URLSearchParams(params).toString();
    const data = await adminFetch(`/admin/email-logs${query ? `?${query}` : ''}`);
    return { data: data.results };
  },
  retryEmail: async (id) => {
    return await adminFetch('/admin/email/retry', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
  },
};

export const adminAuditApi = {
  getAuditLogs: async (params = {}) => {
    const query = new URLSearchParams(params).toString();
    const data = await adminFetch(`/admin/audit-logs${query ? `?${query}` : ''}`);
    return {
      data: data.results.map(log => ({
        id: log.id,
        freelancerName: log.freelancer_name,
        clientName: log.client_name,
        amount: log.amount,
        status: log.status,
        date: log.date ? new Date(log.date * 1000).toISOString() : new Date(log.created_at * 1000).toISOString(),
        projectId: log.project_id,
        createdAt: log.created_at
      }))
    };
  },
};
