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

import { EventEmitter2 } from '@nestjs/event-emitter';


import { TournamentParticipant } from './entities/tournament-participant.entity';

import { OnEvent } from '@nestjs/event-emitter';

@WebSocketGateway({
  cors: { origin: 'http://localhost:5173', credentials: true },
})

@UseInterceptors(WsLoggingInterceptor)
@UseFilters(GlobalWsExceptionFilter)
@UseGuards(WsJwtGuard)
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  
  @WebSocketServer()
  server!: Server;
  private tournamentParticipants: { userId: string; username: string }[] = [];
  private activeWorkers = 0;
  private activeSessions = new Map<string, string>();
  // Mapa para guardar: { roomId: { fen: string, players: { [userId]: 'w' | 'b' } } }
  private activeGames = new Map<string, { 
    fen: string; 
    players: Record<string, 'w' | 'b'>;
    time: { w: number; b: number; turn: 'w' | 'b'; lastMove: number; timeoutId?: NodeJS.Timeout };
    coachAdvice: { w: string | null; b: string | null };
  }>();

  private disconnectTimers = new Map<string, NodeJS.Timeout>();
  constructor(
    private readonly matchesService: MatchesService,
    @InjectRepository(User) 
    private readonly userRepository: Repository<User>, 

    @InjectRepository(TournamentParticipant)
    private readonly tournamentRepo: Repository<TournamentParticipant>,
    
    private eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit() {
    // 👇 1. LEER LA BASE DE DATOS AL INICIAR EL SERVIDOR
    try {
      // Traemos todos los registrados ordenados por fecha de registro
      const dbParticipants = await this.tournamentRepo.find({ order: { registeredAt: 'ASC' } });
      
      // Los cargamos a la memoria rápida del servidor
      this.tournamentParticipants = dbParticipants.map(p => ({
        userId: p.userId,
        username: p.username
      }));
      
      console.log(`[Torneo] Memoria restaurada desde BD. Jugadores: ${this.tournamentParticipants.length}/8`);
    } catch (error) {
      console.error('[Torneo] Error leyendo base de datos de torneo:', error);
    }

    // Tu setInterval normal...
    setInterval(() => {
      const memoryUsage = process.memoryUsage();
      this.server.emit('server_stats', {
        ramUsed: (memoryUsage.heapUsed / 1024 / 1024).toFixed(2),
        cpuLoad: require('os').loadavg()[0].toFixed(2),
        activeThreads: this.activeWorkers,
        totalConnections: this.server.engine.clientsCount
      });
    }, 2000);
  }

  async handleConnection(client: Socket) {
    try {
      const userId = client.handshake.auth?.userId; 

      if (userId) {
        client.data.userId = userId;
        
        // 👇 1. DESTRUCCIÓN DE FANTASMAS CORREGIDA
        if (this.activeSessions.has(userId)) {
          const oldSocketId = this.activeSessions.get(userId);
          
          if (oldSocketId && oldSocketId !== client.id) {
            const oldSocket = this.server.sockets.sockets.get(oldSocketId);
            if (oldSocket) {
              oldSocket.emit('session_rejected', { message: 'Iniciaste sesión en otro lugar. Conexión antigua cerrada.' });
              oldSocket.disconnect(true);
            }
          }
        }
        
        // Guardamos el NUEVO socket
        this.activeSessions.set(userId, client.id);

        // 👇 2. CANCELACIÓN GLOBAL DEL TEMPORIZADOR
        const timer = this.disconnectTimers.get(userId);
        if (timer) {
          clearTimeout(timer);
          this.disconnectTimers.delete(userId);
        }

        // 👇 3. 🔥 NUEVO: TELETRANSPORTACIÓN FORZADA 🔥
        // Buscamos si el usuario pertenece a alguna partida activa
        let activeRoomId = null;
        for (const [roomId, game] of this.activeGames.entries()) {
          if (game.players[userId]) {
            activeRoomId = roomId;
            break; // Lo encontramos, dejamos de buscar
          }
        }

        // Si estaba en una partida, le ordenamos al frontend que lo lleve allá
        if (activeRoomId) {
          client.emit('force_reconnect', { roomId: activeRoomId });
        }
      }
      
      console.log(`Cliente conectado: ${client.id}`);
    } catch (error) {
      client.disconnect();
    }
  }

  /*handleDisconnect(client: Socket) {
    console.log(`Cliente desconectado: ${client.id}`);
    
    // Disparamos la lógica de abandono de partida
    this.handlePlayerLeave(client);

    // Liberamos el candado de sesión única (Solo si el que se desconecta es el Socket original)
    const userId = client.data.user?.sub || client.data.userId;
    if (userId && this.activeSessions.get(userId) === client.id) {
      this.activeSessions.delete(userId);
    }
  }*/

  handleDisconnect(client: Socket) {
    // 👇 Usamos el userId que ahora viene seguro desde el frontend
    const userId = client.handshake.auth?.userId;
    const roomId = client.data.roomId;

    // 👇 ESCUDO ANTI-FANTASMAS: Si el socket que muere ya no es el activo, es un fantasma del F5. Lo ignoramos por completo.
    if (userId && this.activeSessions.get(userId) !== client.id) {
      return; 
    }

    // Si el usuario estaba en una partida, le damos 60 segundos antes de rendirlo
    if (roomId && userId && this.activeGames.has(roomId)) {
      this.server.to(roomId).emit('sys_message', { 
        text: '⚠️ El oponente se ha desconectado. Esperando reconexión (60s)...' 
      });
      
      const timer = setTimeout(async () => {
        await this.handlePlayerLeave(client); 
        this.disconnectTimers.delete(userId);
      }, 60000); 

      this.disconnectTimers.set(userId, timer);
    }

    if (userId && this.activeSessions.get(userId) === client.id) {
      this.activeSessions.delete(userId);
    }
  }

  @SubscribeMessage('leave_room')
  async handleExplicitLeave(@ConnectedSocket() client: Socket) {
    // Como presionó el botón rojo, abandona inmediatamente sin esperar 60s
    await this.handlePlayerLeave(client);
  }

  private async handlePlayerLeave(client: Socket) {
    const roomId = client.data.roomId;
    
    if (roomId) {
      this.activeGames.delete(roomId);
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


  // Llama a Ollama localmente y devuelve la respuesta
  // Llama a Ollama localmente y devuelve una respuesta estructurada y sin saludos
  // 🧠 Llama a Groq Cloud en lugar de Ollama local
  private async askGroqCoach(fen: string, playerColor: 'w' | 'b'): Promise<string> {
    const colorName = playerColor === 'w' ? 'Blancas' : 'Negras';
    
    const prompt = `Eres un motor analista de ajedrez rápido.
Posición FEN actual: ${fen}
Jugador a aconsejar: ${colorName}.

Reglas de respuesta estrictas:
1. NO saludes ni te presentes. Prohibido decir "Hola", "Bienvenido", "Amigo", "Jugador", etc. Ve DIRECTO al grano.
2. Recomienda una jugada concreta clara. OBLIGATORIO mencionar la casilla de ORIGEN y la de DESTINO (ejemplo: "Mueve el peón de e2 a e4" o "Mueve el Caballo de g1 a f3").
3. Explica brevemente la idea táctica en 1 sola oración.
4. Respuesta total: máximo 2 oraciones en español.
Menciona siempre la pieza por su nombre completo además de la casilla (ejemplo: 'Mueve el peón a d5', 'Mueve el Caballo a f3').
`;

    try {
      // Usamos el cliente HTTP nativo o axios (como ya usas axios arriba, lo puedes usar, o fetch nativo de Node.js)
      const axios = require('axios');
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama3-8b-8192', // Modelo rápido y gratuito de Groq
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.5,
          max_tokens: 150
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data.choices[0].message.content.trim();
    } catch (error: any) { // 👈 Solo añadimos ": any" aquí
      console.error("Error conectando con Groq AI:", error?.response?.data || error?.message);
      return "💡 Recomiendo desarrollar piezas menores hacia el centro de las casillas d4/e4.";
    }
  }

  @SubscribeMessage('ask_coach')
  async handleAskCoach(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const game = this.activeGames.get(data.roomId);
    const userId = client.data.user?.sub || client.data.userId || client.handshake.auth?.userId;

    if (game && userId && game.players[userId]) {
      const myColor = game.players[userId];
      
      client.emit('coach_thinking'); 

      // 👇 Cambiamos askOllamaCoach por askGroqCoach
      const advice = await this.askGroqCoach(game.fen, myColor);
      
      game.coachAdvice[myColor] = advice;

      client.emit('coach_advice', { advice });
    }
  }

  @SubscribeMessage('join_room')
  handleJoinRoom(
    @MessageBody() data: { roomId: string; username: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId, username } = data;
    const userId = client.data.user?.sub || client.data.userId || client.handshake.auth?.userId;
    const room = this.server.sockets.adapter.rooms.get(roomId);
    const currentSize = room ? room.size : 0;

    // 0️⃣ PROTECCIÓN CONTRA REACT STRICT MODE
    if (client.rooms.has(roomId)) {
      this.emitPlayers(roomId);
      return { status: 'success' };
    }

    // 1️⃣ VERIFICAR SI LA PARTIDA YA EXISTE (RESINCRONIZACIÓN POR F5)
    const existingGame = this.activeGames.get(roomId);
    
    if (existingGame && userId && existingGame.players[userId]) {
      const myOldColor = existingGame.players[userId];
      
      client.data.roomId = roomId;
      client.data.username = username;
      client.data.color = myOldColor;
      client.join(roomId);

      // 👇 NUEVO: Calculamos el tiempo real restante en este milisegundo
      const now = Date.now();
      const elapsed = now - existingGame.time.lastMove;
      const currentTurn = existingGame.time.turn;
      
      const realTime = {
        w: currentTurn === 'w' ? existingGame.time.w - elapsed : existingGame.time.w,
        b: currentTurn === 'b' ? existingGame.time.b - elapsed : existingGame.time.b,
      };

      // 👇 Añadimos el 'time' al paquete de sincronización
      client.emit('sync_game', { 
        color: myOldColor, 
        fen: existingGame.fen,
        time: realTime,
        advice: existingGame.coachAdvice[myOldColor] // Recuperamos el último consejo
      });
      
      this.emitPlayers(roomId);
      return { status: 'success', roomId };
    }

    // 👇 1.5 REGLA ESTRICTA: Prohibido jugar contra uno mismo
    let isAlreadyInRoom = false;
    room?.forEach(socketId => {
      const s = this.server.sockets.sockets.get(socketId);
      const playerDbId = s?.data?.user?.sub || s?.data?.userId;
      if (playerDbId === userId) {
        isAlreadyInRoom = true;
      }
    });

    if (isAlreadyInRoom) {
      client.emit('room_error', { title: 'Acceso Denegado', message: 'No puedes jugar contra ti mismo en dos pestañas.' });
      return { status: 'error' };
    }

    // 2️⃣ FLUJO NORMAL (NUEVA PARTIDA)
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

    // 3️⃣ INICIAR PARTIDA EN LA MEMORIA
    if (currentSize + 1 === 2) {
      this.server.to(roomId).emit('game_started');
      this.server.to(roomId).emit('sys_message', { text: '¡La partida ha comenzado! Mueven las blancas.' });
      
      const playersInRoom: Record<string, 'w' | 'b'> = {};
      const updatedRoom = this.server.sockets.adapter.rooms.get(roomId);
      
      updatedRoom?.forEach(socketId => {
        const s = this.server.sockets.sockets.get(socketId);
        const playerDbId = s?.data?.user?.sub || s?.data?.userId;
        if (playerDbId && s) {
          playersInRoom[playerDbId] = s.data.color;
        }
      });

      // 👇 AÑADE ESTA LÍNEA QUE FALTABA
      const TEN_MINS = 600000; 

      this.activeGames.set(roomId, {
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        players: playersInRoom,
        time: {
          w: TEN_MINS,
          b: TEN_MINS,
          turn: 'w',
          lastMove: Date.now(),
          timeoutId: setTimeout(() => this.handleTimeOut(roomId, 'w'), TEN_MINS) // Arranca el reloj blanco
        },
        coachAdvice: { w: null, b: null }
      });
    }

    return { status: 'success', roomId };
  }

  @SubscribeMessage('request_lobby_update')
  handleRequestLobbyUpdate(@ConnectedSocket() client: Socket) {
    this.broadcastLobbyUpdate();
  }

  private broadcastLobbyUpdate() {
    const activeRooms: Record<string, number> = {};
    for (let i = 1; i <= 8; i++) {
      const roomName = `sala-${i}`;
      const room = this.server.sockets.adapter.rooms.get(roomName);
      activeRooms[roomName] = room ? room.size : 0;
    }
    
    // Enviamos también el contador y estado del torneo (ej: 'sala-torneo')
    activeRooms['sala-torneo'] = this.tournamentParticipants.length;

    this.server.emit('lobby_updated', {
      rooms: activeRooms,
      tournamentFull: this.tournamentParticipants.length >= 8,
      tournamentCount: this.tournamentParticipants.length
    });
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

  private handleTimeOut(roomId: string, loserColor: 'w' | 'b') {
    const game = this.activeGames.get(roomId);
    if (game) {
      const winnerColor = loserColor === 'w' ? 'b' : 'w';
      this.server.to(roomId).emit('time_out', { loserColor, winnerColor });
    }
  }

  @SubscribeMessage('make_move')
  handleMakeMove(
    @MessageBody() data: { roomId: string; from: string; to: string; promotion?: string; fen: string }, 
    @ConnectedSocket() client: Socket,
  ) {
    const game = this.activeGames.get(data.roomId);
    if (game) {
      game.fen = data.fen;

      // --- LÓGICA DE RELOJES ---
      const now = Date.now();
      const elapsed = now - game.time.lastMove;
      
      // Descontamos el tiempo usado por el jugador que acaba de mover
      game.time[game.time.turn] -= elapsed; 
      
      // Cancelamos la bomba de tiempo actual
      if (game.time.timeoutId) clearTimeout(game.time.timeoutId);
      
      // Cambiamos el turno al otro jugador
      game.time.turn = game.time.turn === 'w' ? 'b' : 'w';
      game.time.lastMove = now;
      
      // Activamos la bomba de tiempo para el siguiente jugador
      const timeLeft = game.time[game.time.turn];
      game.time.timeoutId = setTimeout(() => this.handleTimeOut(data.roomId, game.time.turn), timeLeft);
    }

    client.to(data.roomId).emit('move_received', {
      from: data.from,
      to: data.to,
      promotion: data.promotion || 'q',
      time: game ? { w: game.time.w, b: game.time.b } : null // Sincronizamos los relojes del rival
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
        this.activeGames.delete(data.roomId);
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

  // --- CONTROL DE SESIONES ÚNICAS (ANTIFRAUDE / ANTI-CLONES) ---
  /*@SubscribeMessage('register_session')
  handleRegisterSession(@ConnectedSocket() client: Socket) {
    const userId = client.data.user?.sub;
    if (!userId) return;

    const existingSocketId = this.activeSessions.get(userId);

    // Si el usuario ya está registrado, y su Socket ID es diferente al que intenta entrar... ¡Es un clon en otra pestaña!
    if (existingSocketId && existingSocketId !== client.id) {
      client.emit('session_rejected', { 
        message: 'ACCESO DENEGADO 🛑\n\nTu cuenta ya se encuentra activa en otra pestaña o navegador. Cierra esta ventana para evitar problemas de sincronización.' 
      });
      client.disconnect(); // Le cortamos el cable a la copia falsa
      return;
    }

    // Si es una conexión limpia, la registramos
    this.activeSessions.set(userId, client.id);
    client.data.userId = userId; // Lo guardamos en el cliente para uso futuro
  }*/
 
  // 🏆 1. REGISTRAR JUGADOR TRAS PAGO EXITOSO
  @SubscribeMessage('register_tournament_player')
  handleRegisterTournamentPlayer(
    @MessageBody() data: { username: string },
    @ConnectedSocket() client: Socket
  ) {
    const userId = client.data.user?.sub || client.data.userId || client.handshake.auth?.userId;
    if (!userId) return { status: 'error', message: 'Usuario no autenticado' };

    // Si ya son 8 y este usuario NO estaba inscrito, bloqueamos
    const isAlreadyRegistered = this.tournamentParticipants.some(p => p.userId === userId);
    if (!isAlreadyRegistered && this.tournamentParticipants.length >= 8) {
      return { status: 'error', message: 'El torneo ya ha alcanzado el límite máximo de 8 participantes.' };
    }

    if (!isAlreadyRegistered) {
      this.tournamentParticipants.push({ userId, username: data.username || 'Jugador' });
    }

    // Emitimos la lista actualizada a todos los sockets en el torneo y actualizamos el lobby
    this.server.emit('tournament_updated', {
      participants: this.tournamentParticipants,
      isFull: this.tournamentParticipants.length >= 8
    });
    this.broadcastLobbyUpdate();

    return { status: 'success', isRegistered: true };
  }

  // 🏆 CAPTURAR PAGO Y ENVIAR CORREO DESDE EL SOCKET
  // 🏆 CAPTURAR PAGO Y ENVIAR CORREO DESDE EL SOCKET
  // 🏆 CAPTURAR PAGO Y ENVIAR CORREO DESDE EL SOCKET
  @SubscribeMessage('capture_tournament_payment')
  async handleCaptureTournamentPayment(
    @MessageBody() data: { orderID: string; email: string; username: string },
    @ConnectedSocket() client: Socket
  ) {
    const userId = client.data.user?.sub || client.data.userId || client.handshake.auth?.userId;
    if (!userId) return { status: 'error', message: 'Usuario no autenticado' };

    try {
      // 👇 MAGIA ABSOLUTA: Buscamos el correo real directamente en la Base de Datos
      const user = await this.userRepository.findOne({ where: { id: userId } });
      const finalEmail = user?.email || data.email;

      const axios = require('axios');
      const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
      
      const tokenRes = await axios.post(
        `${process.env.PAYPAL_BASE_URL}/v1/oauth2/token`,
        'grant_type=client_credentials',
        { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      const captureRes = await axios.post(
        `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders/${data.orderID}/capture`,
        {},
        { headers: { Authorization: `Bearer ${tokenRes.data.access_token}`, 'Content-Type': 'application/json' } }
      );

      if (captureRes.data.status === 'COMPLETED') {
        const isAlreadyRegistered = this.tournamentParticipants.some(p => p.userId === userId);
        if (!isAlreadyRegistered) {
          try {
            // 👇 1. GUARDAMOS EN LA BASE DE DATOS PRIMERO
            const newParticipant = this.tournamentRepo.create({ userId, username: data.username });
            await this.tournamentRepo.save(newParticipant);

            // 👇 2. Actualizamos la memoria caché del servidor
            this.tournamentParticipants.push({ userId, username: data.username });
            
            // 👇 3. Avisamos al frontend
            this.server.emit('tournament_updated', {
              participants: this.tournamentParticipants,
              isFull: this.tournamentParticipants.length >= 8
            });
            this.broadcastLobbyUpdate();
          } catch (dbError) {
             console.error('[Torneo] Error guardando inscripción en MySQL:', dbError);
             return { status: 'error', message: 'Error interno guardando tu inscripción. Contacta soporte.' };
          }
        }
        
        // Disparo de correo (idéntico a lo que ya tienes)
        const amountPaid = captureRes.data.purchase_units[0]?.payments?.captures[0]?.amount?.value || "2.00";
        if (finalEmail && finalEmail !== 'sin-correo') {
           this.eventEmitter.emit('tournament.payment.approved', { email: finalEmail, orderId: data.orderID, amount: amountPaid });
        }
        return { status: 'success' };
      }
      return { status: 'error', message: 'El pago no se completó' };
    } catch (error) {
      console.error('Error capturando pago en socket:', error);
      return { status: 'error', message: 'Error en el servidor al capturar el pago' };
    }
  }

  // 🏆 2. CONSULTAR ESTADO DEL TORNEO
  @SubscribeMessage('get_tournament_state')
  handleGetTournamentState(@ConnectedSocket() client: Socket) {
    const userId = client.data.user?.sub || client.data.userId || client.handshake.auth?.userId;
    const isRegistered = this.tournamentParticipants.some(p => p.userId === userId);

    client.emit('tournament_state_response', {
      participants: this.tournamentParticipants,
      isFull: this.tournamentParticipants.length >= 8,
      isRegistered
    });
  }

  // 🏆 3. ABANDONAR EL TORNEO (Perdiendo el cupo)
  @SubscribeMessage('leave_tournament')
  async handleLeaveTournament(@ConnectedSocket() client: Socket) {
    const userId = client.data.user?.sub || client.data.userId || client.handshake.auth?.userId;
    if (userId) {
      try {
        // 👇 1. Eliminamos de la Base de Datos
        await this.tournamentRepo.delete({ userId });

        // 👇 2. Actualizamos la memoria rápida
        this.tournamentParticipants = this.tournamentParticipants.filter(p => p.userId !== userId);
        
        // 👇 3. Avisamos a los demás
        this.server.emit('tournament_updated', {
          participants: this.tournamentParticipants,
          isFull: this.tournamentParticipants.length >= 8
        });
        this.broadcastLobbyUpdate();
      } catch (error) {
        console.error('[Torneo] Error eliminando participante de la BD:', error);
      }
    }
  }

  // 🧹 LIBERAR CUPO SI EL USUARIO BORRA SU CUENTA
  @OnEvent('account.deleted')
  async handleAccountDeleted(deletedUserId: string) {
    try {
      // 1. Verificamos si este usuario estaba en la memoria del torneo
      const wasInTournament = this.tournamentParticipants.some(p => p.userId === deletedUserId);

      if (wasInTournament) {
        // 2. Lo borramos de la base de datos del torneo
        await this.tournamentRepo.delete({ userId: deletedUserId });

        // 3. Lo sacamos de la memoria caché
        this.tournamentParticipants = this.tournamentParticipants.filter(p => p.userId !== deletedUserId);

        // 4. Avisamos a todos los conectados que hay un cupo libre
        this.server.emit('tournament_updated', {
          participants: this.tournamentParticipants,
          isFull: this.tournamentParticipants.length >= 8
        });
        this.broadcastLobbyUpdate();
        
        console.log(`[Torneo] Cupo liberado. El usuario (ID: ${deletedUserId}) eliminó su cuenta.`);
      }
    } catch (error) {
      console.error('[Torneo] Error al intentar liberar cupo de cuenta eliminada:', error);
    }
  }
}