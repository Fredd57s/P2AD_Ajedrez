import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('tournament_participants')
export class TournamentParticipant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Hacemos que sea única para que nadie pueda registrarse dos veces
  @Column({ unique: true })
  userId: string;

  @Column()
  username: string;

  @CreateDateColumn()
  registeredAt: Date;
}