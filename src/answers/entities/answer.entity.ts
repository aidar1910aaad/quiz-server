import { Entity, Column, PrimaryColumn, ManyToOne, BeforeInsert, Index, CreateDateColumn } from 'typeorm';
import { randomUUID } from 'crypto';
import { Participant } from '../../participants/entities/participant.entity';
import { Question } from '../../questions/entities/question.entity';
import { AnswerOption } from '../../answer-options/entities/answer-option.entity';

@Entity('answers')
export class Answer {
  @PrimaryColumn('uuid')
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = randomUUID();
    }
  }

  @ManyToOne(() => Participant, (participant) => participant.answers, { onDelete: 'CASCADE' })
  participant: Participant;

  @Column()
  @Index()
  participantId: string;

  @ManyToOne(() => Question, (question) => question.answers, { onDelete: 'CASCADE' })
  question: Question;

  @Column()
  @Index()
  questionId: string;

  @ManyToOne(() => AnswerOption)
  selectedOption: AnswerOption;

  @Column()
  selectedOptionId: string;

  @Column({ type: 'boolean', default: false })
  isCorrect: boolean;

  @Column({ type: 'int', nullable: true })
  responseTimeMs: number; // Время ответа в миллисекундах

  @CreateDateColumn()
  answeredAt: Date;
}

