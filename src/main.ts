import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true, // Importante si usas cookies o tokens en headers específicos
  });
  
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();