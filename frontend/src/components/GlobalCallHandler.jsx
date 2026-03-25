import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import socketService from '../services/socketService';
import VoiceCallModal from './VoiceCallModal';
import VideoCallModal from './VideoCallModal';

export default function GlobalCallHandler() {
  const { user } = useAuth();
  const [incomingCall, setIncomingCall] = useState(null);
  const [isVoiceModalOpen, setVoiceOpen] = useState(false);
  const [isVideoModalOpen, setVideoOpen] = useState(false);
  const [activeCall, setActiveCall] = useState(null);

  useEffect(() => {
    if (user.isAuthenticated && user.id) {
      // Connect socket if not already connected
      if (!socketService.connected) {
        socketService.connect(user.id, user.role || (window.location.pathname.startsWith('/artist') ? 'freelancer' : 'client'))
          .catch(err => console.error('[GLOBAL_CALL] Socket connection failed:', err));
      }

      const handleIncomingCall = (data) => {
        console.log('[GLOBAL_CALL] Incoming call received:', data);
        setIncomingCall(data);
      };

      const handleCallAccepted = (data) => {
        console.log('[GLOBAL_CALL] Call accepted by remote:', data);
        // Call modals (Voice/Video) already listen for this to change status to 'Connected'
      };

      const handleCallRejected = (data) => {
        console.log('[GLOBAL_CALL] Call rejected by remote:', data);
        setIncomingCall(null);
        setVoiceOpen(false);
        setVideoOpen(false);
        setActiveCall(null);
      };

      const handleCallEnded = (data) => {
        console.log('[GLOBAL_CALL] Call ended by remote:', data);
        setIncomingCall(null);
        setVoiceOpen(false);
        setVideoOpen(false);
        setActiveCall(null);
      };

      socketService.on('incoming_call', handleIncomingCall);
      socketService.on('call_accepted', handleCallAccepted);
      socketService.on('call_rejected', handleCallRejected);
      socketService.on('call_ended', handleCallEnded);

      return () => {
        socketService.off('incoming_call', handleIncomingCall);
        socketService.off('call_accepted', handleCallAccepted);
        socketService.off('call_rejected', handleCallRejected);
        socketService.off('call_ended', handleCallEnded);
      };
    }
  }, [user]);

  const handleAccept = () => {
    if (!incomingCall) return;
    
    console.log('[GLOBAL_CALL] Accepting call:', incomingCall.call_id);
    socketService.acceptCall(incomingCall.call_id, incomingCall.caller_id);

    setActiveCall({
      clientId: incomingCall.caller_id,
      clientName: incomingCall.caller_name || 'User',
      avatar: (incomingCall.caller_name || 'U').slice(0, 1).toUpperCase()
    });

    if (incomingCall.call_type === 'voice') {
      setVoiceOpen(true);
    } else {
      setVideoOpen(true);
    }
    setIncomingCall(null);
  };

  const handleDecline = () => {
    if (!incomingCall) return;
    console.log('[GLOBAL_CALL] Declining call:', incomingCall.call_id);
    socketService.rejectCall(incomingCall.call_id, incomingCall.caller_id);
    setIncomingCall(null);
  };

  if (incomingCall) {
    return (
      <div className="call-overlay">
        <div className="voice-call-card incoming-call-popup">
          <div className="call-avatar">{(incomingCall.caller_name || 'U').slice(0, 1).toUpperCase()}</div>
          <h3 className="call-name">{incomingCall.caller_name || 'User'}</h3>
          <p className="call-status">Incoming {incomingCall.call_type} call...</p>
          <div className="call-actions">
            <button className="call-btn accept-btn" onClick={handleAccept}>📞</button>
            <button className="call-btn end-btn" onClick={handleDecline}>📱</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {isVoiceModalOpen && activeCall && (
        <VoiceCallModal 
          client={activeCall} 
          onClose={() => setVoiceOpen(false)} 
        />
      )}
      {isVideoModalOpen && activeCall && (
        <VideoCallModal 
          client={activeCall} 
          onClose={() => setVideoOpen(false)} 
        />
      )}
    </>
  );
}
