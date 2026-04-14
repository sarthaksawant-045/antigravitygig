import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { getNotifications, markAsRead, markAllAsRead, getUnreadCount } from '../services/notificationService';
import socketService from '../services/socketService';
import './notifications.css';

const EMPTY_NOTIFICATIONS_ICON = "\u{1F4ED}";

export default function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  const formatRelativeTime = (timestamp) => {
    if (!timestamp) return 'Just now';
    const seconds = Math.max(0, Math.floor(Date.now() / 1000) - Number(timestamp));
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    }
    if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    }
    const days = Math.floor(seconds / 86400);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  };

  useEffect(() => {
    if (!user?.id) return;

    setLoading(true);

    Promise.allSettled([
      getNotifications(user.id),
      getUnreadCount(user.id)
    ])
      .then(([notifResult, countResult]) => {
        const notifRes =
          notifResult.status === 'fulfilled' ? (notifResult.value || {}) : { notifications: [] };
        const countRes =
          countResult.status === 'fulfilled' ? (countResult.value || {}) : { unread_count: 0 };

        setNotifications(notifRes.notifications || []);
        setUnreadCount(countRes.unread_count || 0);
      })
      .catch(() => {
        setNotifications([]);
        setUnreadCount(0);
      })
      .finally(() => setLoading(false));
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    const connectPromise = socketService.connected
      ? Promise.resolve()
      : socketService.connect(user.id, user.role || 'freelancer').catch(() => null);

    const handleNotificationCreated = (notification) => {
      if (!notification || Number(notification.user_id) !== Number(user.id)) return;
      setNotifications((prev) => [notification, ...prev]);
      setUnreadCount((prev) => prev + (notification.is_read ? 0 : 1));
    };

    connectPromise.finally(() => {
      socketService.on('new_notification', handleNotificationCreated);
      socketService.on('notificationCreated', handleNotificationCreated);
    });

    return () => {
      socketService.off('new_notification', handleNotificationCreated);
      socketService.off('notificationCreated', handleNotificationCreated);
    };
  }, [user?.id, user?.role]);

  const hasUnread = useMemo(() => notifications.some((item) => !item.is_read), [notifications]);

  const handleNotificationClick = async (notification) => {
    if (!notification) return;

    if (!notification.is_read) {
      try {
        await markAsRead(notification.notification_id);
        setNotifications((prev) => prev.map((item) => (
          item.notification_id === notification.notification_id
            ? { ...item, is_read: true }
            : item
        )));
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch {
        return;
      }
    }

    if (notification.reference_id) {
      navigate(`/projects/${notification.reference_id}`);
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!user?.id) return;
    try {
      await markAllAsRead(user.id);
      setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })));
      setUnreadCount(0);
    } catch {
      return;
    }
  };

  return (
    <div className="notifications-page">
      <button className="notifications-back-btn" onClick={() => navigate(-1)}>
        ← Back
      </button>
      <div className="notifications-page-header">
        <div>
          <h1 className="notifications-page-title">
            Notifications{unreadCount > 0 ? ` (${unreadCount})` : ''}
          </h1>
          <p className="notifications-page-subtitle">
            Stay on top of project updates, responses, and platform activity.
          </p>
        </div>
        {hasUnread && (
          <button className="notifications-mark-all" onClick={handleMarkAllAsRead}>
            Mark all as read
          </button>
        )}
      </div>

      <div className="notifications-card">
        {loading ? (
          <div className="notifications-loading">
            <div className="skeleton-item"></div>
            <div className="skeleton-item"></div>
            <div className="skeleton-item"></div>
          </div>
        ) : notifications.length === 0 ? (
          <div className="notifications-empty">
            <div className="notifications-empty-icon">{EMPTY_NOTIFICATIONS_ICON}</div>
            <p>You have no new notifications.</p>
          </div>
        ) : (
          <div className="notifications-list">
            {notifications.map((notif) => (
              <div
                key={notif.notification_id}
                className={`notification-row fade-in ${notif.is_read ? '' : 'is-unread'}`}
                onClick={() => handleNotificationClick(notif)}
              >
                <div className="notification-row-copy">
                  <p className="notification-row-title">
                    {notif.title}
                  </p>
                  <p className="notification-row-message">
                    {notif.message}
                  </p>
                  <span className="notification-row-time">{formatRelativeTime(notif.created_at)}</span>
                </div>
                {!notif.is_read && (
                  <div className="notification-row-dot"></div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
