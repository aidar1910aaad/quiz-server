import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { QuizzesService } from '../quizzes.service';
import { JoinQuizDto } from '../dto/join-quiz.dto';
import { SubmitAnswerDto } from '../dto/submit-answer.dto';
import { QuizGateway } from '../gateways/quiz.gateway';
import { ParticipantResponseDto } from '../dto/participant-response.dto';

@ApiTags('Student - Quizzes')
@Controller('student/quizzes')
export class StudentQuizController {
  constructor(
    private readonly quizzesService: QuizzesService,
    private readonly quizGateway: QuizGateway,
  ) {}

  @Get('pin/:pin')
  @ApiOperation({
    summary: 'Получить информацию о тесте по PIN',
    description: `Получает информацию о тесте по PIN-коду. Используйте перед присоединением к игре, чтобы увидеть вопросы и варианты ответов.
    
**Использование:**
1. Учитель создает тест и получает PIN
2. Ученик вводит PIN и получает информацию о тесте
3. Ученик присоединяется через POST /student/quizzes/pin/:pin/join`,
  })
  @ApiParam({ name: 'pin', description: '6-значный PIN-код игры', example: '123456' })
  @ApiResponse({
    status: 200,
    description: 'Информация о тесте',
    schema: {
      example: {
        id: 'uuid',
        title: 'Математика для 5 класса',
        pin: '123456',
        status: 'created',
        questions: [
          {
            id: 'uuid',
            text: 'Сколько будет 2+2?',
            timeSeconds: 30,
            order: 1,
            options: [
              { id: 'uuid', text: '3', order: 1 },
              { id: 'uuid', text: '4', order: 2 },
              { id: 'uuid', text: '5', order: 3 },
              { id: 'uuid', text: '6', order: 4 },
            ],
          },
        ],
        createdAt: '2025-12-16T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Тест с таким PIN не найден' })
  async getQuizByPin(@Param('pin') pin: string) {
    return this.quizzesService.getQuizByPin(pin);
  }

  @Post('pin/:pin/join')
  @ApiOperation({
    summary: 'Присоединиться к игре',
    description: `Присоединяет ученика к игре. После успешного присоединения вы получите participantId, который нужен для отправки ответов.
    
**Важно:**
- team: 1 или 2 (выбор команды)
- name: имя участника (должно быть уникальным в рамках одной игры)
- После присоединения автоматически отправляются Socket события: participant-joined и participants-update
- После присоединения подключитесь к WebSocket (namespace: /quiz) и отправьте событие 'join-quiz'`,
  })
  @ApiParam({ name: 'pin', description: '6-значный PIN-код игры', example: '123456' })
  @ApiResponse({
    status: 201,
    description: 'Успешно присоединились к игре',
    type: ParticipantResponseDto,
    schema: {
      example: {
        participantId: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
        quizId: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
        name: 'Иван Иванов',
        team: 1,
        pin: '123456',
        joinedAt: '2025-12-16T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Тест с таким PIN не найден' })
  @ApiResponse({ status: 400, description: 'Игра уже завершена или участник с таким именем уже присоединился' })
  async joinQuiz(@Param('pin') pin: string, @Body() joinDto: JoinQuizDto) {
    const participant = await this.quizzesService.joinQuiz(pin, joinDto);
    
    // Отправляем Socket события
    this.quizGateway.emitParticipantJoined(pin, participant);
    await this.quizGateway.emitParticipantsUpdate(pin);
    
    return participant;
  }

  @Post('pin/:pin/questions/:questionId/answer')
  @ApiOperation({
    summary: 'Отправить ответ на вопрос',
    description: `Отправляет ответ ученика на вопрос. Позиция каната обновляется автоматически после каждого ответа.
    
**Важно:**
- participantId: получите при присоединении к игре (POST /student/quizzes/pin/:pin/join)
- selectedOptionId: ID выбранного варианта ответа (из вопроса)
- responseTimeMs: время ответа в миллисекундах (от начала вопроса до отправки)
- Можно ответить только один раз на каждый вопрос
- Игра должна быть запущена (status: 'started')
- После отправки автоматически отправляется Socket событие tug-position-update всем участникам
    
**Альтернатива:** Используйте WebSocket событие 'submit-answer' для отправки ответов в реальном времени`,
  })
  @ApiParam({ name: 'pin', description: '6-значный PIN-код игры', example: '123456' })
  @ApiParam({ name: 'questionId', description: 'ID вопроса (получите из GET /student/quizzes/pin/:pin)', example: 'uuid' })
  @ApiResponse({
    status: 201,
    description: 'Ответ успешно отправлен',
    schema: {
      example: {
        id: 'uuid',
        participantId: 'uuid',
        questionId: 'uuid',
        selectedOptionId: 'uuid',
        isCorrect: true,
        responseTimeMs: 5000,
        answeredAt: '2025-12-16T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Вопрос, участник или тест не найден' })
  @ApiResponse({ status: 400, description: 'Игра не запущена, вы уже ответили на этот вопрос, или выбранный вариант не найден' })
  async submitAnswer(
    @Param('pin') pin: string,
    @Param('questionId') questionId: string,
    @Body() submitAnswerDto: SubmitAnswerDto,
  ) {
    // 1. Сохраняем ответ в БД
    const answer = await this.quizzesService.submitAnswer(
      pin,
      questionId,
      submitAnswerDto.participantId,
      submitAnswerDto,
    );
    
    // 2. Отправляем answer-confirmed через WebSocket всем в комнате
    // Фронтенд будет фильтровать по participantId, чтобы показать только своему участнику
    const roomName = `quiz-${pin}`;
    this.quizGateway.server.to(roomName).emit('answer-confirmed', {
      participantId: submitAnswerDto.participantId,
      questionId,
      isCorrect: answer.isCorrect,
      responseTimeMs: answer.responseTimeMs,
    });
    
    // 3. Отправляем обновление позиции каната всем участникам в комнате
    await this.quizGateway.emitTugPositionUpdate(pin);
    
    // 4. Если игра автоматически завершилась, отправляем game-update
    if (answer.gameFinished) {
      const quiz = await this.quizzesService.getQuizByPin(pin);
      this.quizGateway.emitGameUpdate(pin, quiz.id, quiz.status);
    }
    
    return answer;
  }

  @Get('pin/:pin/participants/:participantId/results')
  @ApiOperation({
    summary: 'Получить статистику ученика',
    description: `Получает детальную статистику конкретного ученика после завершения игры.
    
**Доступно только после завершения игры (status: 'finished')**

**Включает:**
- Количество правильных ответов и точность
- Среднее время ответа
- Баллы участника и вклад в команду
- Статистику команды
- Детали всех ответов
- Финальную позицию каната и победителя`,
  })
  @ApiParam({ name: 'pin', description: '6-значный PIN-код игры', example: '123456' })
  @ApiParam({ name: 'participantId', description: 'ID участника', example: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Статистика ученика',
    schema: {
      example: {
        participant: {
          id: 'uuid',
          name: 'Иван Иванов',
          team: 1,
        },
        quiz: {
          id: 'uuid',
          title: 'Математика для 5 класса',
          pin: '123456',
          status: 'finished',
        },
        stats: {
          correctAnswers: 4,
          totalAnswers: 5,
          accuracy: 80,
          averageResponseTime: 5000,
          participantScore: 200,
          contribution: 50,
        },
        teamStats: {
          team: 1,
          teamScore: 400,
          teamCorrectAnswers: 8,
          teamTotalAnswers: 10,
        },
        answers: [
          {
            questionId: 'uuid',
            questionText: 'Сколько будет 2+2?',
            selectedOptionText: '4',
            isCorrect: true,
            responseTimeMs: 5000,
            answeredAt: '2025-12-16T12:00:00.000Z',
          },
        ],
        finalPosition: 25.5,
        winner: 1,
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Участник не найден' })
  @ApiResponse({ status: 400, description: 'Игра еще не завершена' })
  async getStudentResults(
    @Param('pin') pin: string,
    @Param('participantId') participantId: string,
  ) {
    return this.quizzesService.getStudentResults(pin, participantId);
  }
}

