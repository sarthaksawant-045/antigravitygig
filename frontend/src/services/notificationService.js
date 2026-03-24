import { api } from './api';

/**
 * Fetch notifications for a given user.
 * @param {number|string} userId   – the client_id or freelancer_id
 * @param {'client'|'freelancer'} role – role of the logged-in user
 */
export const getNotifications = async (userId, role = 'client') => {
  if (!userId) return [];
  try {
    if (role === 'freelancer') {
      const res = await api.get(`/freelancer/notifications?freelancer_id=${userId}`);
      return res.notifications || [];
    } else {
      const res = await api.get(`/client/notifications?client_id=${userId}`);
      return res.notifications || [];
    }
  } catch (err) {
    console.error('Failed to fetch notifications:', err);
    return [];
  }
};

export const markAsRead = async (notificationId) => {
  // Backend doesn't have a mark-read endpoint yet – no-op for now
  return Promise.resolve();
};

export const markAllAsRead = async () => {
  // Backend doesn't have a mark-all-read endpoint yet – no-op for now
  return Promise.resolve();
};

export const addNewNotification = (notification) => {
  // Placeholder for WebSocket / real-time integration
  console.log('New notification received:', notification);
};
