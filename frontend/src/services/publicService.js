import { api } from './api';

export const publicService = {
  getPlatformStats: async () => {
    try {
      return await api.get('/api/public/platform-stats');
    } catch (error) {
      throw error;
    }
  },
};
