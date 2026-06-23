// backend/src/auth/auth.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { User } from '../users/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  // 1. Buscar si el usuario existe, si no, lo crea en la base de datos
  async validateOAuthLogin(profile: any): Promise<User> {
    let user = await this.userRepository.findOne({ where: { googleId: profile.googleId } });

    if (!user) {
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

  // 2. Genera el Token JWT con el ID del usuario
  generateJwt(user: User): string {
    const payload = { sub: user.id, nickname: user.nickname, elo: user.elo }; 
    return this.jwtService.sign(payload);
  }
}