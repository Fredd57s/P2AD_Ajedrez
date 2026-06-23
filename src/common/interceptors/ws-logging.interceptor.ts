// backend/src/common/interceptors/ws-logging.interceptor.ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Socket } from 'socket.io';

@Injectable()
export class WsLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('WebSocketTraffic');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const wsContext = context.switchToWs();
    const client = wsContext.getClient<Socket>();
    const pattern = wsContext.getPattern(); 
    const data = wsContext.getData();
    
    const startTime = Date.now();

    this.logger.log(`[ RECIBIDO] Evento: '${pattern}' | Cliente: ${client.id} | Datos: ${JSON.stringify(data)}`);

    return next.handle().pipe(
      tap(() => {
        const executionTime = Date.now() - startTime;
        this.logger.log(`[ COMPLETADO] Evento: '${pattern}' | Tiempo: ${executionTime}ms`);
      }),
    );
  }
}