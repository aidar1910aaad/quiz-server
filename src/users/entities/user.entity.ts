import { Entity, Column, PrimaryColumn, CreateDateColumn, BeforeInsert, Index, OneToMany } from 'typeorm';
import { randomUUID } from 'crypto';
import { Quiz } from '../../quizzes/entities/quiz.entity';

@Entity('users')
export class User {
  @PrimaryColumn('uuid')
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = randomUUID();
    }
  }

  @Column({ unique: true })
  @Index() // Явный индекс для ускорения поиска по email
  email: string;

  @Column()
  fullName: string;

  @Column()
  password: string;

  @OneToMany(() => Quiz, (quiz) => quiz.creator)
  quizzes: Quiz[];

  @CreateDateColumn()
  createdAt: Date;
}

