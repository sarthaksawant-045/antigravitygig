import { api } from './api';

export const clientService = {
  getProfile: async (clientId) => {
    return await api.get(`/client/profile/${clientId}`);
  },

  createProfile: async (profileData) => {
    return await api.post('/client/profile', profileData);
  },

  // FIXED: backend expects client_id, freelancer_id, text (not emails)
  sendMessage: async (clientId, freelancerId, text) => {
    return await api.post('/client/message/send', {
      client_id: clientId,
      freelancer_id: freelancerId,
      text,
    });
  },

  // FIXED: backend expects client_id and freelancer_id
  hireFreelancer: async (hireData) => {
    return await api.post('/client/hire', hireData);
  },

  // FIXED: backend expects client_id param
  getMessageThreads: async (clientId) => {
    return await api.get(`/client/messages/threads?client_id=${clientId}`);
  },

  // FIXED: backend expects client_id param
  getJobRequests: async (clientId) => {
    return await api.get(`/client/job-requests?client_id=${clientId}`);
  },

  // FIXED: backend expects client_id param
  getJobs: async (clientId) => {
    return await api.get(`/client/jobs?client_id=${clientId}`);
  },

  saveFreelancer: async (clientId, freelancerId) => {
    return await api.post('/client/save-freelancer', {
      client_id: clientId,
      freelancer_id: freelancerId,
    });
  },

  unsaveFreelancer: async (clientId, freelancerId) => {
    return await api.post('/client/unsave-freelancer', {
      client_id: clientId,
      freelancer_id: freelancerId,
    });
  },

  getSavedFreelancers: async (clientId) => {
    return await api.get(`/client/saved-freelancers?client_id=${clientId}`);
  },

  // FIXED: use client_id not email
  getNotifications: async (clientId) => {
    return await api.get(`/client/notifications?client_id=${clientId}`);
  },

  // NEW: Post a project to the backend
  postProject: async (clientId, projectData) => {
    return await api.post('/client/project', {
      client_id: clientId,
      title: projectData.title,
      category: projectData.category,
      location: projectData.location || '',
      budgetType: projectData.budgetType || '',
      description: projectData.description,
    });
  },

  // NEW: Fetch client's own projects
  getProjects: async (clientId) => {
    return await api.get(`/client/projects?client_id=${clientId}`);
  },

  // NEW: Get all hire requests sent by a client (with freelancer details)
  getHireRequests: async (clientId) => {
    return await api.get(`/client/hire/requests?client_id=${clientId}`);
  },

  // NEW: Fetch all active projects (for freelancer browsing)
  getAllProjects: async () => {
    return await api.get('/projects/all');
  },

  // NEW: Search projects by keyword
  searchProjects: async (query) => {
    return await api.get(`/projects/search?q=${encodeURIComponent(query)}`);
  },

  // ==========================================
  // PHASE 4: PAYMENTS & REVIEWS
  // ==========================================

  createPaymentOrder: async (hireRequestId) => {
    return await api.post('/payment/create-order', {
      hire_request_id: hireRequestId
    });
  },

  verifyPayment: async (hireRequestId, orderId, paymentId, signature) => {
    return await api.post('/payment/verify', {
      hire_request_id: hireRequestId,
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature
    });
  },

  approveWork: async (clientId, hireRequestId) => {
    return await api.post('/client/hire/approve', {
      client_id: clientId,
      hire_request_id: hireRequestId
    });
  },

  submitReview: async (clientId, hireRequestId, rating, reviewText) => {
    return await api.post('/client/hire/review', {
      client_id: clientId,
      hire_request_id: hireRequestId,
      rating: rating,
      review_text: reviewText
    });
  },

  getProjectApplicants: async (clientId, projectId) => {
    return await api.get(`/client/projects/applicants?client_id=${clientId}&project_id=${projectId}`);
  },

  acceptApplication: async (clientId, projectId, applicationId) => {
    return await api.post('/client/projects/accept_application', {
      client_id: clientId,
      project_id: projectId,
      application_id: applicationId
    });
  },
};
