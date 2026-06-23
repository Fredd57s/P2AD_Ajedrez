// backend/src/matches/matches.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Match } from './entities/match.entity';

@Injectable()
export class MatchesService {
  private readonly logger = new Logger('EloTransaction');

  constructor(private readonly dataSource: DataSource) {}

  async recordMatchResult(winnerId: string, loserId: string, isDraw: boolean = false) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const winner = await queryRunner.manager.findOne(User, {
        where: { id: winnerId },
        lock: { mode: 'pessimistic_write' },
      });
      const loser = await queryRunner.manager.findOne(User, {
        where: { id: loserId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!winner || !loser) {
        throw new Error('Uno de los jugadores no existe en la base de datos');
      }

      // 3. MATEMÁTICAS: CÁLCULO DE ELO
      const K = 32;
      let pointsExchanged = 0;

      const expectedWinner = 1 / (1 + Math.pow(10, (loser.elo - winner.elo) / 400));
      const expectedLoser = 1 / (1 + Math.pow(10, (winner.elo - loser.elo) / 400));

      if (isDraw) {
        const changeWinner = Math.round(K * (0.5 - expectedWinner));
        const changeLoser = Math.round(K * (0.5 - expectedLoser));
        winner.elo = Math.max(100, winner.elo + changeWinner);
        loser.elo = Math.max(100, loser.elo + changeLoser);
      } else {
        pointsExchanged = Math.round(K * (1 - expectedWinner));
        winner.elo += pointsExchanged;
        loser.elo = Math.max(100, loser.elo - pointsExchanged);
      }

      await queryRunner.manager.save(winner);
      await queryRunner.manager.save(loser);

      const matchRecord = queryRunner.manager.create(Match, {
        winner,
        loser,
        pointsExchanged,
        isDraw,
      });
      await queryRunner.manager.save(matchRecord);

      await queryRunner.commitTransaction();
      this.logger.log(`Transacción exitosa. ${winner.nickname} (+${pointsExchanged}) vs ${loser.nickname} (-${pointsExchanged})`);

      return { success: true, pointsExchanged };

    } catch (error) {
      this.logger.error('Error en la transacción Elo. Deshaciendo cambios...', error);
      await queryRunner.rollbackTransaction();
      throw error;
      
    } finally {
      await queryRunner.release();
    }
  }
}