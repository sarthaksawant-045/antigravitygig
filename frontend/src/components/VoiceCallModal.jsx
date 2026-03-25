import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

export default function VoiceCallModal({ client, onClose }) {
  const { user } = useAuth();
  const [status, setStatus] = useState('Calling...');
  const [timer, setTimer] = useState(0);
  const [callId, setCallId] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const localStream = useState(null);

  useEffect(() => {
    // Initialize voice call
    const initializeCall = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localStream[1](stream);
        console.log('[CALL] Voice call microphone access granted');
      } catch (err) {
        console.error('[CALL] Error accessing microphone:', err);
        setStatus('Failed to access microphone');
      }
    };

    initializeCall();

    const handleCallAccepted = () => {
      console.log('[CALL] Voice call accepted by remote user');
      setStatus('Connected');
    };

    const handleCallEnded = () => {
      console.log('[CALL] Voice call ended by remote user');
      onClose();
    };

    socketService.on('call_accepted', handleCallAccepted);
    socketService.on('call_ended', handleCallEnded);

    let interval;
    if (status === 'Connected') {
      interval = setInterval(() => {
        setTimer(prev => prev + 1);
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
      socketService.off('call_accepted', handleCallAccepted);
      socketService.off('call_ended', handleCallEnded);
      if (localStream[0]) {
        localStream[0].getTracks().forEach(track => track.stop());
      }
    };
  }, [status, client.clientId]);

  const formatTime = (s) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEndCall = () => {
    console.log('[CALL] Ending voice call');
    socketService.endCall();
    onClose();
  };

  const toggleMute = () => {
    if (localStream[0]) {
      const audioTracks = localStream[0].getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  return (
    <div className="call-overlay">
      <div className="voice-call-card">
        <div className="call-avatar">{client.avatar}</div>
        <h3 className="call-name">{client.clientName}</h3>
        <p className="call-status">
          {status === 'Connected' ? formatTime(timer) : status}
        </p>
        <div className="call-actions">
          <button className={`call-btn ${isMuted ? 'end-btn' : 'mute-btn'}`} onClick={toggleMute}>
            {isMuted ? '🔇' : '🎤'}
          </button>
          <button className="call-btn end-btn" onClick={handleEndCall}>📞</button>
        </div>
      </div>
    </div>
  );
}
