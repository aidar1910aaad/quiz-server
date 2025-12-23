import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuizzesService } from './quizzes.service';
import { TeacherQuizController } from './controllers/teacher-quiz.controller';
import { StudentQuizController } from './controllers/student-quiz.controller';
import { QuizGateway } from './gateways/quiz.gateway';
import { TugOfWarService } from './services/tug-of-war.service';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entities/user.entity';
import { Quiz } from './entities/quiz.entity';
import { Question } from '../questions/entities/question.entity';
import { AnswerOption } from '../answer-options/entities/answer-option.entity';
import { Participant } from '../participants/entities/participant.entity';
import { Answer } from '../answers/entities/answer.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Quiz, Question, AnswerOption, Participant, Answer]),
    AuthModule,
  ],
  controllers: [TeacherQuizController, StudentQuizController],
  providers: [QuizzesService, QuizGateway, TugOfWarService],
  exports: [QuizzesService],
})
export class QuizzesModule {}

