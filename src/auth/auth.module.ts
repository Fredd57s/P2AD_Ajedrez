// backend/src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { GoogleStrategy } from './google.strategy';
import { AuthService } from './auth.service';
import { UsersModule } from '../users/users.module'; 
import { MailModule } from '../mail/mail.module';
import { PaymentService } from './payment.service'; 
import { PaymentController } from './payment.controller';

@Module({
  imports: [
    UsersModule, 
    PassportModule,
    MailModule,
    // 👇 Aquí solo van Módulos, quitamos Controller y Service de aquí
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' }, // El token durará 7 días
      }),
    }),
  ],
  controllers: [
    AuthController,
    PaymentController // 👈 El controlador va estrictamente aquí
  ],
  providers: [
    GoogleStrategy, 
    AuthService,
    PaymentService // 👈 El servicio va estrictamente aquí
  ],
})
export class AuthModule {}