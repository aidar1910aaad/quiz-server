import { Entity, Column, PrimaryColumn, ManyToOne, BeforeInsert } from 'typeorm';
import { randomUUID } from 'crypto';
import { Question } from '../../questions/entities/question.entity';

@Entity('answer_options')
export class AnswerOption {
  @PrimaryColumn('uuid')
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = randomUUID();
    }
  }

  @Column('text')
  text: string;

  @Column({ type: 'int' })
  order: number; // Порядок варианта (1, 2, 3, 4)

  @ManyToOne(() => Question, (question) => question.options, { onDelete: 'CASCADE' })
  question: Question;

  @Column()
  questionId: string;
}



