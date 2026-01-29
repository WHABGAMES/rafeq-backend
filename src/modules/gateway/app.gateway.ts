/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║              RAFIQ PLATFORM - WebSocket Gateway                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * أنواع الأحداث
 */
export enum SocketEvents {
  // Connection
  CONNECTION = 'connection',
  DISCONNECT = 'disconnect',
  
  // Messages
  NEW_MESSAGE = 'new_message',
  MESSAGE_SENT = 'message_sent',
  MESSAGE_DELIVERED = 'message_delivered',
  MESSAGE_READ = 'message_read',
  MESSAGE_FAILED = 'message_failed',
  
  // Conversations
  CONVERSATION_CREATED = 'conversation_created',
  CONVERSATION_UPDATED = 'conversation_updated',
  CONVERSATION_ASSIGNED = 'conversation_assigned',
  CONVERSATION_CLOSED = 'conversation_closed',
  
  // Typing
  AGENT_TYPING = 'agent_typing',
  CUSTOMER_TYPING = 'customer_typing',
  
  // Notifications
  NOTIFICATION = 'notification',
  
  // Presence
  AGENT_ONLINE = 'agent_online',
  AGENT_OFFLINE = 'agent_offline',
  AGENTS_LIST = 'agents_list',
  
  // Rooms
  JOIN_ROOM = 'join_room',
  LEAVE_ROOM = 'leave_room',
  JOIN_CONVERSATION = 'join_conversation',
  LEAVE_CONVERSATION = 'leave_conversation',
}

/**
 * بيانات المستخدم المتصل
 */
interface ConnectedUser {
  socketId: string;
  userId: string;
  tenantId: string;
  storeId?: string;
  role: string;
  name: string;
  connectedAt: Date;
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/ws',
  transports: ['websocket', 'polling'],
})
export class AppGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AppGateway.name);
  
  private connectedUsers: Map<string, ConnectedUser> = new Map();
  private tenantUsers: Map<string, Set<string>> = new Map();
  private conversationUsers: Map<string, Set<string>> = new Map();

  constructor(private readonly jwtService: JwtService) {}

  /**
   * بعد تهيئة الـ Gateway
   */
  afterInit(_server: Server) {
    this.logger.log('🚀 WebSocket Gateway initialized');
  }

  /**
   * عند اتصال مستخدم جديد
   */
  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      
      if (!token) {
        this.logger.warn(`❌ Connection rejected - No token: ${client.id}`);
        client.disconnect();
        return;
      }

      const payload = await this.verifyToken(token);
      
      if (!payload) {
        this.logger.warn(`❌ Connection rejected - Invalid token: ${client.id}`);
        client.disconnect();
        return;
      }

      const user: ConnectedUser = {
        socketId: client.id,
        userId: payload.sub,
        tenantId: payload.tenantId,
        storeId: payload.storeId,
        role: payload.role,
        name: payload.name || 'Unknown',
        connectedAt: new Date(),
      };

      this.connectedUsers.set(client.id, user);

      client.join(`tenant:${user.tenantId}`);
      
      if (!this.tenantUsers.has(user.tenantId)) {
        this.tenantUsers.set(user.tenantId, new Set());
      }
      this.tenantUsers.get(user.tenantId)!.add(client.id);

      if (user.storeId) {
        client.join(`store:${user.storeId}`);
      }

      this.server.to(`tenant:${user.tenantId}`).emit(SocketEvents.AGENT_ONLINE, {
        userId: user.userId,
        name: user.name,
        role: user.role,
      });

      this.logger.log(`✅ Client connected: ${client.id} (User: ${user.userId})`);
      
      this.sendOnlineAgents(client, user.tenantId);
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`❌ Connection error: ${errorMessage}`);
      client.disconnect();
    }
  }

  /**
   * عند قطع الاتصال
   */
  handleDisconnect(client: Socket) {
    const user = this.connectedUsers.get(client.id);
    
    if (user) {
      this.tenantUsers.get(user.tenantId)?.delete(client.id);
      
      this.conversationUsers.forEach((users, _convId) => {
        users.delete(client.id);
      });

      this.server.to(`tenant:${user.tenantId}`).emit(SocketEvents.AGENT_OFFLINE, {
        userId: user.userId,
        name: user.name,
      });

      this.connectedUsers.delete(client.id);
      this.logger.log(`👋 Client disconnected: ${client.id} (User: ${user.userId})`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Message Events
  // ═══════════════════════════════════════════════════════════════════════════════

  @SubscribeMessage(SocketEvents.JOIN_CONVERSATION)
  handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    const user = this.connectedUsers.get(client.id);
    if (!user) return;

    const room = `conversation:${data.conversationId}`;
    client.join(room);

    if (!this.conversationUsers.has(data.conversationId)) {
      this.conversationUsers.set(data.conversationId, new Set());
    }
    this.conversationUsers.get(data.conversationId)!.add(client.id);

    this.logger.debug(`User ${user.userId} joined conversation ${data.conversationId}`);
  }

  @SubscribeMessage(SocketEvents.LEAVE_CONVERSATION)
  handleLeaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    const user = this.connectedUsers.get(client.id);
    if (!user) return;

    const room = `conversation:${data.conversationId}`;
    client.leave(room);

    this.conversationUsers.get(data.conversationId)?.delete(client.id);
    this.logger.debug(`User ${user.userId} left conversation ${data.conversationId}`);
  }

  @SubscribeMessage(SocketEvents.AGENT_TYPING)
  handleAgentTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string; isTyping: boolean },
  ) {
    const user = this.connectedUsers.get(client.id);
    if (!user) return;

    this.server.to(`conversation:${data.conversationId}`).emit(SocketEvents.AGENT_TYPING, {
      conversationId: data.conversationId,
      userId: user.userId,
      name: user.name,
      isTyping: data.isTyping,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Public Methods
  // ═══════════════════════════════════════════════════════════════════════════════

  emitNewMessage(tenantId: string, conversationId: string, message: any) {
    this.server.to(`tenant:${tenantId}`).emit(SocketEvents.NEW_MESSAGE, {
      conversationId,
      message,
    });

    this.server.to(`conversation:${conversationId}`).emit(SocketEvents.NEW_MESSAGE, {
      conversationId,
      message,
    });
  }

  emitMessageStatus(
    _tenantId: string,
    conversationId: string,
    messageId: string,
    status: 'sent' | 'delivered' | 'read' | 'failed',
  ) {
    const event = {
      sent: SocketEvents.MESSAGE_SENT,
      delivered: SocketEvents.MESSAGE_DELIVERED,
      read: SocketEvents.MESSAGE_READ,
      failed: SocketEvents.MESSAGE_FAILED,
    }[status];

    this.server.to(`conversation:${conversationId}`).emit(event, {
      conversationId,
      messageId,
      status,
      timestamp: new Date().toISOString(),
    });
  }

  emitConversationUpdate(tenantId: string, conversationId: string, update: any) {
    this.server.to(`tenant:${tenantId}`).emit(SocketEvents.CONVERSATION_UPDATED, {
      conversationId,
      ...update,
    });
  }

  emitNewConversation(tenantId: string, conversation: any) {
    this.server.to(`tenant:${tenantId}`).emit(SocketEvents.CONVERSATION_CREATED, {
      conversation,
    });
  }

  emitConversationAssigned(tenantId: string, conversationId: string, assignedTo: any) {
    this.server.to(`tenant:${tenantId}`).emit(SocketEvents.CONVERSATION_ASSIGNED, {
      conversationId,
      assignedTo,
    });
  }

  emitConversationClosed(tenantId: string, conversationId: string, closedBy: any) {
    this.server.to(`tenant:${tenantId}`).emit(SocketEvents.CONVERSATION_CLOSED, {
      conversationId,
      closedBy,
      closedAt: new Date().toISOString(),
    });
  }

  emitNotification(tenantId: string, notification: {
    type: 'info' | 'success' | 'warning' | 'error';
    title: string;
    message: string;
    data?: any;
  }) {
    this.server.to(`tenant:${tenantId}`).emit(SocketEvents.NOTIFICATION, {
      ...notification,
      timestamp: new Date().toISOString(),
    });
  }

  emitToUser(userId: string, event: string, data: any) {
    for (const [socketId, user] of this.connectedUsers) {
      if (user.userId === userId) {
        this.server.to(socketId).emit(event, data);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Helper Methods
  // ═══════════════════════════════════════════════════════════════════════════════

  private extractToken(client: Socket): string | null {
    const authHeader = client.handshake.headers.authorization;
    if (authHeader) {
      const [type, token] = authHeader.split(' ');
      if (type === 'Bearer' && token) {
        return token;
      }
    }

    const queryToken = client.handshake.query.token;
    if (queryToken && typeof queryToken === 'string') {
      return queryToken;
    }

    const authToken = client.handshake.auth?.token;
    if (authToken) {
      return authToken;
    }

    return null;
  }

  private async verifyToken(token: string): Promise<any> {
    try {
      return this.jwtService.verify(token);
    } catch {
      return null;
    }
  }

  private sendOnlineAgents(client: Socket, tenantId: string) {
    const onlineAgents: any[] = [];
    
    const tenantSocketIds = this.tenantUsers.get(tenantId);
    if (tenantSocketIds) {
      tenantSocketIds.forEach(socketId => {
        const user = this.connectedUsers.get(socketId);
        if (user && user.role !== 'customer') {
          onlineAgents.push({
            userId: user.userId,
            name: user.name,
            role: user.role,
            connectedAt: user.connectedAt,
          });
        }
      });
    }

    client.emit(SocketEvents.AGENTS_LIST, { agents: onlineAgents });
  }

  getConnectedCount(tenantId?: string): number {
    if (tenantId) {
      return this.tenantUsers.get(tenantId)?.size || 0;
    }
    return this.connectedUsers.size;
  }

  getConnectedUsers(tenantId: string): ConnectedUser[] {
    const users: ConnectedUser[] = [];
    const socketIds = this.tenantUsers.get(tenantId);
    
    if (socketIds) {
      socketIds.forEach(socketId => {
        const user = this.connectedUsers.get(socketId);
        if (user) {
          users.push(user);
        }
      });
    }

    return users;
  }
}
