// backend/src/matches/entities/match.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('matches')
export class Match {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  winner: User;

  @ManyToOne(() => User)
  loser: User;

  @Column()
  pointsExchanged: number; 

  @Column({ default: false })
  isDraw: boolean; 

  @CreateDateColumn()
  playedAt: Date;
}