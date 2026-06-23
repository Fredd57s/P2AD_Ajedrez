// backend/src/matches/matches.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Match } from './entities/match.entity';
import { MatchesService } from './matches.service';

@Module({
  imports: [TypeOrmModule.forFeature([Match])],
  providers: [MatchesService],
  exports: [MatchesService],
})
export class MatchesModule {}