// backend/src/auth/auth.service.ts
import { Injectable, ConflictException, UnauthorizedException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { User, UserStatus, AuthProvider } from '../users/entities/user.entity';
import { MailService } from '../mail/mail.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as qrcode from 'qrcode';

// 👇 Importación nativa de Node.js (Bypass directo a la librería)
import * as speakeasy from 'speakeasy';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private eventEmitter: EventEmitter2, // El servicio de colas de correo
  ) {}

  // =================================================================
  // 1. AUTENTICACIÓN POR GOOGLE (OAuth)
  // =================================================================
  async validateOAuthLogin(profile: any): Promise<User> {
    let user = await this.userRepository.findOne({ where: { googleId: profile.googleId } });

    if (!user) {
      // Como los campos por defecto de la BD ya marcan Provider=GOOGLE y Status=ACTIVE,
      // la creación se mantiene limpia.
      user = this.userRepository.create({
        googleId: profile.googleId,
        email: profile.email,
        nickname: profile.nickname,
        avatar: profile.avatar,
      });
      await this.userRepository.save(user);
    }

    return user;
  }

  // =================================================================
  // 2. GENERADOR DE TOKENS (Se usa para Google y, a futuro, Login Local)
  // =================================================================
  generateJwt(user: User): string {
    const payload = { sub: user.id, nickname: user.nickname, elo: user.elo }; 
    return this.jwtService.sign(payload);
  }

  // =================================================================
  // 3. REGISTRO DE USUARIO LOCAL (Genera OTP y lo deja INACTIVE)
  // =================================================================
  async registerLocalUser(email: string, nickname: string, passwordPlain: string) {
    // Validar que el correo o nickname no existan
    const existingUser = await this.userRepository.findOne({
      where: [{ email }, { nickname }],
    });

    if (existingUser) {
      throw new ConflictException('El correo o nickname ya están en uso.');
    }

    // Encriptar la contraseña
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(passwordPlain, salt);

    // Generar el código OTP de 6 dígitos matemático
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Configurar expiración a 15 minutos
    const otpExpiresAt = new Date();
    otpExpiresAt.setMinutes(otpExpiresAt.getMinutes() + 15);

    // Crear el usuario en la BD
    const newUser = this.userRepository.create({
      email,
      nickname,
      password: hashedPassword,
      provider: AuthProvider.LOCAL,
      status: UserStatus.INACTIVE, // NACE INACTIVO HASTA QUE PONGA EL CÓDIGO
      otpCode,
      otpExpiresAt,
    });

    await this.userRepository.save(newUser);

    // Encolar el correo asíncrono (Respuesta inmediata en memoria)
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; text-align: center; color: #333;">
        <h2>¡Bienvenido a BoardAI! ♟️</h2>
        <p>Tu código de seguridad para activar la cuenta es:</p>
        <h1 style="color: #00d2ff; letter-spacing: 5px;">${otpCode}</h1>
        <p><i>Este código expirará en 15 minutos.</i></p>
      </div>
    `;
    
    await this.mailService.queueEmail(email, 'Código de Activación - BoardAI', htmlBody);

    return { 
      message: 'Registro exitoso. Se ha encolado el envío del código OTP a tu correo.' 
    };
  }

  // =================================================================
  // 4. VERIFICACIÓN DEL CÓDIGO OTP
  // =================================================================
  async verifyOtp(email: string, otpCode: string) {
    const user = await this.userRepository.findOne({ where: { email } });

    // Regla de seguridad: Si no existe, damos error 401
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    // Si ya está activo, rechazamos la petición por ser redundante
    if (user.status === UserStatus.ACTIVE) {
      throw new BadRequestException('La cuenta ya se encuentra activa.');
    }

    // Si el código no coincide o ya caducó, arrojamos error 403 o 401
    if (user.otpCode !== otpCode) {
      throw new UnauthorizedException('El código OTP es incorrecto.');
    }

    if (user.otpExpiresAt && user.otpExpiresAt < new Date()) {
      throw new ForbiddenException('El código OTP ha expirado. Por favor, solicita uno nuevo.');
    }

    // ¡Éxito! Activamos la cuenta y limpiamos la basura
    user.status = UserStatus.ACTIVE;
    user.otpCode = null;
    user.otpExpiresAt = null;

    await this.userRepository.save(user);

    return { message: 'Cuenta verificada y activada correctamente.' };
  }



  // =================================================================
  // 5. INICIO DE SESIÓN LOCAL (Login)
  // =================================================================
  async loginLocal(email: string, passwordPlain: string) {
    const user = await this.userRepository.findOne({ where: { email } });

    if (!user || user.provider !== AuthProvider.LOCAL) {
      throw new UnauthorizedException('Credenciales inválidas o el usuario utiliza otro método de inicio de sesión.');
    }

    const isPasswordMatching = await bcrypt.compare(passwordPlain, user.password);
    if (!isPasswordMatching) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    if (user.status === UserStatus.INACTIVE) {
      throw new ForbiddenException('Tu cuenta está inactiva. Por favor, verifica tu correo con el código OTP.');
    }

    // 👈 NUEVA REGLA: Si tiene 2FA, detenemos el proceso y exigimos el código del celular
    if (user.isTwoFactorEnabled) {
      return { 
        requires2FA: true, 
        userId: user.id, // Le devolvemos el ID para que el frontend lo use en el siguiente paso
        message: 'Autenticación de dos factores requerida.' 
      };
    }

    const token = this.generateJwt(user);
    return { message: 'Inicio de sesión exitoso.', token };
  }

  // =================================================================
  // 6. SOLICITAR RECUPERACIÓN DE CONTRASEÑA
  // =================================================================
  async forgotPassword(email: string) {
    const user = await this.userRepository.findOne({ where: { email, provider: AuthProvider.LOCAL } });

    // Por seguridad, si el correo no existe, no arrojamos error, enviamos un mensaje genérico
    // Esto evita ataques de "enumeración de correos" (hackers adivinando quién está registrado)
    if (!user) {
      return { message: 'Si el correo existe, se ha enviado un enlace de recuperación.' };
    }

    // Generamos un token criptográfico de 32 bytes en formato hexadecimal
    const recoveryToken = crypto.randomBytes(32).toString('hex');
    
    // Expira en 1 hora
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    user.recoveryToken = recoveryToken;
    user.recoveryTokenExpiresAt = expiresAt;
    await this.userRepository.save(user);

    // Encolamos el correo con el link que apuntará a tu frontend
    //const resetLink = `${frontendUrl}/reset-password?token=${recoveryToken}`;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetLink = `${frontendUrl}/?token=${recoveryToken}`;

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; text-align: center; color: #333;">
        <h2>Recuperación de Acceso a Nexus Board</h2>
        <p>Has solicitado restablecer tu contraseña. Haz clic en el botón de abajo:</p>
        <a href="${resetLink}" style="display: inline-block; padding: 10px 20px; background-color: #00d2ff; color: #000; text-decoration: none; font-weight: bold; border-radius: 5px; margin: 20px 0;">Restablecer Contraseña</a>
        <p><i>Este enlace es de un solo uso y expirará en 1 hora.</i></p>
      </div>
    `;

    await this.mailService.queueEmail(email, 'Recuperación de Contraseña - Nexus Board', htmlBody);

    return { message: 'Si el correo existe, se ha enviado un enlace de recuperación.' };
  }

  // =================================================================
  // 7. APLICAR NUEVA CONTRASEÑA
  // =================================================================
  async resetPassword(token: string, newPasswordPlain: string) {
    const user = await this.userRepository.findOne({ where: { recoveryToken: token } });

    if (!user) {
      throw new UnauthorizedException('El token de recuperación es inválido.');
    }

    if (user.recoveryTokenExpiresAt && user.recoveryTokenExpiresAt < new Date()) {
      throw new ForbiddenException('El token de recuperación ha expirado.');
    }

    // Encriptamos la nueva contraseña
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPasswordPlain, salt);

    // Limpiamos los tokens de recuperación por seguridad
    user.recoveryToken = null;
    user.recoveryTokenExpiresAt = null;

    await this.userRepository.save(user);

    return { message: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.' };
  }




  // =================================================================
  // 8. GENERAR SECRETO Y CÓDIGO QR PARA GOOGLE AUTHENTICATOR
  // =================================================================
  async generateTwoFactorSecret(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Usuario no encontrado.');

    // Speakeasy genera el secreto y la URI matemática de un solo golpe
    const secretData = speakeasy.generateSecret({ 
      name: user.email, // El correo que se mostrará en la app
      issuer: 'BoardAI' // Esto es lo que verá el usuario en su app de Google
    });
    
    // Usamos base32 porque es el estándar que lee Google Authenticator
    const secret = secretData.base32; 
    const otpauthUrl = secretData.otpauth_url;

    // Guardamos el secreto en la base de datos temporalmente
    user.twoFactorSecret = secret;
    await this.userRepository.save(user);

    // Convertimos la URI en una imagen QR (Data URL)
    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

    return { secret, qrCodeDataUrl };
  }

  // =================================================================
  // 9. ACTIVAR EL 2FA (Requiere el primer código para confirmar)
  // =================================================================
  async turnOnTwoFactorAuthentication(userId: string, token: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || !user.twoFactorSecret) throw new UnauthorizedException('Usuario inválido.');

    // Validamos el código contra el secreto guardado usando la matemática de Speakeasy
    const isCodeValid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: token,
    });

    if (!isCodeValid) {
      throw new UnauthorizedException('El código de autenticación es incorrecto.');
    }

    user.isTwoFactorEnabled = true;
    await this.userRepository.save(user);

    return { message: 'Autenticación de dos factores activada con éxito.' };
  }

  // =================================================================
  // 10. INICIAR SESIÓN CON EL CÓDIGO 2FA
  // =================================================================
  async loginWith2fa(userId: string, token: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    
    if (!user || !user.isTwoFactorEnabled) {
      throw new UnauthorizedException('El usuario no tiene el 2FA activado.');
    }

    const isCodeValid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: token,
    });

    if (!isCodeValid) {
      throw new UnauthorizedException('El código 2FA es incorrecto o ha expirado.');
    }

    // ¡Prueba superada! Entregamos el Token JWT definitivo
    const jwtToken = this.generateJwt(user);
    return { message: 'Inicio de sesión exitoso.', token: jwtToken };
  }

  // =================================================================
  // 11. ELIMINAR CUENTA (Para pruebas del ciclo de vida)
  // =================================================================
  async deleteAccount(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    
    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado.');
    }

    // El método remove de TypeORM elimina la entidad de la tabla
    await this.userRepository.remove(user);
    this.eventEmitter.emit('account.deleted', userId);

    return { message: 'Cuenta eliminada permanentemente del sistema.' };
  }
}