import { api } from './api';
import { buildApiUrl } from '../config/runtime';

export const publicService = {
  getPlatformStats: async () => {
    try {
      return await api.get('/api/public/platform-stats');
    } catch (error) {
      throw error;
    }
  },

  testBackendConnection: async () => {
    const testUrl = buildApiUrl('/api/public/platform-stats');

    try {
      const response = await fetch(testUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      const data = await response.json();
      console.log("Backend response:", data);

      if (!response.ok) {
        console.error(`[Backend test] Request failed with status ${response.status}`, data);
      }

      return data;
    } catch (error) {
      const message = error?.message || 'Unknown error';
      console.error('[Backend test] Request failed:', error);

      if (message === 'Failed to fetch') {
        console.error('[Backend test] Possible CORS or network error while reaching:', testUrl);
      }

      throw error;
    }
  },
};
