import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { GameGateway } from './game.gateway';
import { MatchesModule } from '../matches/matches.module'; 
import { UsersModule } from '../users/users.module';

@Module({
  imports: [JwtModule, MatchesModule, UsersModule], 
  providers: [GameGateway],
})
export class GameModule {}