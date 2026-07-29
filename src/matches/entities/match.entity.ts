// backend/src/matches/entities/match.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('matches')
export class Match {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 👇 Añadimos onDelete: 'SET NULL' y nullable: true
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  winner: User;

  // 👇 Añadimos onDelete: 'SET NULL' y nullable: true
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  loser: User;

  @Column()
  pointsExchanged: number; 

  @Column({ default: false })
  isDraw: boolean; 

  @CreateDateColumn()
  playedAt: Date;
}