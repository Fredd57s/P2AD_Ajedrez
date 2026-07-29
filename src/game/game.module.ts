import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm'; // 
import { GameGateway } from './game.gateway';
import { MatchesModule } from '../matches/matches.module'; 
import { UsersModule } from '../users/users.module';

import { User } from '../users/entities/user.entity'; 
import { TournamentParticipant } from './entities/tournament-participant.entity'; 

@Module({
  imports: [
    JwtModule, 
    MatchesModule, 
    UsersModule,
    TypeOrmModule.forFeature([User, TournamentParticipant]) 
  ], 
  providers: [GameGateway],
})
export class GameModule {}