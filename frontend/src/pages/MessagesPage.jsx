import React, { useState, useEffect, useMemo, useCallback } from 'react';
import DashboardHeader from '../components/DashboardHeader';
import DashboardSidebar from '../components/DashboardSidebar';
import ConversationList from '../components/ConversationList';
import ChatWindow from '../components/ChatWindow';
import VoiceCallModal from '../components/VoiceCallModal';
import VideoCallModal from '../components/VideoCallModal';
import { useAuth } from '../context/AuthContext';
import socketService from '../services/socketService';
import { buildApiUrl } from '../config/runtime';
import './dashboard.css';
import './messages.css';

const CHAT_EMPTY_ICON = '\u{1F4AC}';

function formatChatTime(value) {
  if (value === null || value === undefined || value === '') return '';

  const asNumber = Number(value);
  const date =
    Number.isFinite(asNumber)
      ? new Date(asNumber > 10_000_000_000 ? asNumber : asNumber * 1000)
      : new Date(value);

  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function extractMessagesPayload(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.messages)) return data.messages;
  if (data && Array.isArray(data.chat)) return data.chat;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function normalizeApiMessage(msg, fallbackKey) {
  const idPart = msg?.id ?? msg?.message_id ?? msg?.messageId ?? fallbackKey;
  const senderId = msg?.sender_id ?? msg?.senderId ?? msg?.sender;
  const senderRole = msg?.sender_role ?? msg?.senderRole ?? msg?.role;
  const text = msg?.text ?? msg?.message ?? msg?.message_text ?? msg?.content ?? '';
  const ts = msg?.timestamp ?? msg?.createdAt ?? msg?.created_at ?? msg?.time;

  return {
    id: idPart ?? fallbackKey,
    senderId,
    sender: senderRole === 'freelancer' ? 'freelancer' : 'client',
    text: String(text ?? ''),
    timestamp: formatChatTime(ts)
  };
}

function mergeMessages(existingMessages, incomingMessages) {
  const out = [];
  const seen = new Set();

  const pushUnique = (msg) => {
    if (!msg) return;
    const idKey = msg.id !== undefined && msg.id !== null ? `id:${String(msg.id)}` : '';
    const sigKey = `sig:${String(msg.senderId)}:${String(msg.timestamp)}:${String(msg.text)}`;
    const key = idKey || sigKey;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(msg);
  };

  (existingMessages || []).forEach(pushUnique);
  (incomingMessages || []).forEach(pushUnique);
  return out;
}

export default function MessagesPage() {
  const { user } = useAuth();
  const [activeSidebar, setActiveSidebar] = useState('messages');
  const [conversations, setConversations] = useState([]);
  const [selectedConvId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isVoiceModalOpen, setVoiceOpen] = useState(false);
  const [isVideoModalOpen, setVideoOpen] = useState(false);
  const [isMobileListOpen, setMobileListOpen] = useState(true);
  const [socketConnected, setSocketConnected] = useState(false);

  // Initialize WebSocket connection
  useEffect(() => {
    if (user.isAuthenticated && user.id) {
      socketService.connect(user.id, 'freelancer')
        .then(() => {
          setSocketConnected(true);
          console.log('[MSG] WebSocket connected for freelancer');
        })
        .catch(error => {
          console.error('[MSG] WebSocket connection failed:', error);
          setSocketConnected(false);
        });

      // Set up event listeners
      socketService.on('receiveMessage', handleNewMessage);
      socketService.on('user_status', handleUserStatus);

      return () => {
        socketService.off('receiveMessage', handleNewMessage);
        socketService.off('user_status', handleUserStatus);
        socketService.disconnect();
      };
    }
  }, [user.id, user.isAuthenticated]);

  // Handle incoming real-time messages
  const handleNewMessage = (message) => {
    console.log('[MSG] Real-time message received:', message);
    
    // Ignore echo messages that we already sent optimistically
    if (String(message.sender_id) === String(user.id)) return;
    
    const convId = message.conversation_id;
    const otherUserId = String(message.sender_id) === String(user.id) ? message.receiver_id : message.sender_id;
    const resolvedConv =
      convId
        ? conversations.find(c => String(c.conversation_id) === String(convId) || String(c.id) === String(convId))
        : conversations.find(c => String(c.clientId) === String(otherUserId));

    const convIdStr = (convId ?? resolvedConv?.conversation_id ?? resolvedConv?.id)?.toString();
    if (!convIdStr) return;

    const normalizedMessage = normalizeApiMessage(
      message,
      `${message?.timestamp ?? Date.now()}_${message?.sender_id ?? message?.senderId ?? 'unknown'}`
    );

    setMessages(prev => {
      const currentMessages = prev[convIdStr] || [];
      if (currentMessages.some(existingMessage => String(existingMessage.id) === String(normalizedMessage.id))) {
        return prev;
      }

      return {
        ...prev,
        [convIdStr]: [...currentMessages, normalizedMessage]
      };
    });

    // Update conversation list
    setConversations(prev => prev.map(c => 
      c.id === convIdStr ? { ...c, lastMessage: normalizedMessage.text, time: 'Just now' } : c
    ));
  };

  // Handle user status updates
  const handleUserStatus = (status) => {
    console.log('[MSG] User status update:', status);
    // Update online status in conversations
    setConversations(prev => prev.map(c => 
      String(c.clientId) === String(status.user_id) ? { ...c, online: status.status === 'online' } : c
    ));
  };

  // Fetch conversations on component mount
  useEffect(() => {
    const fetchConversations = async () => {
      if (!user.isAuthenticated || !user.id) {
        setLoading(false);
        return;
      }

      try {
        console.log('[MSG] Fetching conversations for user:', user.id);
        const response = await fetch(buildApiUrl(`/conversation/${user.id}?role=freelancer`));
        const data = await response.json();
        
        if (response.ok) {
          // Transform API response to match UI structure
          const transformedConversations = data.map(conv => ({
            id: conv.conversation_id.toString(),
            clientName: conv.other_user.name,
            avatar: conv.other_user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
            lastMessage: conv.last_message || '',
            time: formatChatTime(conv.updatedAt ?? conv.timestamp),
            unread: 0,
            online: false,
            clientId: conv.other_user.id,
            conversation_id: conv.conversation_id
          }));
          
          console.log('[MSG] Conversations loaded:', transformedConversations.length);
          setConversations(transformedConversations);
        } else {
          console.error('[MSG] Failed to fetch conversations:', data.msg);
          setError(data.msg || 'Failed to load conversations');
        }
      } catch (err) {
        console.error('[MSG] Error fetching conversations:', err);
        setError('Failed to load conversations');
      } finally {
        setLoading(false);
      }
    };

    fetchConversations();
  }, [user]);

  // Real-time polling for messages
  useEffect(() => {
    if (!selectedConvId || !user.isAuthenticated || !user.id) return;

    const pollInterval = setInterval(async () => {
      try {
        if (!selectedConv?.conversation_id) return;
        const response = await fetch(buildApiUrl(`/message/${selectedConv.conversation_id}`));
        const data = await response.json();
        
        if (response.ok && (data?.success ?? true)) {
          const rawMessages = extractMessagesPayload(data);
          const transformedMessages = rawMessages.map((msg, index) =>
            normalizeApiMessage(msg, `${selectedConv?.conversation_id ?? selectedConvId}_${index}`)
          );
          
          setMessages(prev => {
            const currentMessages = prev[selectedConvId] || [];
            const newMessages = transformedMessages.filter(msg => 
              !currentMessages.some(existingMsg => existingMsg.id === msg.id)
            );
            
            if (newMessages.length > 0) {
              console.log('[MSG] New messages received:', newMessages.length);
              return {
                ...prev,
                [selectedConvId]: [...currentMessages, ...newMessages]
              };
            }
            return prev;
          });
        }
      } catch (err) {
        console.error('[MSG] Error polling messages:', err);
      }
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(pollInterval);
  }, [selectedConvId, conversations, user]);

  // Fetch messages when conversation is selected
  const fetchMessages = useCallback(async (conversationKey) => {
    if (!user.isAuthenticated || !user.id) return;

    try {
      console.log('[MSG] Fetching messages for conversation:', conversationKey);
      const conv = conversations.find(c => c.id === conversationKey.toString() || c.id === conversationKey);
      if (!conv || !conv.conversation_id) return;
      const response = await fetch(buildApiUrl(`/message/${conv.conversation_id}`));
      const data = await response.json();
      
      if (response.ok && (data?.success ?? true)) {
        const rawMessages = extractMessagesPayload(data);
        const transformedMessages = rawMessages.map((msg, index) =>
          normalizeApiMessage(msg, `${conv.conversation_id}_${index}`)
        );
        
        console.log('[MSG] Messages loaded:', transformedMessages.length);
        setMessages(prev => {
          const key = conversationKey.toString();
          const currentMessages = prev[key] || [];
          const mergedMessages =
            transformedMessages.length > 0
              ? mergeMessages(currentMessages, transformedMessages)
              : currentMessages;

          return {
            ...prev,
            [key]: mergedMessages
          };
        });
      } else {
        console.error('[MSG] Failed to fetch messages:', data.msg);
      }
    } catch (err) {
      console.error('[MSG] Error fetching messages:', err);
    }
  }, [conversations, user.isAuthenticated, user.id]);

  const selectedConv = useMemo(() => 
    conversations.find(c => c.id === selectedConvId), 
    [selectedConvId, conversations]
  );

  useEffect(() => {
    if (!selectedConvId || !user.isAuthenticated || !user.id) return;
    if ((messages[selectedConvId] || []).length > 0) return;
    fetchMessages(selectedConvId);
  }, [selectedConvId, user.isAuthenticated, user.id, messages, fetchMessages]);

  useEffect(() => {
    if (!socketConnected || !selectedConv?.conversation_id) return;

    socketService.joinConversation(selectedConv.clientId, selectedConv.conversation_id);
  }, [socketConnected, selectedConv?.conversation_id, selectedConv?.clientId]);

  const handleSelectConv = (id) => {
    setSelectedId(id);
    setMobileListOpen(false);
    // Mark as read
    setConversations(prev => prev.map(c => c.id === id ? { ...c, unread: 0 } : c));
    // Fetch messages for this conversation
    fetchMessages(id);
  };

  const handleBackToList = () => {
    setSelectedId(null);
    setMobileListOpen(true);
  };

  const handleClearChat = () => {
    if (!selectedConvId) return;
    setMessages(prev => ({
      ...prev,
      [selectedConvId]: []
    }));
    setConversations(prev => prev.map(c =>
      c.id === selectedConvId ? { ...c, lastMessage: '', time: '' } : c
    ));
  };

  const handleSendMessage = async (text) => {
    if (!selectedConvId || !selectedConv?.conversation_id || !user.isAuthenticated || !user.id) return;

    // Optimistic update
    const tempId = Date.now().toString();
    const newMessage = {
      id: tempId,
      senderId: user.id,
      sender: 'freelancer',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    
    setMessages(prev => ({
      ...prev,
      [selectedConvId]: [...(prev[selectedConvId] || []), newMessage]
    }));
    
    setConversations(prev => prev.map(c => 
      c.id === selectedConvId ? { ...c, lastMessage: text, time: 'Just now' } : c
    ));

    // Fallback to HTTP
    try {
      console.log('[MSG] Sending message via HTTP fallback');
      const response = await fetch(buildApiUrl('/message/send'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversation_id: selectedConv.conversation_id,
          sender_id: user.id,
          sender_role: 'freelancer',
          message: text
        })
      });

      const data = await response.json();
      
      if (response.ok && data.success) {
        console.log('[MSG] Message sent successfully via HTTP');
        // The message was already added optimistically above
      } else {
        console.error('[MSG] Failed to send message:', data.msg);
        alert('Failed to send message. Please try again.');
      }
    } catch (err) {
      console.error('[MSG] Error sending message:', err);
      alert('Failed to send message. Please try again.');
    }
  };

  // Handle voice call
  const handleVoiceCall = async () => {
    if (!selectedConv || !user.isAuthenticated || !user.id) return;

    // Try WebSocket first for real-time call signaling
    if (socketConnected) {
      const success = socketService.startCall(selectedConv.clientId, 'voice', user.name);
      if (success) {
        console.log('[CALL] Voice call initiated via WebSocket');
        setVoiceOpen(true);
        return;
      }
    }

    // Fallback to HTTP
    try {
      console.log('[CALL] Starting voice call via HTTP fallback');
      const response = await fetch(buildApiUrl('/call/start'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          caller_id: user.id,
          receiver_id: selectedConv.clientId,
          call_type: 'voice'
        })
      });

      const data = await response.json();
      
      if (response.ok && data.success) {
        console.log('[CALL] Voice call started:', data.call_id);
        setVoiceOpen(true);
      } else {
        console.error('[CALL] Failed to start voice call:', data.msg);
        alert('Failed to start voice call. Please try again.');
      }
    } catch (err) {
      console.error('[CALL] Error starting voice call:', err);
      alert('Failed to start voice call. Please try again.');
    }
  };

  // Handle video call
  const handleVideoCall = async () => {
    if (!selectedConv || !user.isAuthenticated || !user.id) return;

    // Try WebSocket first for real-time call signaling
    if (socketConnected) {
      const success = socketService.startCall(selectedConv.clientId, 'video', user.name);
      if (success) {
        console.log('[VIDEO] Video call initiated via WebSocket');
        setVideoOpen(true);
        return;
      }
    }

    // Fallback to HTTP
    try {
      console.log('[VIDEO] Starting video call via HTTP fallback');
      const response = await fetch(buildApiUrl('/call/start'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          caller_id: user.id,
          receiver_id: selectedConv.clientId,
          call_type: 'video'
        })
      });

      const data = await response.json();
      
      if (response.ok && data.success) {
        console.log('[VIDEO] Video call started:', data.call_id);
        setVideoOpen(true);
      } else {
        console.error('[VIDEO] Failed to start video call:', data.msg);
        alert('Failed to start video call. Please try again.');
      }
    } catch (err) {
      console.error('[VIDEO] Error starting video call:', err);
      alert('Failed to start video call. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="db-layout">
        <DashboardHeader />
        <div className="db-shell">
          <DashboardSidebar active={activeSidebar} onSelect={setActiveSidebar} />
          <main className="db-main messages-container">
            <div className="messages-skeleton">
              <div className="skeleton-list">
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <div key={i} className="skeleton-list-item">
                    <div className="skeleton skeleton-avatar"></div>
                    <div style={{ flex: 1 }}>
                      <div className="skeleton skeleton-title"></div>
                      <div className="skeleton skeleton-subtitle"></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="skeleton-chat">
                <div className="skeleton-chat-header">
                  <div className="skeleton skeleton-avatar"></div>
                  <div style={{ flex: 1 }}>
                    <div className="skeleton skeleton-title" style={{ width: '30%', height: '16px' }}></div>
                  </div>
                </div>
                <div className="skeleton skeleton-bubble" style={{ alignSelf: 'flex-start', width: '60%' }}></div>
                <div className="skeleton skeleton-bubble" style={{ alignSelf: 'flex-end', width: '50%', background: '#eef2ff' }}></div>
                <div className="skeleton skeleton-bubble" style={{ alignSelf: 'flex-start', width: '70%' }}></div>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="db-layout">
        <DashboardHeader />
        <div className="db-shell">
          <DashboardSidebar active={activeSidebar} onSelect={setActiveSidebar} />
          <main className="db-main messages-container">
            <div className="error-message">{error}</div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="db-layout">
      <DashboardHeader />
      <div className="db-shell chat-shell">
        <DashboardSidebar active={activeSidebar} onSelect={setActiveSidebar} />
        <main className={`db-main messages-container ${isMobileListOpen ? 'list-view' : 'chat-view'}`}>
          <div className="messages-layout">
            {/* Conversations List */}
            <div className={`conv-list-panel ${!isMobileListOpen ? 'mobile-hide' : ''}`}>
              <div className="panel-header">
                <h3>Messages</h3>
              </div>
              <ConversationList 
                conversations={conversations} 
                selectedId={selectedConvId}
                onSelect={handleSelectConv}
              />
            </div>

            {/* Chat Area */}
            <div className={`chat-panel ${isMobileListOpen ? 'mobile-hide' : ''}`}>
              {selectedConv ? (
                <ChatWindow 
                  currentUserId={user.id}
                  conversation={selectedConv}
                  messages={messages[selectedConvId] || []}
                  onSend={handleSendMessage}
                  onVoiceCall={handleVoiceCall}
                  onVideoCall={handleVideoCall}
                  onBack={handleBackToList}
                  onClearChat={handleClearChat}
                />
              ) : (
                <div className="chat-empty-state">
                  <div className="empty-icon">💬</div>
                  <p>Start Conversation by choosing a client from the list.</p>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {isVoiceModalOpen && selectedConv && (
        <VoiceCallModal 
          client={selectedConv} 
          onClose={() => setVoiceOpen(false)} 
        />
      )}

      {isVideoModalOpen && selectedConv && (
        <VideoCallModal 
          client={selectedConv} 
          onClose={() => setVideoOpen(false)} 
        />
      )}
    </div>
  );
}
