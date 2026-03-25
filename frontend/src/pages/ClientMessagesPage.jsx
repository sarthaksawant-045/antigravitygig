import React, { useState, useEffect, useMemo } from 'react';
import Navbar from '../components/Navbar';
import ConversationList from '../components/ConversationList';
import ChatWindow from '../components/ChatWindow';
import VoiceCallModal from '../components/VoiceCallModal';
import VideoCallModal from '../components/VideoCallModal';
import { useAuth } from '../context/AuthContext';
import socketService from '../services/socketService';
import './dashboard.css';
import './messages.css';

export default function ClientMessagesPage() {
  const { user } = useAuth();
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
      socketService.connect(user.id, 'client')
        .then(() => {
          setSocketConnected(true);
          console.log('[CLIENT_MSG] WebSocket connected for client');
        })
        .catch(error => {
          console.error('[CLIENT_MSG] WebSocket connection failed:', error);
          setSocketConnected(false);
        });

      // Set up event listeners
      socketService.on('new_message', handleNewMessage);
      socketService.on('user_status', handleUserStatus);

      return () => {
        socketService.off('new_message', handleNewMessage);
        socketService.off('user_status', handleUserStatus);
        socketService.disconnect();
      };
    }
  }, [user]);

  // Handle incoming real-time messages
  const handleNewMessage = (message) => {
    console.log('[CLIENT_MSG] Real-time message received:', message);
    
    const convId = message.conversation_id;
    if (!convId) return;
    
    const convIdStr = convId.toString();
    
    setMessages(prev => ({
      ...prev,
      [convIdStr]: [...(prev[convIdStr] || []), {
        id: message.id,
        sender: message.sender_role === 'client' ? 'client' : 'freelancer',
        text: message.text,
        timestamp: new Date(message.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]
    }));

    // Update conversation list
    setConversations(prev => prev.map(c => 
      c.id === convIdStr ? { ...c, lastMessage: message.text, time: 'Just now' } : c
    ));
  };

  // Handle user status updates
  const handleUserStatus = (status) => {
    console.log('[CLIENT_MSG] User status update:', status);
    // Update online status in conversations
    setConversations(prev => prev.map(c => 
      c.id === status.user_id ? { ...c, online: status.status === 'online' } : c
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
        console.log('[CLIENT_MSG] Fetching conversations for client:', user.id);
        const response = await fetch(`http://localhost:5000/conversations/${user.id}?role=client`);
        const data = await response.json();
        
        if (response.ok) {
          // Transform API response to match UI structure
          const transformedConversations = data.map(conv => ({
            id: conv.conversation_id.toString(),
            clientName: conv.other_user.name,
            avatar: conv.other_user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
            lastMessage: conv.last_message || '',
            time: conv.timestamp ? new Date(conv.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
            unread: 0,
            online: false,
            freelancerId: conv.other_user.id,
            conversation_id: conv.conversation_id
          }));
          
          console.log('[CLIENT_MSG] Conversations loaded:', transformedConversations.length);
          setConversations(transformedConversations);
        } else {
          console.error('[CLIENT_MSG] Failed to fetch conversations:', data.msg);
          setError(data.msg || 'Failed to load conversations');
        }
      } catch (err) {
        console.error('[CLIENT_MSG] Error fetching conversations:', err);
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
        const response = await fetch(`http://localhost:5000/message/history?client_id=${user.id}&freelancer_id=${selectedConvId}`);
        const data = await response.json();
        
        if (response.ok && data.success) {
          const transformedMessages = data.messages.map(msg => ({
            id: msg.id || `${msg.timestamp}_${msg.sender_id}`,
            sender: msg.sender_role === 'client' ? 'client' : 'freelancer',
            text: msg.text,
            timestamp: new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }));
          
          setMessages(prev => {
            const currentMessages = prev[selectedConvId] || [];
            const newMessages = transformedMessages.filter(msg => 
              !currentMessages.some(existingMsg => existingMsg.id === msg.id)
            );
            
            if (newMessages.length > 0) {
              console.log('[CLIENT_MSG] New messages received:', newMessages.length);
              return {
                ...prev,
                [selectedConvId]: [...currentMessages, ...newMessages]
              };
            }
            return prev;
          });
        }
      } catch (err) {
        console.error('[CLIENT_MSG] Error polling messages:', err);
      }
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(pollInterval);
  }, [selectedConvId, user]);

  // Fetch messages when conversation is selected
  const fetchMessages = async (freelancerId) => {
    if (!user.isAuthenticated || !user.id) return;

    try {
      console.log('[CLIENT_MSG] Fetching messages for conversation:', freelancerId);
      const response = await fetch(`http://localhost:5000/message/history?client_id=${user.id}&freelancer_id=${freelancerId}`);
      const data = await response.json();
      
      if (response.ok && data.success) {
        // Transform API response to match UI structure
        const transformedMessages = data.messages.map(msg => ({
          id: msg.id || `${msg.timestamp}_${msg.sender_id}`,
          sender: msg.sender_role === 'client' ? 'client' : 'freelancer',
          text: msg.text,
          timestamp: new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }));
        
        console.log('[CLIENT_MSG] Messages loaded:', transformedMessages.length);
        setMessages(prev => ({
          ...prev,
          [freelancerId.toString()]: transformedMessages
        }));
      } else {
        console.error('[CLIENT_MSG] Failed to fetch messages:', data.msg);
      }
    } catch (err) {
      console.error('[CLIENT_MSG] Error fetching messages:', err);
    }
  };

  const selectedConv = useMemo(() => 
    conversations.find(c => c.id === selectedConvId), 
    [selectedConvId, conversations]
  );

  const handleSelectConv = (id) => {
    setSelectedId(id);
    setMobileListOpen(false);
    // Mark as read
    setConversations(prev => prev.map(c => c.id === id ? { ...c, unread: 0 } : c));
    // Fetch messages for this conversation
    fetchMessages(id);
    
    // Join conversation room for real-time updates
    if (socketConnected && selectedConv?.conversation_id) {
      socketService.joinConversation(selectedConv.freelancerId, selectedConv.conversation_id);
    }
  };

  const handleSendMessage = async (text) => {
    if (!selectedConvId || !user.isAuthenticated || !user.id) return;

    // Try WebSocket first, fallback to HTTP
    if (socketConnected && selectedConv?.conversation_id) {
      const success = socketService.sendMessage(selectedConvId, text, selectedConv.conversation_id);
      if (success) {
        console.log('[CLIENT_MSG] Message sent via WebSocket');
        
        // Optimistic update
        const newMessage = {
          id: Date.now().toString(),
          sender: 'client',
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
        return;
      }
    }

    // Fallback to HTTP
    try {
      console.log('[CLIENT_MSG] Sending message via HTTP fallback');
      const response = await fetch('http://localhost:5000/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversation_id: selectedConv.conversation_id,
          sender_id: user.id,
          sender_role: 'client',
          message: text
        })
      });

      const data = await response.json();
      
      if (response.ok && data.success) {
        console.log('[CLIENT_MSG] Message sent successfully via HTTP');
        
        // Optimistic update - add message to UI immediately
        const newMessage = {
          id: Date.now().toString(),
          sender: 'client',
          text,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        
        setMessages(prev => ({
          ...prev,
          [selectedConvId]: [...(prev[selectedConvId] || []), newMessage]
        }));
        
        // Update last message in conversation list
        setConversations(prev => prev.map(c => 
          c.id === selectedConvId ? { ...c, lastMessage: text, time: 'Just now' } : c
        ));
      } else {
        console.error('[CLIENT_MSG] Failed to send message:', data.msg);
        alert('Failed to send message. Please try again.');
      }
    } catch (err) {
      console.error('[CLIENT_MSG] Error sending message:', err);
      alert('Failed to send message. Please try again.');
    }
  };

  // Handle voice call
  const handleVoiceCall = async () => {
    if (!selectedConv || !user.isAuthenticated || !user.id) return;

    // Try WebSocket first for real-time call signaling
    if (socketConnected) {
      const success = socketService.startCall(selectedConv.freelancerId, 'voice', user.name);
      if (success) {
        console.log('[CLIENT_CALL] Voice call initiated via WebSocket');
        setVoiceOpen(true);
        return;
      }
    }

    // Fallback to HTTP
    try {
      console.log('[CLIENT_CALL] Starting voice call via HTTP fallback');
      const response = await fetch('http://localhost:5000/call/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          caller_id: user.id,
          receiver_id: selectedConv.freelancerId,
          call_type: 'voice'
        })
      });

      const data = await response.json();
      
      if (response.ok && data.success) {
        console.log('[CLIENT_CALL] Voice call started:', data.call_id);
        setVoiceOpen(true);
      } else {
        console.error('[CLIENT_CALL] Failed to start voice call:', data.msg);
        alert('Failed to start voice call. Please try again.');
      }
    } catch (err) {
      console.error('[CLIENT_CALL] Error starting voice call:', err);
      alert('Failed to start voice call. Please try again.');
    }
  };

  // Handle video call
  const handleVideoCall = async () => {
    if (!selectedConv || !user.isAuthenticated || !user.id) return;

    // Try WebSocket first for real-time call signaling
    if (socketConnected) {
      const success = socketService.startCall(selectedConv.freelancerId, 'video', user.name);
      if (success) {
        console.log('[CLIENT_CALL] Video call initiated via WebSocket');
        setVideoOpen(true);
        return;
      }
    }

    // Fallback to HTTP
    try {
      console.log('[CLIENT_CALL] Starting video call via HTTP fallback');
      const response = await fetch('http://localhost:5000/call/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          caller_id: user.id,
          receiver_id: selectedConv.freelancerId,
          call_type: 'video'
        })
      });

      const data = await response.json();
      
      if (response.ok && data.success) {
        console.log('[CLIENT_CALL] Video call started:', data.call_id);
        setVideoOpen(true);
      } else {
        console.error('[CLIENT_CALL] Failed to start video call:', data.msg);
        alert('Failed to start video call. Please try again.');
      }
    } catch (err) {
      console.error('[CLIENT_CALL] Error starting video call:', err);
      alert('Failed to start video call. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="client-messages-layout">
        <div className="messages-page-wrapper">
          <main className="messages-container">
            <div className="loading-spinner">Loading conversations...</div>
          </main>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="client-messages-layout">
        <div className="messages-page-wrapper">
          <main className="messages-container">
            <div className="error-message">{error}</div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="client-messages-layout">
      <div className="messages-page-wrapper">
        <main className={`messages-container ${isMobileListOpen ? 'list-view' : 'chat-view'}`}>
          <div className="messages-layout">
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

            <div className={`chat-panel ${isMobileListOpen ? 'mobile-hide' : ''}`}>
              {selectedConv ? (
                <ChatWindow 
                  conversation={selectedConv}
                  messages={messages[selectedConvId] || []}
                  onSend={handleSendMessage}
                  onVoiceCall={handleVoiceCall}
                  onVideoCall={handleVideoCall}
                  onBack={() => setMobileListOpen(true)}
                />
              ) : (
                <div className="chat-empty-state">
                  <div className="empty-icon">💬</div>
                  <p>Select a freelancer to start chatting.</p>
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
