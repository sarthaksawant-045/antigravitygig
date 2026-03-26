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
    return await api.get(`/api/notifications/${userId}`, {
      headers: getAuthHeaders(),
    });
  } catch (error) {
    throw error;
  }
};

export const markAsRead = async (notificationId) => {
  if (!notificationId) {
    return { success: false, unread_count: 0 };
  }

  try {
    return await api.put(`/api/notifications/${notificationId}/read`, {}, {
      headers: getAuthHeaders(),
    });
  } catch (error) {
    throw error;
  }
};

export const markAllAsRead = async (userId) => {
  if (!userId) {
    return { success: false, updated: 0 };
  }

  try {
    return await api.put(`/api/notifications/read-all/${userId}`, {}, {
      headers: getAuthHeaders(),
    });
  } catch (error) {
    throw error;
  }
};
