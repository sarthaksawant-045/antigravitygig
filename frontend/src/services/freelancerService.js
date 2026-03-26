import { api } from './api';

export const freelancerService = {
  searchFreelancers: async (params) => {
    const queryParams = new URLSearchParams();
    if (params.category) queryParams.append('category', params.category);
    if (params.query) queryParams.append('q', params.query);
    if (params.skills) queryParams.append('skills', params.skills);
    if (params.min_rate) queryParams.append('min_rate', params.min_rate);
    if (params.max_rate) queryParams.append('max_rate', params.max_rate);
    if (params.location) queryParams.append('location', params.location);
    if (params.availability) queryParams.append('availability', params.availability);
    if (params.client_id) queryParams.append('client_id', params.client_id);

    const queryString = queryParams.toString();
    return await api.get(`/freelancers/search${queryString ? `?${queryString}` : ''}`);
  },

  getAllFreelancers: async () => {
    return await api.get('/freelancers/all');
  },

  getFreelancerById: async (id) => {
    return await api.get(`/freelancers/${id}`);
  },

  createProfile: async (profileData) => {
    return await api.post('/freelancer/profile', profileData);
  },

  // FIXED: backend expects { freelancer_id, availability_status }
  updateAvailability: async (freelancerId, availabilityStatus) => {
    return await api.post('/freelancer/update-availability', {
      freelancer_id: freelancerId,
      availability_status: availabilityStatus,
    });
  },

  // FIXED: backend expects freelancer_id not email
  getStats: async (freelancerId) => {
    return await api.get(`/freelancer/stats?freelancer_id=${freelancerId}`);
  },

  saveClient: async (freelancerId, clientId) => {
    return await api.post('/freelancer/save-client', {
      freelancer_id: freelancerId,
      client_id: clientId,
    });
  },

  getSavedClients: async (freelancerId) => {
    return await api.get(`/freelancer/saved-clients?freelancer_id=${freelancerId}`);
  },

  changePassword: async (email, oldPassword, newPassword) => {
    return await api.post('/freelancer/change-password', {
      email,
      old_password: oldPassword,
      new_password: newPassword,
    });
  },

  // Hire inbox – returns pending hire requests for a freelancer
  getHireInbox: async (freelancerId) => {
    return await api.get(`/freelancer/hire/inbox?freelancer_id=${freelancerId}`);
  },

  // Respond to a hire request
  respondToHire: async (freelancerId, requestId, action, extra = {}) => {
    return await api.post('/freelancer/hire/respond', {
      freelancer_id: freelancerId,
      request_id: requestId,
      action,
      ...extra,
    });
  },

  // Get freelancer packages for package-based pricing
  getFreelancerPackages: async (freelancerId) => {
    return await api.get(`/freelancer/${freelancerId}/packages`);
  },

  // ==========================================
  // PHASE 4: EXECUTION & REVIEWS
  // ==========================================

  completeWork: async (freelancerId, hireRequestId, note) => {
    return await api.post('/freelancer/hire/complete', {
      freelancer_id: freelancerId,
      hire_request_id: hireRequestId,
      note: note
    });
  },

  getReviews: async (freelancer_id) => {
    return await api.get(`/freelancer/reviews?freelancer_id=${freelancer_id}`);
  },

  getApplications: async (freelancerId) => {
    return await api.get(`/applications/freelancer?freelancer_id=${freelancerId}`);
  },

  applyToProject: async (freelancerId, projectId, proposal, bidAmount) => {
    return await api.post('/freelancer/projects/apply', {
      freelancer_id: freelancerId,
      project_id: projectId,
      proposal,
      bid_amount: bidAmount
    });
  },
};
