import { 
  WebSocketGateway, SubscribeMessage, MessageBody, ConnectedSocket,
  OnGatewayConnection, OnGatewayDisconnect, WebSocketServer, WsException 
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Worker } from 'worker_threads';
import { WsLoggingInterceptor } from '../common/interceptors/ws-logging.interceptor';
import { GlobalWsExceptionFilter } from '../common/filters/ws-exception.filter';


import { UseInterceptors, UseFilters, UseGuards } from '@nestjs/common'; 
import { WsJwtGuard } from '../common/guards/ws-jwt.guard'; //

import { MatchesService } from '../matches/matches.service';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';

import * as os from 'os';

@WebSocketGateway({
  cors: { origin: 'http://localhost:5173', credentials: true },
})

@UseInterceptors(WsLoggingInterceptor)
@UseFilters(GlobalWsExceptionFilter)
@UseGuards(WsJwtGuard)
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  
  @WebSocketServer()
  server!: Server;

  private activeWorkers = 0;

  constructor(
    private readonly matchesService: MatchesService,
    @InjectRepository(User) 
    private readonly userRepository: Repository<User>, 
  ) {}

  onModuleInit() {
    setInterval(() => {
      const memoryUsage = process.memoryUsage();
      this.server.emit('server_stats', {
        ramUsed: (memoryUsage.heapUsed / 1024 / 1024).toFixed(2), // MB
        cpuLoad: os.loadavg()[0].toFixed(2), // Carga promedio de la CPU
        activeThreads: this.activeWorkers,
        totalConnections: this.server.engine.clientsCount // Usuarios conectados al socket
      });
    }, 2000);
  }

  handleConnection(client: Socket) {
    console.log(`Cliente conectado: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Cliente desconectado: ${client.id}`);
    this.handlePlayerLeave(client);
  }

  @SubscribeMessage('leave_room')
  handleLeaveRoom(@ConnectedSocket() client: Socket) {
    this.handlePlayerLeave(client);
  }

  private async handlePlayerLeave(client: Socket) {
    const roomId = client.data.roomId;
    
    if (roomId) {
      if (client.data.isGameOver) {
        client.leave(roomId);
        client.data.roomId = null;
        client.data.isGameOver = false;
        return;
      }

      const room = this.server.sockets.adapter.rooms.get(roomId);
      let winnerSocket: Socket | null = null;

      if (room) {
        room.forEach((clientId) => {
          if (clientId !== client.id) {
            winnerSocket = this.server.sockets.sockets.get(clientId) as Socket;
          }
        });
      }

      let transactionFailed = false; 

      if (winnerSocket && client.data.color) {
        const winnerDbId = winnerSocket.data.user?.sub;
        const loserDbId = client.data.user?.sub;

        if (winnerDbId && loserDbId && winnerDbId !== loserDbId) {
          try {
            await this.matchesService.recordMatchResult(winnerDbId, loserDbId, false);
            await this.sendFreshElo(client, loserDbId);
            await this.sendFreshElo(winnerSocket, winnerDbId);
          } catch (e) {
            console.error('Error registrando Elo por abandono:', e);
            
            // Se enciende el semáforo rojo
            transactionFailed = true; 
            
            this.server.to(roomId).emit('room_error', {
              title: 'Error de Sincronización',
              message: 'Se perdió la conexión con la base de datos. La partida ha sido anulada.'
            });
          }
        }
      }

      client.leave(roomId);
      client.data.roomId = null; 
      
      if (!transactionFailed) {
        this.server.to(roomId).emit('opponent_abandoned', {
          message: `${client.data.username || 'El oponente'} abandonó la partida.`
        });
      }

      if (room) {
        room.forEach((clientId) => {
          const clientSocket = this.server.sockets.sockets.get(clientId);
          if (clientSocket) {
            clientSocket.leave(roomId);
            clientSocket.data.roomId = null;
          }
        });
      }
      this.broadcastLobbyUpdate();
    }
  }

  @SubscribeMessage('join_room')
  handleJoinRoom(
    @MessageBody() data: { roomId: string; username: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId, username } = data;
    const room = this.server.sockets.adapter.rooms.get(roomId);
    const currentSize = room ? room.size : 0;

    if (client.rooms.has(roomId)) {
      this.emitPlayers(roomId);
      return { status: 'success' };
    }

    if (currentSize >= 2) {
      client.emit('room_error', { title: 'Sala Llena', message: 'Ya hay 2 jugadores en esta sala.' });
      return { status: 'error' };
    }

    const playerColor = currentSize === 0 ? 'w' : 'b';

    client.data.roomId = roomId;
    client.data.username = username;
    client.data.color = playerColor; 
    client.join(roomId);
    
    client.emit('assign_color', playerColor);

    this.server.to(roomId).emit('sys_message', { text: `${username} ha entrado a la partida.` });
    this.emitPlayers(roomId);
    this.broadcastLobbyUpdate();

    if (currentSize + 1 === 2) {
      this.server.to(roomId).emit('game_started');
      this.server.to(roomId).emit('sys_message', { text: '¡La partida ha comenzado! Mueven las blancas.' });
    }

    return { status: 'success', roomId };
  }

  @SubscribeMessage('request_lobby_update')
  handleRequestLobbyUpdate(@ConnectedSocket() client: Socket) {
    this.broadcastLobbyUpdate();
  }

  private broadcastLobbyUpdate() {
    const activeRooms: Record<string, number> = {};
    // Verificamos el tamaño de nuestras 8 salas PvP
    for (let i = 1; i <= 8; i++) {
      const roomName = `sala-${i}`;
      const room = this.server.sockets.adapter.rooms.get(roomName);
      activeRooms[roomName] = room ? room.size : 0;
    }
    this.server.emit('lobby_updated', activeRooms);
  }

  private emitPlayers(roomId: string) {
    const room = this.server.sockets.adapter.rooms.get(roomId);
    const players: { id: string; username: string }[] = [];
    if (room) {
      room.forEach((clientId) => {
        const clientSocket = this.server.sockets.sockets.get(clientId);
        if (clientSocket && clientSocket.data.username) {
          players.push({ id: clientId, username: clientSocket.data.username });
        }
      });
    }
    this.server.to(roomId).emit('room_players', players);
  }


  @SubscribeMessage('send_chat')
  handleChat(
    @MessageBody() data: { roomId: string; username: string; text: string },
    @ConnectedSocket() client: Socket,
  ) {

    this.activeWorkers++;

    const workerCode = `
      const { parentPort } = require('worker_threads');
      
      parentPort.on('message', (msg) => {
        // Simulamos un procesamiento pesado que tomaría 1 segundo
        // Si esto estuviera en el hilo principal, todo el backend se congelaría
        const start = Date.now();
        while (Date.now() - start < 1000) {} 
        
        // Devolvemos el mensaje procesado
        parentPort.postMessage({
          username: msg.username,
          text: msg.text
        });
      });
    `;

    const worker = new Worker(workerCode, { eval: true });
    
    worker.postMessage({ username: data.username, text: data.text });
    
    worker.on('message', (result) => {
      this.server.to(data.roomId).emit('room_chat', {
        username: result.username,
        text: result.text
      });
      worker.terminate(); 
    });

    worker.on('error', (err) => {
      console.error('Error en el hilo secundario:', err);
      worker.terminate();
    });

    worker.on('exit', () => {
      this.activeWorkers--; 
    });
  }



  @SubscribeMessage('make_move')
  handleMakeMove(
    @MessageBody() data: { roomId: string; from: string; to: string; promotion?: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.to(data.roomId).emit('move_received', {
      from: data.from,
      to: data.to,
      promotion: data.promotion || 'q'
    });
  }



  @SubscribeMessage('game_over')
  async handleGameOver(
    @MessageBody() data: { roomId: string; winnerColor: 'w' | 'b' | 'draw' },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const room = this.server.sockets.adapter.rooms.get(data.roomId);
      if (!room) return;

      let winnerId = '';
      let loserId = '';
      const isDraw = data.winnerColor === 'draw';

      // Recorremos los sockets de la sala para extraer sus IDs reales de la BD
      room.forEach((clientId) => {
        const s = this.server.sockets.sockets.get(clientId);
        if (s) {
          if (isDraw) {
            if (!winnerId) winnerId = s.data.user?.sub;
            else loserId = s.data.user?.sub;
          } else {
            if (s.data.color === data.winnerColor) {
              winnerId = s.data.user?.sub;
            } else {
              loserId = s.data.user?.sub;
            }
          }
        }
      });

      if (winnerId && loserId && winnerId !== loserId) {
        // Ejecutamos la transacción ACID
        await this.matchesService.recordMatchResult(winnerId, loserId, isDraw);
        
        this.server.to(data.roomId).emit('sys_message', {
          text: `Base de datos sincronizada: Se han recalculado los puntajes competitivos.`,
        });

        // Actualizamos los puntajes y encendemos la salvaguarda de fin de juego
        room.forEach((clientId) => {
          const s = this.server.sockets.sockets.get(clientId);
          if (s) {
            s.data.isGameOver = true;
            if (s.data.user?.sub) {
              this.sendFreshElo(s, s.data.user.sub);
            }
          }
        });
      }
    } catch (error) {
      this.server.to(data.roomId).emit('room_error', {
        title: 'Error Crítico de Datos',
        message: 'No se pudo establecer conexión con MySQL. Los cambios de Elo fueron cancelados para preservar la integridad del perfil.'
      });

      throw new WsException('Error crítico al guardar los resultados.');
    }
  }


  @SubscribeMessage('request_my_elo')
  async handleRequestMyElo(@ConnectedSocket() client: Socket) {
    const userId = client.data.user?.sub; 
    
    if (userId) {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (user) {
        client.emit('update_my_elo', user.elo); 
      }
    }
  }

  private async sendFreshElo(client: Socket, userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (user) {
      client.emit('update_my_elo', user.elo);
    }
  }
}