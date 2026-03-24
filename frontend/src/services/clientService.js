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
};
