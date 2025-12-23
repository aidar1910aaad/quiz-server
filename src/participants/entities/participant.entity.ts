import { Entity, Column, PrimaryColumn, ManyToOne, OneToMany, BeforeInsert, Index, CreateDateColumn } from 'typeorm';
import { randomUUID } from 'crypto';
import { Quiz } from '../../quizzes/entities/quiz.entity';
import { Answer } from '../../answers/entities/answer.entity';

export enum Team {
  TEAM_1 = 1,
  TEAM_2 = 2,
}

@Entity('participants')
export class Participant {
  @PrimaryColumn('uuid')
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = randomUUID();
    }
  }

  @Column()
  name: string;

  @Column({
    type: 'int',
    enum: Team,
  })
  team: Team;

  @ManyToOne(() => Quiz, (quiz) => quiz.participants, { onDelete: 'CASCADE' })
  quiz: Quiz;

  @Column()
  @Index()
  quizId: string;

  @Column()
  @Index()
  pin: string; // PIN игры

  @OneToMany(() => Answer, (answer) => answer.participant)
  answers: Answer[];

  @CreateDateColumn()
  joinedAt: Date;
}

