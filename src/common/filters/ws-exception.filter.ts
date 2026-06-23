// backend/src/common/filters/ws-exception.filter.ts
import { Catch, ArgumentsHost, Logger } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Catch() 
export class GlobalWsExceptionFilter extends BaseWsExceptionFilter {
  private readonly logger = new Logger('WebSocketError');

  catch(exception: unknown, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();
    const pattern = host.switchToWs().getPattern();

    let errorMessage = 'Error interno del servidor';

    if (exception instanceof WsException) {
      errorMessage = exception.message;
    } else if (exception instanceof Error) {
      errorMessage = exception.message;
    }

    this.logger.error(
      `[ ERROR en '${pattern}'] Cliente: ${client.id} | Detalle: ${errorMessage}`,
      exception instanceof Error ? exception.stack : '',
    );

    client.emit('room_error', {
      title: 'Error de Procesamiento',
      message: errorMessage,
    });
  }
}