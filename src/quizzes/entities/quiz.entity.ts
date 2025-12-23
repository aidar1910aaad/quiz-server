import { Entity, Column, PrimaryColumn, CreateDateColumn, ManyToOne, OneToMany, BeforeInsert, Index } from 'typeorm';
import { randomUUID } from 'crypto';
import { User } from '../../users/entities/user.entity';
import { Question } from '../../questions/entities/question.entity';
import { Participant } from '../../participants/entities/participant.entity';

export enum QuizStatus {
  CREATED = 'created',
  STARTED = 'started',
  FINISHED = 'finished',
}

@Entity('quizzes')
export class Quiz {
  @PrimaryColumn('uuid')
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = randomUUID();
    }
  }

  @Column()
  title: string;

  @Column({ unique: true, length: 6 })
  @Index()
  pin: string;

  @Column({
    type: 'enum',
    enum: QuizStatus,
    default: QuizStatus.CREATED,
  })
  status: QuizStatus;

  @ManyToOne(() => User, (user) => user.quizzes)
  creator: User;

  @Column()
  creatorId: string;

  @OneToMany(() => Question, (question) => question.quiz, { cascade: true })
  questions: Question[];

  @OneToMany(() => Participant, (participant) => participant.quiz, { cascade: true })
  participants: Participant[];

  @CreateDateColumn()
  createdAt: Date;
}



