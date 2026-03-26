import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { getNotifications, markAsRead, markAllAsRead, getUnreadCount } from '../services/notificationService';
import socketService from '../services/socketService';

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
    
    // Parallel fetch for better performance
    Promise.all([
      getNotifications(user.id),
      getUnreadCount(user.id)
    ])
    .then(([notifRes, countRes]) => {
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
    });

    return () => {
      socketService.off('new_notification', handleNotificationCreated);
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
    <div className="page-wrap" style={{ marginTop: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          Notifications{unreadCount > 0 ? ` (${unreadCount})` : ''}
        </h1>
        {hasUnread && (
          <button className="mark-all-btn" onClick={handleMarkAllAsRead} style={{ background: 'transparent', color: '#3b82f6', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}>
            Mark all as read
          </button>
        )}
      </div>

      <div className="page-card" style={{ padding: '0', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="skeleton-item"></div>
            <div className="skeleton-item"></div>
          </div>
        ) : notifications.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#6b7280' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>ðŸ“­</div>
            <p>You have no new notifications.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {notifications.map((notif, index) => (
              <div
                key={notif.notification_id}
                className="fade-in"
                onClick={() => handleNotificationClick(notif)}
                style={{
                  padding: '20px 24px',
                  borderBottom: index !== notifications.length - 1 ? '1px solid #f3f4f6' : 'none',
                  background: notif.is_read ? '#ffffff' : '#f0f9ff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'background 0.2s ease'
                }}
              >
                <div>
                  <p style={{ margin: '0 0 6px 0', fontSize: '15px', color: '#1f2937', fontWeight: notif.is_read ? 500 : 700 }}>
                    {notif.title}
                  </p>
                  <p style={{ margin: '0 0 8px 0', fontSize: '15px', color: '#1f2937', fontWeight: notif.is_read ? 400 : 500 }}>
                    {notif.message}
                  </p>
                  <span style={{ fontSize: '12px', color: '#9ca3af' }}>{formatRelativeTime(notif.created_at)}</span>
                </div>
                {!notif.is_read && (
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#3b82f6', flexShrink: 0 }}></div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
