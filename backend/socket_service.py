"""
Real-time WebSocket service for messaging and calls
"""
from flask_socketio import SocketIO, emit, join_room, leave_room, disconnect
from flask import request
import json
import logging
import time

# Initialize SocketIO with proper settings
socketio = SocketIO(cors_allowed_origins="*", logger=True, engineio_logger=True, async_mode='threading')

# Store active user connections
active_users = {}


def emit_message_events(message, room):
    """Emit compatible realtime message events for all messaging clients."""
    socketio.emit('receiveMessage', message, room=room)

@socketio.on('connect')
def handle_connect():
    """Handle client connection"""
    print(f'[SOCKET] Client connected: {request.sid}')
    emit('connected', {'status': 'connected', 'sid': request.sid})

@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection"""
    print(f'[SOCKET] Client disconnected: {request.sid}')
    
    # Remove from active users
    user_to_remove = None
    for user_id, sid in active_users.items():
        if sid == request.sid:
            user_to_remove = user_id
            break
    
    if user_to_remove:
        del active_users[user_to_remove]
        print(f'[SOCKET] User {user_to_remove} went offline')
        
        # Broadcast user offline status
        socketio.emit('user_status', {
            'user_id': user_to_remove,
            'status': 'offline'
        }, broadcast=True)

@socketio.on('register_user')
def handle_register_user(data):
    """Register user with their ID"""
    try:
        if data is None:
            emit('error', {'message': 'No data provided'})
            return
            
        if isinstance(data, str):
            import json
            try:
                data = json.loads(data)
            except Exception:
                pass
                
        if not isinstance(data, dict):
            emit('error', {'message': 'Invalid data format'})
            return

        user_id = str(data.get('user_id'))
        user_role = data.get('role', 'unknown')  # 'client' or 'freelancer'
        
        if not user_id or user_id == 'None':
            emit('error', {'message': 'User ID required'})
            return
        
        # Store user session
        active_users[user_id] = request.sid
        
        # Join user-specific room
        room = f"user_{user_id}"
        join_room(room)
        
        # Join admins room if role is admin
        if user_role == 'admin':
            join_room('admins')
            print(f'[SOCKET] Admin {user_id} joined room "admins"')
        
        print(f'[SOCKET] User {user_id} ({user_role}) registered with sid {request.sid}')
        
        # Broadcast user online status
        socketio.emit('user_status', {
            'user_id': user_id,
            'status': 'online',
            'role': user_role
        }, broadcast=True)
        
        emit('registered', {
            'status': 'registered',
            'user_id': user_id,
            'active_users': list(active_users.keys())
        })
        
    except Exception as e:
        import traceback
        error_msg = traceback.format_exc()
        print(f'[SOCKET] Error registering user: {str(e)}\n{error_msg}')
        emit('error', {'message': f'Registration failed: {str(e)}'})

@socketio.on('sendMessage')
@socketio.on('send_message')
def handle_send_message(data):
    """Handle real-time message sending"""
    try:
        if data is None:
            emit('error', {'message': 'No data provided'})
            return
            
        if isinstance(data, str):
            import json
            try:
                data = json.loads(data)
            except Exception:
                pass
                
        if not isinstance(data, dict):
            emit('error', {'message': 'Invalid data format'})
            return

        sender_id = str(data.get('sender_id'))
        receiver_id = str(data.get('receiver_id'))
        message_text = data.get('text', '').strip()
        sender_role = data.get('sender_role', 'unknown')
        
        if not all([sender_id, receiver_id, message_text]) or sender_id == 'None':
            emit('error', {'message': 'Missing required fields'})
            return
        
        # Create message object
        message = {
            'id': f"{int(time.time() * 1000)}_{sender_id}",
            'sender_id': sender_id,
            'receiver_id': receiver_id,
            'sender_role': sender_role,
            'text': message_text,
            'timestamp': time.time(),
            'type': 'message'
        }
        
        print(f'[SOCKET] New message from {sender_role} {sender_id} to {receiver_id}')
        
        # Send to receiver's room if they're online
        receiver_room = f"user_{receiver_id}"
        emit_message_events(message, receiver_room)
        
        # Send confirmation to sender
        sender_room = f"user_{sender_id}"
        socketio.emit('message_sent', message, room=sender_room)
        
        # Get conversation room
        conv_id = data.get('conversation_id')
        if conv_id:
            conversation_room = f"conv_{conv_id}"
            emit_message_events(message, conversation_room)
        else:
            # Fallback to legacy room naming if no conversation_id provided
            conversation_room = f"conv_{min(sender_id, receiver_id)}_{max(sender_id, receiver_id)}"
            emit_message_events(message, conversation_room)
        
    except Exception as e:
        print(f'[SOCKET] Error sending message: {e}')
        emit('error', {'message': 'Failed to send message'})

@socketio.on('join_conversation')
def handle_join_conversation(data):
    """Join a conversation room"""
    try:
        user_id = str(data.get('user_id'))
        other_user_id = str(data.get('other_user_id'))
        
        if not all([user_id, other_user_id]):
            emit('error', {'message': 'User IDs required'})
            return
        
        # Use provided conversation_id or create legacy room name
        conv_id = data.get('conversation_id')
        if conv_id:
            conversation_room = f"conv_{conv_id}"
        else:
            conversation_room = f"conv_{min(user_id, other_user_id)}_{max(user_id, other_user_id)}"
            
        join_room(conversation_room)
        
        print(f'[SOCKET] User {user_id} joined conversation room {conversation_room}')
        
        emit('joined_conversation', {
            'conversation_room': conversation_room,
            'conversation_id': conv_id,
            'other_user_id': other_user_id
        })
        
    except Exception as e:
        print(f'[SOCKET] Error joining conversation: {e}')
        emit('error', {'message': 'Failed to join conversation'})

@socketio.on('start_call')
def handle_start_call(data):
    """Handle call initiation"""
    try:
        caller_id = str(data.get('caller_id'))
        receiver_id = str(data.get('receiver_id'))
        call_type = data.get('call_type', 'voice')  # 'voice' or 'video'
        
        if not all([caller_id, receiver_id, call_type]):
            emit('error', {'message': 'Missing required fields'})
            return
        
        call_data = {
            'call_id': f"call_{int(time.time() * 1000)}",
            'caller_id': caller_id,
            'receiver_id': receiver_id,
            'caller_name': data.get('caller_name', 'User'),
            'call_type': call_type,
            'timestamp': time.time(),
            'status': 'ringing',
            'type': 'call'
        }
        
        print(f'[SOCKET] {call_type} call from {caller_id} to {receiver_id}')
        
        # Send call request to receiver
        receiver_room = f"user_{receiver_id}"
        socketio.emit('incoming_call', call_data, room=receiver_room)
        
        # Send confirmation to caller
        emit('call_started', call_data)
        
    except Exception as e:
        print(f'[SOCKET] Error starting call: {e}')
        emit('error', {'message': 'Failed to start call'})

@socketio.on('accept_call')
def handle_accept_call(data):
    """Handle call acceptance"""
    try:
        call_id = data.get('call_id')
        caller_id = str(data.get('caller_id'))
        receiver_id = str(data.get('receiver_id'))
        
        if not all([call_id, caller_id, receiver_id]):
            emit('error', {'message': 'Missing required fields'})
            return
        
        call_data = {
            'call_id': call_id,
            'status': 'accepted',
            'timestamp': time.time()
        }
        
        print(f'[SOCKET] Call {call_id} accepted by {receiver_id}')
        
        # Notify caller that call was accepted
        caller_room = f"user_{caller_id}"
        socketio.emit('call_accepted', call_data, room=caller_room)
        
        # Send confirmation to receiver
        emit('call_accepted', call_data)
        
    except Exception as e:
        print(f'[SOCKET] Error accepting call: {e}')
        emit('error', {'message': 'Failed to accept call'})

@socketio.on('reject_call')
def handle_reject_call(data):
    """Handle call rejection"""
    try:
        call_id = data.get('call_id')
        caller_id = str(data.get('caller_id'))
        receiver_id = str(data.get('receiver_id'))
        
        if not all([call_id, caller_id, receiver_id]):
            emit('error', {'message': 'Missing required fields'})
            return
        
        call_data = {
            'call_id': call_id,
            'status': 'rejected',
            'timestamp': time.time()
        }
        
        print(f'[SOCKET] Call {call_id} rejected by {receiver_id}')
        
        # Notify caller that call was rejected
        caller_room = f"user_{caller_id}"
        socketio.emit('call_rejected', call_data, room=caller_room)
        
        # Send confirmation to receiver
        emit('call_rejected', call_data)
        
    except Exception as e:
        print(f'[SOCKET] Error rejecting call: {e}')
        emit('error', {'message': 'Failed to reject call'})

@socketio.on('end_call')
def handle_end_call(data):
    """Handle call ending"""
    try:
        call_id = data.get('call_id')
        caller_id = str(data.get('caller_id'))
        receiver_id = str(data.get('receiver_id'))
        
        if not all([call_id, caller_id, receiver_id]):
            emit('error', {'message': 'Missing required fields'})
            return
        
        call_data = {
            'call_id': call_id,
            'status': 'ended',
            'timestamp': time.time()
        }
        
        print(f'[SOCKET] Call {call_id} ended by {caller_id}')
        
        # Notify both participants
        for user_id in [caller_id, receiver_id]:
            user_room = f"user_{user_id}"
            socketio.emit('call_ended', call_data, room=user_room)
        
        # Send confirmation to sender
        emit('call_ended', call_data)
        
    except Exception as e:
        print(f'[SOCKET] Error ending call: {e}')
        emit('error', {'message': 'Failed to end call'})

def get_active_users():
    """Get list of active users"""
    return list(active_users.keys())

def is_user_online(user_id):
    """Check if user is online"""
    return str(user_id) in active_users
