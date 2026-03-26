/**
 * Real-time WebSocket service for messaging and calls
 */
import { io } from 'socket.io-client';

class SocketService {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.userRole = null;
    this.userId = null;
    this.eventHandlers = {};
  }

  // Initialize socket connection
  connect(userId, userRole = 'client') {
    if (this.socket && this.connected) {
      console.log('[SOCKET] Already connected');
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      console.log(`[SOCKET] Connecting to server as ${userRole} ${userId}...`);
      
      this.socket = io('http://localhost:5000', {
        transports: ['websocket', 'polling'],
        timeout: 10000,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      this.userId = userId;
      this.userRole = userRole;

      // Connection events
      this.socket.on('connect', () => {
        console.log('[SOCKET] Connected to server');
        this.connected = true;
        
        // Register user with server
        this.registerUser(userId, userRole);
        resolve();
      });

      this.socket.on('disconnect', () => {
        console.log('[SOCKET] Disconnected from server');
        this.connected = false;
      });

      this.socket.on('connect_error', (error) => {
        console.error('[SOCKET] Connection error:', error);
        this.connected = false;
        reject(error);
      });

      // Message events
      this.socket.on('new_message', (message) => {
        console.log('[SOCKET] New message received:', message);
        this.emit('new_message', message);
      });

      this.socket.on('message_sent', (message) => {
        console.log('[SOCKET] Message sent confirmation:', message);
        this.emit('message_sent', message);
      });

      // Call events
      this.socket.on('incoming_call', (call) => {
        console.log('[SOCKET] Incoming call:', call);
        this.emit('incoming_call', call);
      });

      this.socket.on('call_accepted', (call) => {
        console.log('[SOCKET] Call accepted:', call);
        this.emit('call_accepted', call);
      });

      this.socket.on('call_rejected', (call) => {
        console.log('[SOCKET] Call rejected:', call);
        this.emit('call_rejected', call);
      });

      this.socket.on('call_ended', (call) => {
        console.log('[SOCKET] Call ended:', call);
        this.emit('call_ended', call);
      });

      // User status events
      this.socket.on('user_status', (status) => {
        console.log('[SOCKET] User status update:', status);
        this.emit('user_status', status);
      });

      // Conversation events
      this.socket.on('joined_conversation', (data) => {
        console.log('[SOCKET] Joined conversation:', data);
        this.emit('joined_conversation', data);
      });

      this.socket.on('applicationSent', (payload) => {
        console.log('[SOCKET] Application event received:', payload);
        this.emit('applicationSent', payload);
      });

      this.socket.on('notificationCreated', (payload) => {
        this.emit('notificationCreated', payload);
      });

      // Error handling
      this.socket.on('error', (error) => {
        console.error('[SOCKET] Socket error:', error);
        this.emit('error', error);
      });
    });
  }

  // Register user with server
  registerUser(userId, userRole) {
    if (!this.socket || !this.connected) {
      console.warn('[SOCKET] Cannot register user - not connected');
      return;
    }

    this.socket.emit('register_user', {
      user_id: userId,
      role: userRole
    });
  }

  // Join a conversation room
  joinConversation(otherUserId, conversationId = null) {
    if (!this.socket || !this.connected) {
      console.warn('[SOCKET] Cannot join conversation - not connected');
      return;
    }

    this.socket.emit('join_conversation', {
      user_id: this.userId,
      other_user_id: otherUserId,
      conversation_id: conversationId
    });
  }

  // Send a real-time message
  sendMessage(receiverId, text, conversationId = null) {
    if (!this.socket || !this.connected) {
      console.warn('[SOCKET] Cannot send message - not connected');
      return false;
    }

    this.socket.emit('send_message', {
      sender_id: this.userId,
      receiver_id: receiverId,
      text: text,
      sender_role: this.userRole,
      conversation_id: conversationId
    });
    return true;
  }

  // Start a call
  startCall(receiverId, callType = 'voice') {
    if (!this.socket || !this.connected) {
      console.warn('[SOCKET] Cannot start call - not connected');
      return false;
    }

    this.socket.emit('start_call', {
      caller_id: this.userId,
      receiver_id: receiverId,
      call_type: callType
    });
    return true;
  }

  // Accept a call
  acceptCall(callId, callerId) {
    if (!this.socket || !this.connected) {
      console.warn('[SOCKET] Cannot accept call - not connected');
      return false;
    }

    this.socket.emit('accept_call', {
      call_id: callId,
      caller_id: callerId,
      receiver_id: this.userId
    });
    return true;
  }

  // Reject a call
  rejectCall(callId, callerId) {
    if (!this.socket || !this.connected) {
      console.warn('[SOCKET] Cannot reject call - not connected');
      return false;
    }

    this.socket.emit('reject_call', {
      call_id: callId,
      caller_id: callerId,
      receiver_id: this.userId
    });
    return true;
  }

  // End a call
  endCall(callId, otherUserId) {
    if (!this.socket || !this.connected) {
      console.warn('[SOCKET] Cannot end call - not connected');
      return false;
    }

    this.socket.emit('end_call', {
      call_id: callId,
      caller_id: this.userId,
      receiver_id: otherUserId
    });
    return true;
  }

  // Event handling
  on(event, handler) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event].push(handler);
  }

  off(event, handler) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event] = this.eventHandlers[event].filter(h => h !== handler);
    }
  }

  emit(event, data) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].forEach(handler => handler(data));
    }
  }

  // Disconnect
  disconnect() {
    if (this.socket) {
      console.log('[SOCKET] Disconnecting...');
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
      this.userId = null;
      this.userRole = null;
    }
  }

  // Connection status
  isConnected() {
    return this.connected;
  }
}

// Create singleton instance
const socketService = new SocketService();

export default socketService;
