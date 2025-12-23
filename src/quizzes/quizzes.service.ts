import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Quiz, QuizStatus } from './entities/quiz.entity';
import { Question } from '../questions/entities/question.entity';
import { AnswerOption } from '../answer-options/entities/answer-option.entity';
import { Participant, Team } from '../participants/entities/participant.entity';
import { Answer } from '../answers/entities/answer.entity';
import { CreateQuizDto } from './dto/create-quiz.dto';
import { JoinQuizDto } from './dto/join-quiz.dto';
import { SubmitAnswerDto } from './dto/submit-answer.dto';
import { TugOfWarService } from './services/tug-of-war.service';

@Injectable()
export class QuizzesService {
  constructor(
    @InjectRepository(Quiz)
    private quizRepository: Repository<Quiz>,
    @InjectRepository(Question)
    private questionRepository: Repository<Question>,
    @InjectRepository(AnswerOption)
    private answerOptionRepository: Repository<AnswerOption>,
    @InjectRepository(Participant)
    private participantRepository: Repository<Participant>,
    @InjectRepository(Answer)
    private answerRepository: Repository<Answer>,
    private tugOfWarService: TugOfWarService,
  ) {}

  // Генерация уникального 6-значного PIN
  private async generateUniquePin(): Promise<string> {
    let pin: string = '';
    let isUnique = false;

    while (!isUnique) {
      pin = Math.floor(100000 + Math.random() * 900000).toString();
      const existing = await this.quizRepository.findOne({ where: { pin } });
      if (!existing) {
        isUnique = true;
      }
    }

    return pin;
  }

  // Создание теста (учитель)
  async createQuiz(createQuizDto: CreateQuizDto, creatorId: string): Promise<Quiz> {
    const pin = await this.generateUniquePin();

    const quiz = this.quizRepository.create({
      title: createQuizDto.title,
      pin,
      status: QuizStatus.CREATED,
      creatorId,
    });

    const savedQuiz = await this.quizRepository.save(quiz);

    // Создание вопросов и вариантов ответов
    for (const questionDto of createQuizDto.questions) {
      const question = this.questionRepository.create({
        text: questionDto.text,
        timeSeconds: questionDto.timeSeconds,
        quizId: savedQuiz.id,
        order: questionDto.order,
      });

      const savedQuestion = await this.questionRepository.save(question);

      // Создание вариантов ответов
      const options = questionDto.options.map((optionDto) =>
        this.answerOptionRepository.create({
          text: optionDto.text,
          order: optionDto.order,
          questionId: savedQuestion.id,
        }),
      );

      const savedOptions = await this.answerOptionRepository.save(options);

      // Находим правильный вариант ответа по порядковому номеру
      const correctOption = savedOptions.find((opt) => opt.order === questionDto.correctAnswerOrder);
      if (!correctOption) {
        throw new BadRequestException(
          `Правильный вариант ответа с порядковым номером ${questionDto.correctAnswerOrder} не найден`,
        );
      }

      // Устанавливаем correctAnswerId и обновляем вопрос
      savedQuestion.correctAnswerId = correctOption.id;
      await this.questionRepository.save(savedQuestion);
    }

    const createdQuiz = await this.quizRepository.findOne({
      where: { id: savedQuiz.id },
      relations: ['questions', 'questions.options'],
    });

    if (!createdQuiz) {
      throw new NotFoundException('Тест не найден после создания');
    }

    return createdQuiz;
  }

  // Получение информации о тесте по PIN (ученик)
  async getQuizByPin(pin: string): Promise<Quiz> {
    const quiz = await this.quizRepository.findOne({
      where: { pin },
      relations: ['questions', 'questions.options'],
      order: {
        questions: {
          order: 'ASC',
        },
      },
    });

    if (!quiz) {
      throw new NotFoundException('Тест с таким PIN не найден');
    }

    return quiz;
  }

  // Присоединение к игре (ученик)
  async joinQuiz(pin: string, joinDto: JoinQuizDto): Promise<any> {
    const quiz = await this.quizRepository.findOne({ where: { pin } });

    if (!quiz) {
      throw new NotFoundException('Тест с таким PIN не найден');
    }

    if (quiz.status === QuizStatus.FINISHED) {
      throw new BadRequestException('Игра уже завершена');
    }

    // Проверка, не присоединился ли уже участник с таким именем
    const existingParticipant = await this.participantRepository.findOne({
      where: { pin, name: joinDto.name },
    });

    if (existingParticipant) {
      throw new BadRequestException('Участник с таким именем уже присоединился');
    }

    const participant = this.participantRepository.create({
      name: joinDto.name,
      team: joinDto.team,
      pin,
      quizId: quiz.id,
    });

    const savedParticipant = await this.participantRepository.save(participant);

    // Возвращаем в формате, ожидаемом фронтендом
    return {
      participantId: savedParticipant.id,
      quizId: savedParticipant.quizId,
      name: savedParticipant.name,
      team: savedParticipant.team,
      pin: savedParticipant.pin,
      joinedAt: savedParticipant.joinedAt,
    };
  }

  // Запуск игры (учитель)
  async startQuiz(quizId: string, userId: string): Promise<Quiz> {
    const quiz = await this.quizRepository.findOne({
      where: { id: quizId },
      relations: ['creator', 'questions', 'questions.options'],
      order: {
        questions: {
          order: 'ASC',
        },
      },
    });

    if (!quiz) {
      throw new NotFoundException('Тест не найден');
    }

    if (quiz.creatorId !== userId) {
      throw new ForbiddenException('Вы не являетесь создателем этого теста');
    }

    if (quiz.status !== QuizStatus.CREATED) {
      throw new BadRequestException('Игра уже запущена или завершена');
    }

    quiz.status = QuizStatus.STARTED;
    const savedQuiz = await this.quizRepository.save(quiz);
    
    // Возвращаем с вопросами и вариантами ответов
    const quizWithQuestions = await this.quizRepository.findOne({
      where: { id: savedQuiz.id },
      relations: ['questions', 'questions.options'],
      order: {
        questions: {
          order: 'ASC',
        },
      },
    });
    
    if (!quizWithQuestions) {
      throw new NotFoundException('Тест не найден после сохранения');
    }
    
    return quizWithQuestions;
  }

  // Получение статистики ученика
  async getStudentResults(pin: string, participantId: string) {
    const participant = await this.participantRepository.findOne({
      where: { id: participantId, pin },
      relations: ['quiz'],
    });

    if (!participant) {
      throw new NotFoundException('Участник не найден');
    }

    const quiz = participant.quiz;
    if (quiz.status !== QuizStatus.FINISHED) {
      throw new BadRequestException('Игра еще не завершена');
    }

    // Получаем все ответы участника
    const participantAnswers = await this.answerRepository.find({
      where: { participantId },
      relations: ['question', 'selectedOption'],
      order: {
        answeredAt: 'ASC',
      },
    });

    const correctAnswers = participantAnswers.filter((a) => a.isCorrect).length;
    const totalAnswers = participantAnswers.length;
    const accuracy = totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 10000) / 100 : 0;
    
    // Среднее время ответа
    const averageResponseTime = totalAnswers > 0
      ? Math.round(participantAnswers.reduce((sum, a) => sum + (a.responseTimeMs || 0), 0) / totalAnswers)
      : 0;

    // Используем среднее время на вопрос для расчета скорости
    let maxTimeMs = 30000; // дефолт 30 секунд
    if (quiz.questions && quiz.questions.length > 0) {
      const totalTimeSeconds = quiz.questions.reduce((sum, q) => sum + (q.timeSeconds || 30), 0);
      const averageTimeSeconds = totalTimeSeconds / quiz.questions.length;
      maxTimeMs = averageTimeSeconds * 1000;
    }

    // Рассчитываем баллы участника
    const participantScore = this.tugOfWarService.calculateTeamScore(
      correctAnswers,
      this.tugOfWarService.calculateAverageSpeed(participantAnswers, maxTimeMs)
    );

    // Получаем все ответы команды для расчета общего балла команды
    const teamParticipants = await this.participantRepository.find({
      where: { quizId: quiz.id, team: participant.team },
    });
    const teamParticipantIds = teamParticipants.map((p) => p.id);
    const teamAnswers = await this.answerRepository.find({
      where: { participantId: In(teamParticipantIds) },
    });
    const teamCorrectAnswers = teamAnswers.filter((a) => a.isCorrect).length;
    const teamScore = this.tugOfWarService.calculateTeamScore(
      teamCorrectAnswers,
      this.tugOfWarService.calculateAverageSpeed(teamAnswers, maxTimeMs)
    );

    // Вклад в команду (процент)
    const contribution = teamScore > 0 ? Math.round((participantScore / teamScore) * 10000) / 100 : 0;

    // Финальная позиция каната
    const tugStatus = await this.tugOfWarService.calculateTugPosition(quiz.id);
    const winner = this.tugOfWarService.determineWinner(tugStatus);

    return {
      participant: {
        id: participant.id,
        name: participant.name,
        team: participant.team,
      },
      quiz: {
        id: quiz.id,
        title: quiz.title,
        pin: quiz.pin,
        status: quiz.status,
      },
      stats: {
        correctAnswers,
        totalAnswers,
        accuracy,
        averageResponseTime,
        participantScore,
        contribution,
      },
      teamStats: {
        team: participant.team,
        teamScore,
        totalCorrectAnswers: teamCorrectAnswers,
        totalParticipants: teamParticipants.length,
        averageSpeed: Math.round(this.tugOfWarService.calculateAverageSpeed(teamAnswers, maxTimeMs) * 100) / 100,
      },
      answers: participantAnswers.map((a) => ({
        questionId: a.questionId,
        questionText: a.question?.text,
        selectedOptionText: a.selectedOption?.text,
        isCorrect: a.isCorrect,
        responseTimeMs: a.responseTimeMs,
        answeredAt: a.answeredAt,
      })),
      finalPosition: tugStatus.position,
      winner,
    };
  }

  // Отправка ответа (ученик)
  async submitAnswer(
    pin: string,
    questionId: string,
    participantId: string,
    submitAnswerDto: SubmitAnswerDto,
  ): Promise<Answer & { tugStatus?: any; shouldAutoFinish?: boolean; gameFinished?: boolean }> {
    const quiz = await this.quizRepository.findOne({ where: { pin } });
    if (!quiz) {
      throw new NotFoundException('Тест не найден');
    }

    if (quiz.status !== QuizStatus.STARTED) {
      throw new BadRequestException('Игра не запущена');
    }

    const question = await this.questionRepository.findOne({
      where: { id: questionId },
      relations: ['options'],
    });

    if (!question) {
      throw new NotFoundException('Вопрос не найден');
    }

    const participant = await this.participantRepository.findOne({
      where: { id: participantId },
    });

    if (!participant || participant.pin !== pin) {
      throw new NotFoundException('Участник не найден');
    }

    // Проверка, не ответил ли уже участник на этот вопрос
    const existingAnswer = await this.answerRepository.findOne({
      where: { participantId, questionId },
    });

    if (existingAnswer) {
      throw new BadRequestException('Вы уже ответили на этот вопрос');
    }

    const selectedOption = question.options.find(
      (opt) => opt.id === submitAnswerDto.selectedOptionId,
    );

    if (!selectedOption) {
      throw new BadRequestException('Выбранный вариант ответа не найден');
    }

    if (!question.correctAnswerId) {
      throw new BadRequestException('Правильный ответ для этого вопроса не установлен');
    }

    const isCorrect = question.correctAnswerId === submitAnswerDto.selectedOptionId;

    const answer = this.answerRepository.create({
      participantId,
      questionId,
      selectedOptionId: submitAnswerDto.selectedOptionId,
      isCorrect,
      responseTimeMs: submitAnswerDto.responseTimeMs,
    });

    const savedAnswer = await this.answerRepository.save(answer);

    // Рассчитываем новую позицию каната после ответа
    const tugStatus = await this.tugOfWarService.calculateTugPosition(quiz.id);

    // Проверяем, не достигнута ли победа (position >= 100 или <= -100)
    const shouldAutoFinish = Math.abs(tugStatus.position) >= 100 && tugStatus.hasAnswers;
    
    // Если достигнута победа, автоматически завершаем игру
    if (shouldAutoFinish && quiz.status === QuizStatus.STARTED) {
      quiz.status = QuizStatus.FINISHED;
      await this.quizRepository.save(quiz);
    }
    
    // Возвращаем ответ с информацией о позиции каната и флагом автоматического завершения
    return Object.assign(savedAnswer, { tugStatus, shouldAutoFinish, gameFinished: shouldAutoFinish });
  }

  // Завершение игры (учитель)
  async finishQuiz(quizId: string, userId: string): Promise<Quiz> {
    const quiz = await this.quizRepository.findOne({
      where: { id: quizId },
      relations: ['creator'],
    });

    if (!quiz) {
      throw new NotFoundException('Тест не найден');
    }

    if (quiz.creatorId !== userId) {
      throw new ForbiddenException('Вы не являетесь создателем этого теста');
    }

    quiz.status = QuizStatus.FINISHED;
    const savedQuiz = await this.quizRepository.save(quiz);
    
    // Очищаем кэш позиции каната при завершении игры
    this.tugOfWarService.clearCache(quizId);
    
    return savedQuiz;
  }

  // Получение результатов (учитель)
  async getResults(quizId: string, userId: string) {
    const quiz = await this.quizRepository.findOne({
      where: { id: quizId },
      relations: ['creator', 'questions', 'participants'],
    });

    if (!quiz) {
      throw new NotFoundException('Тест не найден');
    }

    if (quiz.creatorId !== userId) {
      throw new ForbiddenException('Вы не являетесь создателем этого теста');
    }

    const answers = await this.answerRepository.find({
      where: { questionId: In(quiz.questions.map((q) => q.id)) },
      relations: ['participant', 'question', 'selectedOption'],
    });

    // Подсчет результатов по командам
    const team1Results = {
      team: Team.TEAM_1,
      participants: [] as any[],
      totalCorrect: 0,
      totalAnswers: 0,
    };

    const team2Results = {
      team: Team.TEAM_2,
      participants: [] as any[],
      totalCorrect: 0,
      totalAnswers: 0,
    };

    // Используем среднее время на вопрос для расчета скорости
    let maxTimeMs = 30000; // дефолт 30 секунд
    if (quiz.questions && quiz.questions.length > 0) {
      const totalTimeSeconds = quiz.questions.reduce((sum, q) => sum + (q.timeSeconds || 30), 0);
      const averageTimeSeconds = totalTimeSeconds / quiz.questions.length;
      maxTimeMs = averageTimeSeconds * 1000;
    }

    for (const participant of quiz.participants) {
      const participantAnswers = answers.filter((a) => a.participantId === participant.id);
      const correctAnswers = participantAnswers.filter((a) => a.isCorrect).length;
      const totalAnswers = participantAnswers.length;
      
      // Рассчитываем среднюю скорость для участника
      const participantAverageSpeed = this.tugOfWarService.calculateAverageSpeed(participantAnswers, maxTimeMs);
      
      // Рассчитываем баллы участника
      const participantScore = this.tugOfWarService.calculateTeamScore(correctAnswers, participantAverageSpeed);
      
      // Среднее время ответа в миллисекундах
      const averageResponseTimeMs = totalAnswers > 0
        ? Math.round(participantAnswers.reduce((sum, a) => sum + (a.responseTimeMs || 0), 0) / totalAnswers)
        : 0;

      const participantResult = {
        id: participant.id,
        name: participant.name,
        correctAnswers,
        totalAnswers,
        averageSpeed: Math.round(participantAverageSpeed * 100) / 100,
        participantScore,
        averageResponseTimeMs,
        answers: participantAnswers.map((a) => ({
          questionId: a.questionId,
          isCorrect: a.isCorrect,
          responseTimeMs: a.responseTimeMs,
        })),
      };

      if (participant.team === Team.TEAM_1) {
        team1Results.participants.push(participantResult);
        team1Results.totalCorrect += correctAnswers;
        team1Results.totalAnswers += totalAnswers;
      } else {
        team2Results.participants.push(participantResult);
        team2Results.totalCorrect += correctAnswers;
        team2Results.totalAnswers += totalAnswers;
      }
    }

    // Рассчитываем финальную позицию каната и победителя
    const tugStatus = await this.tugOfWarService.calculateTugPosition(quizId);
    const winner = this.tugOfWarService.determineWinner(tugStatus);

    // Рассчитываем общие баллы команд (используем tugStatus для консистентности)
    const team1Score = tugStatus.team1Score;
    const team2Score = tugStatus.team2Score;

    // Рассчитываем среднюю скорость для каждой команды
    const team1Answers = answers.filter(a => team1Results.participants.some(p => p.id === a.participantId));
    const team2Answers = answers.filter(a => team2Results.participants.some(p => p.id === a.participantId));
    const team1AverageSpeed = this.tugOfWarService.calculateAverageSpeed(team1Answers, maxTimeMs);
    const team2AverageSpeed = this.tugOfWarService.calculateAverageSpeed(team2Answers, maxTimeMs);
    
    // Рассчитываем общую продолжительность игры на основе времени первого и последнего ответа
    let quizDurationMinutes = 0;
    if (answers.length > 0) {
      const sortedAnswers = answers.sort((a, b) => 
        new Date(a.answeredAt).getTime() - new Date(b.answeredAt).getTime()
      );
      const firstAnswerTime = new Date(sortedAnswers[0].answeredAt).getTime();
      const lastAnswerTime = new Date(sortedAnswers[sortedAnswers.length - 1].answeredAt).getTime();
      const durationMs = lastAnswerTime - firstAnswerTime;
      quizDurationMinutes = Math.round(durationMs / 60000);
    }

    return {
      quiz: {
        id: quiz.id,
        title: quiz.title,
        pin: quiz.pin,
        status: quiz.status,
        totalQuestions: quiz.questions?.length || 0,
        totalParticipants: quiz.participants?.length || 0,
        durationMinutes: quizDurationMinutes,
      },
      team1: {
        ...team1Results,
        totalScore: team1Score,
        averageSpeed: Math.round(team1AverageSpeed * 100) / 100,
        totalParticipants: team1Results.participants.length,
      },
      team2: {
        ...team2Results,
        totalScore: team2Score,
        averageSpeed: Math.round(team2AverageSpeed * 100) / 100,
        totalParticipants: team2Results.participants.length,
      },
      winner,
      finalPosition: tugStatus.position,
      tugStatus,
    };
  }

  // Получение всех тестов учителя
  async getMyQuizzes(userId: string): Promise<Quiz[]> {
    return this.quizRepository.find({
      where: { creatorId: userId },
      relations: ['questions', 'questions.options'],
      order: {
        createdAt: 'DESC',
        questions: {
          order: 'ASC',
        },
      },
    });
  }

  // Получение одного теста по ID (для учителя)
  async getQuizById(quizId: string, userId: string): Promise<Quiz> {
    const quiz = await this.quizRepository.findOne({
      where: { id: quizId },
      relations: ['questions', 'questions.options', 'participants'],
      order: {
        questions: {
          order: 'ASC',
        },
      },
    });

    if (!quiz) {
      throw new NotFoundException('Тест не найден');
    }

    if (quiz.creatorId !== userId) {
      throw new ForbiddenException('Вы не являетесь создателем этого теста');
    }

    return quiz;
  }

  // Удаление теста (учитель)
  async deleteQuiz(quizId: string, userId: string): Promise<void> {
    const quiz = await this.quizRepository.findOne({
      where: { id: quizId },
    });

    if (!quiz) {
      throw new NotFoundException('Тест не найден');
    }

    if (quiz.creatorId !== userId) {
      throw new ForbiddenException('Вы не являетесь создателем этого теста');
    }

    // Проверяем, что игра не запущена
    if (quiz.status === QuizStatus.STARTED) {
      throw new BadRequestException('Нельзя удалить запущенную игру. Сначала завершите игру');
    }

    // TypeORM автоматически удалит связанные записи благодаря каскадному удалению
    await this.quizRepository.remove(quiz);
  }

  // Получение текущей позиции каната
  async getTugPosition(quizId: string): Promise<any> {
    const quiz = await this.quizRepository.findOne({ where: { id: quizId } });
    if (!quiz) {
      throw new NotFoundException('Тест не найден');
    }

    return this.tugOfWarService.calculateTugPosition(quizId);
  }

  // Получение списка участников по PIN (для учителя)
  async getParticipantsByPin(pin: string, userId: string): Promise<any> {
    const quiz = await this.quizRepository.findOne({
      where: { pin },
      relations: ['creator'],
    });

    if (!quiz) {
      throw new NotFoundException('Тест не найден');
    }

    if (quiz.creatorId !== userId) {
      throw new ForbiddenException('Вы не являетесь создателем этого теста');
    }

    const participants = await this.participantRepository.find({
      where: { pin },
      order: { joinedAt: 'ASC' },
    });

    // Группируем по командам
    const team1 = participants.filter((p) => p.team === Team.TEAM_1);
    const team2 = participants.filter((p) => p.team === Team.TEAM_2);

    return {
      quiz: {
        id: quiz.id,
        title: quiz.title,
        pin: quiz.pin,
        status: quiz.status,
      },
      participants: {
        total: participants.length,
        team1: {
          count: team1.length,
          members: team1.map((p) => ({
            id: p.id,
            name: p.name,
            joinedAt: p.joinedAt,
          })),
        },
        team2: {
          count: team2.length,
          members: team2.map((p) => ({
            id: p.id,
            name: p.name,
            joinedAt: p.joinedAt,
          })),
        },
      },
    };
  }
}

