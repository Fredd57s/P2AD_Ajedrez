import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// Definimos los estados posibles del usuario
export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

// Definimos el origen del registro para saber la vía de autenticación
export enum AuthProvider {
  LOCAL = 'LOCAL',
  GOOGLE = 'GOOGLE',
}

@Entity('users') 
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 👈 MODIFICADO: Debe ser nullable para permitir registros locales sin Google
  @Column({ unique: true, nullable: true })
  googleId: string;

  @Column({ unique: true })
  email: string;

  @Column()
  nickname: string;

  @Column({ nullable: true })
  avatar: string;

  @Column({ default: 1200 })
  elo: number;

  // =========================================================
  // --- NUEVOS CAMPOS PARA AUTENTICACIÓN Y SEGURIDAD ---
  // =========================================================

  @Column({ type: 'enum', enum: AuthProvider, default: AuthProvider.GOOGLE })
  provider: AuthProvider;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  // La contraseña es opcional porque los usuarios de Google no la requieren
  @Column({ nullable: true })
  password?: string;

  // --- CAMPOS PARA VERIFICACIÓN OTP (Registro) ---
  @Column({ nullable: true })
  otpCode?: string;

  @Column({ type: 'timestamp', nullable: true })
  otpExpiresAt?: Date;

  // --- CAMPOS PARA RECUPERACIÓN DE CUENTA (Olvidé mi contraseña) ---
  @Column({ nullable: true })
  recoveryToken?: string;

  @Column({ type: 'timestamp', nullable: true })
  recoveryTokenExpiresAt?: Date;

  // --- CAMPOS PARA 2FA (Google Authenticator) ---
  @Column({ nullable: true })
  twoFactorSecret?: string;

  @Column({ default: false })
  isTwoFactorEnabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}