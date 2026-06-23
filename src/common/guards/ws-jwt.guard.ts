// backend/src/common/guards/ws-jwt.guard.ts
import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger('WsSecurity');

  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const client: Socket = context.switchToWs().getClient<Socket>();
    
    const token = client.handshake.auth.token;

    if (!token) {
      this.logger.warn(`Intento de conexión sin token rechazado. ID: ${client.id}`);
      throw new WsException('No autorizado: Token faltante');
    }

    try {
      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET,
      });

      
      client.data.user = payload; 
      
      return true; 
    } catch (err) {
      this.logger.error(`Token inválido o expirado. ID: ${client.id}`);
      throw new WsException('No autorizado: Token inválido');
    }
  }
}