import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

export default function VideoCallModal({ client, onClose }) {
  const { user } = useAuth();
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [status, setStatus] = useState('Connecting...');
  const [callId, setCallId] = useState(null);
  const [timer, setTimer] = useState(0);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStream = useRef(null);
  const peerConnection = useRef(null);

  useEffect(() => {
    let interval;
    
    if (status === 'Connected') {
      interval = setInterval(() => {
        setTimer(prev => prev + 1);
      }, 1000);
    }

    const handleCallAccepted = () => {
      console.log('[VIDEO] Video call accepted by remote user');
      setStatus('Connected');
    };

    const handleCallEnded = () => {
      console.log('[VIDEO] Video call ended by remote user');
      onClose();
    };

    socketService.on('call_accepted', handleCallAccepted);
    socketService.on('call_ended', handleCallEnded);

    return () => {
      if (interval) clearInterval(interval);
      socketService.off('call_accepted', handleCallAccepted);
      socketService.off('call_ended', handleCallEnded);
    };
  }, [status]);

  useEffect(() => {
    async function startCamera() {
      try {
        console.log('[VIDEO] Requesting camera and microphone access');
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStream.current = stream;
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        
        console.log('[VIDEO] Video call camera access granted');
      } catch (err) {
        console.error('[VIDEO] Error accessing camera:', err);
        if (err.name === 'NotAllowedError') {
          setStatus('Camera permission denied');
        } else if (err.name === 'NotFoundError') {
          setStatus('No camera found');
        } else {
          setStatus('Failed to access camera');
        }
      }
    }

    if (camOn) {
      startCamera();
    } else {
      if (localVideoRef.current && localVideoRef.current.srcObject) {
        const tracks = localVideoRef.current.srcObject.getTracks();
        tracks.forEach(track => track.stop());
        localVideoRef.current.srcObject = null;
      }
    }

    return () => {
      if (localStream.current) {
        const tracks = localStream.current.getTracks();
        tracks.forEach(track => track.stop());
      }
      if (peerConnection.current) {
        peerConnection.current.close();
      }
    };
  }, [camOn]);

  const formatTime = (s) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleCamera = () => {
    if (localStream.current) {
      const videoTracks = localStream.current.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setCamOn(!camOn);
    }
  };

  const toggleMicrophone = () => {
    if (localStream.current) {
      const audioTracks = localStream.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setMicOn(!micOn);
    }
  };

  const handleEndCall = () => {
    console.log('[VIDEO] Ending video call');
    
    // Cleanup streams
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
    }
    
    if (peerConnection.current) {
      peerConnection.current.close();
    }
    
    socketService.endCall();
    
    onClose();
  };

  return (
    <div className="call-overlay">
      <div className="video-call-window">
        <div className="remote-video">
          {status === 'Connected' ? (
            <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', backgroundColor: '#000' }} />
          ) : (
            <>
              <div className="call-avatar" style={{ width: 120, height: 120, fontSize: 40 }}>{client.avatar}</div>
              <p style={{ marginTop: 20 }}>{client.clientName}</p>
              <p style={{ fontSize: 14, opacity: 0.7 }}>{status}</p>
            </>
          )}
        </div>
        
        <div className="local-video-preview">
          {camOn ? (
            <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#fff' }}>
              Camera Off
            </div>
          )}
        </div>

        <div className="video-controls">
          <button className={`call-btn ${!micOn ? 'end-btn' : 'mute-btn'}`} onClick={toggleMicrophone}>
            {micOn ? '🎤' : '🔇'}
          </button>
          <button className={`call-btn ${!camOn ? 'end-btn' : 'mute-btn'}`} onClick={toggleCamera}>
            {camOn ? '📹' : '📵'}
          </button>
          <button className="call-btn end-btn" onClick={handleEndCall}>📞</button>
        </div>
        
        {status === 'Connected' && (
          <div style={{ position: 'absolute', top: 20, left: 20, color: '#fff', backgroundColor: 'rgba(0,0,0,0.7)', padding: '5px 10px', borderRadius: 5 }}>
            {formatTime(timer)}
          </div>
        )}
      </div>
    </div>
  );
}
