import { Controller, Post, Get, Delete, Body, Param, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiHeader, ApiSecurity } from '@nestjs/swagger';
import { QuizzesService } from '../quizzes.service';
import { CreateQuizDto } from '../dto/create-quiz.dto';
import { SimpleAuthGuard } from '../../auth/guards/simple-auth.guard';
import { QuizGateway } from '../gateways/quiz.gateway';

@ApiTags('Teacher - Quizzes')
@UseGuards(SimpleAuthGuard)
@ApiSecurity('X-User-Id')
@Controller('teacher/quizzes')
export class TeacherQuizController {
  constructor(
    private readonly quizzesService: QuizzesService,
    private readonly quizGateway: QuizGateway,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Создать новый тест',
    description: `Создает новый тест с вопросами и вариантами ответов. Автоматически генерируется уникальный 6-значный PIN-код.
    
**Важно:**
- Минимум 1 вопрос
- Каждый вопрос должен иметь ровно 4 варианта ответа
- correctAnswerOrder - порядковый номер правильного варианта (1, 2, 3 или 4)
- timeSeconds - время на ответ в секундах`,
  })
  @ApiResponse({
    status: 201,
    description: 'Тест успешно создан',
    schema: {
      example: {
        id: 'uuid',
        title: 'Математика для 5 класса',
        pin: '123456',
        status: 'created',
        creatorId: 'uuid',
        questions: [
          {
            id: 'uuid',
            text: 'Сколько будет 2+2?',
            timeSeconds: 30,
            correctAnswerId: 'uuid',
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
  @ApiResponse({ status: 400, description: 'Ошибка валидации данных' })
  async createQuiz(@Body() createQuizDto: CreateQuizDto, @Req() req: any) {
    return this.quizzesService.createQuiz(createQuizDto, req.user.id);
  }

  @Get()
  @ApiOperation({
    summary: 'Получить все мои тесты',
    description: `Получает список всех тестов, созданных текущим учителем. Тесты отсортированы по дате создания (новые первыми).`,
  })
  @ApiResponse({
    status: 200,
    description: 'Список тестов',
    schema: {
      example: [
        {
          id: 'uuid',
          title: 'Математика для 5 класса',
          pin: '123456',
          status: 'finished',
          creatorId: 'uuid',
          createdAt: '2025-12-16T12:00:00.000Z',
          questions: [
            {
              id: 'uuid',
              text: 'Сколько будет 2+2?',
              timeSeconds: 30,
              order: 1,
            },
          ],
        },
      ],
    },
  })
  async getMyQuizzes(@Req() req: any) {
    return this.quizzesService.getMyQuizzes(req.user.id);
  }

  @Get(':quizId')
  @ApiOperation({
    summary: 'Получить тест по ID',
    description: `Получает детальную информацию о конкретном тесте по его ID. Включает все вопросы, варианты ответов и список участников.`,
  })
  @ApiParam({ name: 'quizId', description: 'ID теста', example: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Информация о тесте',
    schema: {
      example: {
        id: 'uuid',
        title: 'Математика для 5 класса',
        pin: '123456',
        status: 'created',
        creatorId: 'uuid',
        createdAt: '2025-12-16T12:00:00.000Z',
        questions: [
          {
            id: 'uuid',
            text: 'Сколько будет 2+2?',
            timeSeconds: 30,
            order: 1,
            options: [
              { id: 'uuid', text: '3', order: 1 },
              { id: 'uuid', text: '4', order: 2, isCorrect: true },
              { id: 'uuid', text: '5', order: 3 },
              { id: 'uuid', text: '6', order: 4 },
            ],
          },
        ],
        participants: [
          {
            id: 'uuid',
            name: 'Иван Иванов',
            team: 1,
            joinedAt: '2025-12-16T12:00:00.000Z',
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Тест не найден' })
  @ApiResponse({ status: 403, description: 'Вы не являетесь создателем этого теста' })
  async getQuizById(@Param('quizId') quizId: string, @Req() req: any) {
    return this.quizzesService.getQuizById(quizId, req.user.id);
  }

  @Delete(':quizId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Удалить тест',
    description: `Удаляет тест и все связанные данные (вопросы, варианты ответов, участников, ответы).
    
**Важно:**
- Нельзя удалить запущенную игру (status: 'started'). Сначала завершите игру через POST /teacher/quizzes/:quizId/finish
- Удаление необратимо - все данные будут удалены из базы данных
- После удаления можно создать новый тест с таким же названием`,
  })
  @ApiParam({ name: 'quizId', description: 'ID теста для удаления', example: 'uuid' })
  @ApiResponse({
    status: 204,
    description: 'Тест успешно удален',
  })
  @ApiResponse({ status: 404, description: 'Тест не найден' })
  @ApiResponse({ status: 403, description: 'Вы не являетесь создателем этого теста' })
  @ApiResponse({ status: 400, description: 'Нельзя удалить запущенную игру. Сначала завершите игру' })
  async deleteQuiz(@Param('quizId') quizId: string, @Req() req: any) {
    await this.quizzesService.deleteQuiz(quizId, req.user.id);
  }

  @Post(':quizId/start')
  @ApiOperation({
    summary: 'Запустить игру',
    description: `Запускает игру. После этого участники смогут отвечать на вопросы.
    
**Последовательность:**
1. Убедитесь, что участники присоединились (GET /teacher/quizzes/pin/:pin/participants)
2. Запустите игру через этот эндпоинт (автоматически отправляется Socket событие game-update)
3. Используйте WebSocket событие 'start-question' для запуска каждого вопроса
4. Позиция каната будет обновляться автоматически при каждом ответе`,
  })
  @ApiParam({ name: 'quizId', description: 'ID теста (получите при создании)', example: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Игра запущена',
    schema: {
      example: {
        id: 'uuid',
        title: 'Математика для 5 класса',
        pin: '123456',
        status: 'started',
        creatorId: 'uuid',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Тест не найден' })
  @ApiResponse({ status: 403, description: 'Вы не являетесь создателем этого теста' })
  @ApiResponse({ status: 400, description: 'Игра уже запущена или завершена' })
  async startQuiz(@Param('quizId') quizId: string, @Req() req: any) {
    const quiz = await this.quizzesService.startQuiz(quizId, req.user.id);
    
    // Отправляем game-update событие всем участникам
    this.quizGateway.emitGameUpdate(quiz.pin, quiz.id, quiz.status, 0);
    
    return quiz;
  }

  @Post(':quizId/finish')
  @ApiOperation({
    summary: 'Завершить игру',
    description: `Завершает игру. После завершения участники не смогут отправлять ответы. Используйте для окончания викторины.
    
**Последовательность:**
1. Запустите все вопросы
2. Дождитесь ответов от участников
3. Завершите игру через этот эндпоинт
4. Получите результаты через GET /teacher/quizzes/:quizId/results`,
  })
  @ApiParam({ name: 'quizId', description: 'ID теста', example: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Игра завершена',
    schema: {
      example: {
        id: 'uuid',
        title: 'Математика для 5 класса',
        pin: '123456',
        status: 'finished',
        creatorId: 'uuid',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Тест не найден' })
  @ApiResponse({ status: 403, description: 'Вы не являетесь создателем этого теста' })
  async finishQuiz(@Param('quizId') quizId: string, @Req() req: any) {
    return this.quizzesService.finishQuiz(quizId, req.user.id);
  }

  @Get(':quizId/results')
  @ApiOperation({
    summary: 'Получить результаты игры',
    description: `Получает детальные результаты игры с разбивкой по командам и участникам.
    
**Структура ответа:**
- quiz: информация о тесте
- team1: результаты команды 1 (участники, правильные ответы, общие баллы)
- team2: результаты команды 2 (участники, правильные ответы, общие баллы)`,
  })
  @ApiParam({ name: 'quizId', description: 'ID теста', example: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Результаты игры',
    schema: {
      example: {
        quiz: {
          id: 'uuid',
          title: 'Математика для 5 класса',
          pin: '123456',
          status: 'finished',
        },
        team1: {
          team: 1,
          participants: [
            {
              id: 'uuid',
              name: 'Иван Иванов',
              correctAnswers: 5,
              totalAnswers: 5,
              answers: [
                { questionId: 'uuid', isCorrect: true, responseTimeMs: 5000 },
              ],
            },
          ],
          totalCorrect: 5,
          totalAnswers: 5,
        },
        team2: {
          team: 2,
          participants: [
            {
              id: 'uuid',
              name: 'Мария Сидорова',
              correctAnswers: 3,
              totalAnswers: 5,
              answers: [
                { questionId: 'uuid', isCorrect: true, responseTimeMs: 8000 },
              ],
            },
          ],
          totalCorrect: 3,
          totalAnswers: 5,
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Тест не найден' })
  @ApiResponse({ status: 403, description: 'Вы не являетесь создателем этого теста' })
  async getResults(@Param('quizId') quizId: string, @Req() req: any) {
    return this.quizzesService.getResults(quizId, req.user.id);
  }

  @Get(':quizId/tug-position')
  @ApiOperation({
    summary: 'Получить текущую позицию каната',
    description: `Получает текущую позицию каната между командами.
    
**Формула расчета:**
- Баллы команды = (правильные ответы × 50) + (средняя скорость × 10)
- Позиция = (team1Score - team2Score) / (team1Score + team2Score) × 100
- position: от -100 (команда 2 побеждает) до +100 (команда 1 побеждает)
- hasAnswers: false - если нет ответов (начальное состояние), true - если есть ответы`,
  })
  @ApiParam({ name: 'quizId', description: 'ID теста', example: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Позиция каната',
    schema: {
      example: {
        position: 25.5,
        team1Score: 150,
        team2Score: 100,
        hasAnswers: true,
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Тест не найден' })
  async getTugPosition(@Param('quizId') quizId: string) {
    const tugStatus = await this.quizzesService.getTugPosition(quizId);
    
    // Возвращаем в формате согласно требованиям
    return {
      position: tugStatus.position,
      team1Score: tugStatus.team1Score,
      team2Score: tugStatus.team2Score,
      hasAnswers: tugStatus.hasAnswers,
    };
  }

  @Get('pin/:pin/participants')
  @ApiOperation({
    summary: 'Получить список участников по PIN',
    description: `Получает список всех участников, присоединившихся к игре. Используйте этот эндпоинт, чтобы увидеть, кто зашел в игру перед запуском.
    
**Использование:**
1. Создайте тест и получите PIN
2. Ученики присоединяются через POST /student/quizzes/pin/:pin/join
3. Вызывайте этот эндпоинт, чтобы увидеть список участников
4. Когда все зашли, запускайте игру через POST /teacher/quizzes/:quizId/start`,
  })
  @ApiParam({ name: 'pin', description: '6-значный PIN-код игры', example: '123456' })
  @ApiResponse({
    status: 200,
    description: 'Список участников',
    schema: {
      example: {
        quiz: {
          id: 'uuid',
          title: 'Математика для 5 класса',
          pin: '123456',
          status: 'created',
        },
        participants: {
          total: 4,
          team1: {
            count: 2,
            members: [
              { id: 'uuid', name: 'Иван Иванов', joinedAt: '2025-12-16T12:00:00.000Z' },
              { id: 'uuid', name: 'Петр Петров', joinedAt: '2025-12-16T12:01:00.000Z' },
            ],
          },
          team2: {
            count: 2,
            members: [
              { id: 'uuid', name: 'Мария Сидорова', joinedAt: '2025-12-16T12:02:00.000Z' },
              { id: 'uuid', name: 'Анна Козлова', joinedAt: '2025-12-16T12:03:00.000Z' },
            ],
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Тест не найден' })
  @ApiResponse({ status: 403, description: 'Вы не являетесь создателем этого теста' })
  async getParticipants(@Param('pin') pin: string, @Req() req: any) {
    return this.quizzesService.getParticipantsByPin(pin, req.user.id);
  }
}

