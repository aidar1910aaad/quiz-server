import { Entity, Column, PrimaryColumn, ManyToOne, OneToMany, BeforeInsert } from 'typeorm';
import { randomUUID } from 'crypto';
import { Quiz } from '../../quizzes/entities/quiz.entity';
import { AnswerOption } from '../../answer-options/entities/answer-option.entity';
import { Answer } from '../../answers/entities/answer.entity';

@Entity('questions')
export class Question {
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
  timeSeconds: number;

  @Column('uuid', { nullable: true })
  correctAnswerId: string | null; // ID правильного варианта ответа

  @ManyToOne(() => Quiz, (quiz) => quiz.questions, { onDelete: 'CASCADE' })
  quiz: Quiz;

  @Column()
  quizId: string;

  @OneToMany(() => AnswerOption, (option) => option.question, { cascade: true })
  options: AnswerOption[];

  @OneToMany(() => Answer, (answer) => answer.question)
  answers: Answer[];

  @Column({ type: 'int', default: 0 })
  order: number; // Порядок вопроса в тесте
}

