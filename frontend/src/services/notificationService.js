import { api } from './api';

function getAuthHeaders() {
  try {
    const raw = localStorage.getItem('gb_user_data');
    const user = raw ? JSON.parse(raw) : null;
    if (!user?.id) return {};
    return {
      'X-USER-ID': String(user.id),
      'X-USER-ROLE': String(user.role || ''),
    };
  } catch {
    return {};
  }
}

export const getNotifications = async (userId) => {
  if (!userId) {
    return { success: true, unread_count: 0, notifications: [] };
  }

  try {
    const headers = getAuthHeaders();
    const role = headers['X-USER-ROLE'] || 'freelancer';
    return await api.get(`/notifications?user_id=${userId}&role=${role}`);
  } catch (error) {
    throw error;
  }
};

export const markAsRead = async (notificationId) => {
  if (!notificationId) {
    return { success: false, unread_count: 0 };
  }

  try {
    return await api.post('/notifications/mark-read', { notification_id: notificationId });
  } catch (error) {
    throw error;
  }
};

export const markAllAsRead = async (userId) => {
  if (!userId) {
    return { success: false, updated: 0 };
  }

  try {
    const headers = getAuthHeaders();
    const role = headers['X-USER-ROLE'] || 'freelancer';
    return await api.post('/notifications/mark-all-read', { user_id: userId, role: role });
  } catch (error) {
    throw error;
  }
};

export const getUnreadCount = async (userId) => {
  if (!userId) {
    return { success: true, unread_count: 0 };
  }

  try {
    const headers = getAuthHeaders();
    const role = headers['X-USER-ROLE'] || 'freelancer';
    return await api.get(`/notifications/unread-count?user_id=${userId}&role=${role}`);
  } catch (error) {
    throw error;
  }
};
