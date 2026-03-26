import React, { useState, useRef, useEffect } from 'react';

const EMOJIS = [
  '\u{1F600}', '\u{1F602}', '\u{1F60D}', '\u{1F60A}',
  '\u{1F44D}', '\u{1F64F}', '\u{1F389}', '\u{2764}\u{FE0F}',
  '\u{1F525}', '\u{1F44F}', '\u{1F91D}', '\u{1F60E}'
];

export default function ChatWindow({
  currentUserId,
  conversation,
  messages,
  onSend,
  onVoiceCall,
  onVideoCall,
  onBack,
  onClearChat,
}) {
  const [text, setText] = useState('');
  const [isEmojiOpen, setIsEmojiOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const scrollRef = useRef(null);
  const emojiRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (emojiRef.current && !emojiRef.current.contains(event.target)) {
        setIsEmojiOpen(false);
      }
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const handleSend = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text);
    setText('');
    setIsEmojiOpen(false);
  };

  const handleEmojiSelect = (emoji) => {
    setText((prev) => `${prev}${emoji}`);
    setIsEmojiOpen(false);
  };

  const handleMuteToggle = () => {
    setIsMuted((prev) => !prev);
    setIsMenuOpen(false);
  };

  return (
    <>
      <header className="chat-header">
        <div className="chat-client-info">
          <button className="back-btn" onClick={onBack} title="Back to conversations">{'\u2190'}</button>
          <div className="conv-avatar">{conversation.avatar}</div>
          <div className="chat-client-text">
            <h4>{conversation.clientName}</h4>
            <span className={`chat-client-status ${conversation.online ? 'online' : ''}`}>
              {conversation.online ? 'Active now' : 'Offline'}
            </span>
          </div>
        </div>
        <div className="chat-actions">
          <button className="chat-act-btn" onClick={onVoiceCall} title="Voice Call">{'\u{1F4DE}'}</button>
          <button className="chat-act-btn" onClick={onVideoCall} title="Video Call">{'\u{1F4F9}'}</button>
          <div className="chat-menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="chat-act-btn"
              title="More"
              onClick={() => setIsMenuOpen((prev) => !prev)}
            >
              {'\u22EE'}
            </button>
            {isMenuOpen && (
              <div className="chat-menu-dropdown">
                <button type="button" className="chat-menu-item" onClick={() => { onClearChat?.(); setIsMenuOpen(false); }}>
                  Clear Chat
                </button>
                <button type="button" className="chat-menu-item" onClick={handleMuteToggle}>
                  {isMuted ? 'Unmute Notifications' : 'Mute Notifications'}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="chat-messages" ref={scrollRef}>
        {messages.map((msg) => (
          <div key={msg.id} className={`msg-bubble-wrap ${String(msg.senderId) === String(currentUserId) ? 'sent' : 'received'}`}>
            <div className="msg-bubble">
              {msg.text}
            </div>
            <span className="msg-time">{msg.timestamp}</span>
          </div>
        ))}
      </div>

      <form className="chat-input-area" onSubmit={handleSend}>
        <div className="input-actions" ref={emojiRef}>
          <button
            type="button"
            className="input-act-btn"
            title="Add emoji"
            onClick={() => setIsEmojiOpen((prev) => !prev)}
          >
            {'\u{1F60A}'}
          </button>
          {isEmojiOpen && (
            <div className="emoji-picker-popover">
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="emoji-picker-btn"
                  onClick={() => handleEmojiSelect(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="input-field-wrap">
          <input
            placeholder="Type a message..."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <button type="submit" className="send-btn">
          <span>{'\u27A4'}</span>
        </button>
      </form>
    </>
  );
}
