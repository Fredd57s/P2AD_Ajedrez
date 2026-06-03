import { 
  WebSocketGateway, 
  SubscribeMessage, 
  MessageBody, 
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Worker } from 'worker_threads';

@WebSocketGateway({
  cors: { origin: 'http://localhost:5173', credentials: true },
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  
  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket) {
    console.log(`Cliente conectado: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Cliente desconectado: ${client.id}`);
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
      client.emit('room_error', { message: 'La sala está llena (Máx 2 jugadores).' });
      return { status: 'error' };
    }

    client.data.username = username;
    client.join(roomId);
    
    this.server.to(roomId).emit('sys_message', {
      text: `${username} ha entrado a la partida.`,
    });

    this.emitPlayers(roomId);

    return { status: 'success', roomId };
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
          text: msg.text + ' (Validado ✔️)'
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
  }
}