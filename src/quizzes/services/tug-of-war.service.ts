import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Quiz } from '../entities/quiz.entity';
import { Participant, Team } from '../../participants/entities/participant.entity';
import { Answer } from '../../answers/entities/answer.entity';
import { Question } from '../../questions/entities/question.entity';

export interface TugStatus {
  position: number; // От -100 (команда 2 побеждает) до 100 (команда 1 побеждает)
  team1Score: number;
  team2Score: number;
  hasAnswers: boolean; // Есть ли ответы у команд
}

@Injectable()
export class TugOfWarService {
  // Кэш для информации о времени вопросов (quizId -> averageTimeSeconds)
  private readonly questionTimeCache = new Map<string, number>();

  constructor(
    @InjectRepository(Participant)
    private participantRepository: Repository<Participant>,
    @InjectRepository(Answer)
    private answerRepository: Repository<Answer>,
    @InjectRepository(Question)
    private questionRepository: Repository<Question>,
    @InjectRepository(Quiz)
    private quizRepository: Repository<Quiz>,
  ) {}

  /**
   * Рассчитывает баллы команды по формуле:
   * Баллы = (количество правильных × 50) + (средняя скорость × 10)
   */
  calculateTeamScore(correctAnswers: number, averageSpeed: number): number {
    const correctAnswersScore = correctAnswers * 50;
    const speedScore = averageSpeed * 10;
    return Math.round(correctAnswersScore + speedScore);
  }

  /**
   * Рассчитывает среднюю скорость ответов команды
   * Скорость = (максимальное время на вопрос - среднее затраченное время) в секундах
   * Чем быстрее ответ, тем больше скорость
   */
  calculateAverageSpeed(
    answers: Answer[],
    maxTimeMs: number = 30000, // максимум времени на вопрос в миллисекундах
  ): number {
    if (answers.length === 0) return 0;

    const totalTimeSpent = answers.reduce((sum, a) => sum + (a.responseTimeMs || 0), 0);
    const averageTimeSpentMs = totalTimeSpent / answers.length;
    
    // Конвертируем в секунды: (максимальное время - среднее затраченное время) / 1000
    const maxTimeSeconds = maxTimeMs / 1000;
    const averageTimeSpentSeconds = averageTimeSpentMs / 1000;
    const speedScore = Math.max(0, maxTimeSeconds - averageTimeSpentSeconds);

    return Math.round(speedScore * 100) / 100;
  }

  /**
   * Рассчитывает количество правильных ответов команды
   */
  private calculateCorrectAnswers(answers: Answer[]): number {
    return answers.filter((a) => a.isCorrect).length;
  }

  /**
   * Обновляет статус каната на основе баллов команд
   * Позиция от -100 (команда 2 побеждает) до 100 (команда 1 побеждает)
   * Используется степенная функция для более плавного перетягивания каната
   */
  private updateTugPosition(team1Score: number, team2Score: number, hasAnswers: boolean): TugStatus {
    const totalScore = team1Score + team2Score;

    // Если нет ответов, возвращаем начальную позицию (0)
    if (!hasAnswers || totalScore === 0) {
      return {
        position: 0,
        team1Score: 0,
        team2Score: 0,
        hasAnswers: false,
      };
    }

    // Рассчитываем позицию от -100 до 100 с более плавным перетягиванием
    // Для достижения position = 100 нужно, чтобы одна команда имела минимум в 3 раза больше баллов (75% от общего)
    const scoreDiff = team1Score - team2Score;
    const minScore = Math.min(team1Score, team2Score);
    const maxScore = Math.max(team1Score, team2Score);
    
    let rawPosition: number;
    
    // Если одна команда имеет 0 баллов, ограничиваем максимальную позицию до ±75
    // чтобы игра не завершалась сразу после первого ответа
    if (minScore === 0 && maxScore > 0) {
      rawPosition = Math.sign(scoreDiff) * 75;
    } else {
      // Когда обе команды имеют баллы, используем долю максимальной команды
      // При 50% (равные 1:1) -> position = 0
      // При 75% (3:1) -> position = 100
      const ratio = maxScore / totalScore; // Доля максимальной команды: от 0.5 до 1.0
      // Нормализуем: 0.5 (равные) -> 0.0, 0.75 (3:1) -> 1.0
      // Формула: (ratio - 0.5) / 0.25 преобразует 0.5-0.75 в 0.0-1.0
      const normalizedRatio = Math.min(1.0, (ratio - 0.5) / 0.25);
      // Применяем степенную функцию для плавности перехода (степень 0.7 делает кривую более плавной)
      rawPosition = Math.sign(scoreDiff) * Math.pow(normalizedRatio, 0.7) * 100;
    }
    
    const clampedPosition = Math.max(-100, Math.min(100, rawPosition));

    return {
      position: Math.round(clampedPosition * 100) / 100,
      team1Score,
      team2Score,
      hasAnswers: true,
    };
  }

  /**
   * Получает среднее время на вопрос (с кэшированием)
   */
  private async getAverageQuestionTime(quizId: string): Promise<number> {
    // Проверяем кэш
    if (this.questionTimeCache.has(quizId)) {
      return this.questionTimeCache.get(quizId)!;
    }

    // Загружаем вопросы из БД только при первом запросе
    // Используем прямой запрос для большей эффективности
    const questions = await this.questionRepository.find({
      where: { quizId },
      select: ['timeSeconds'], // Оптимизация: загружаем только нужное поле
    });

    let averageTimeSeconds = 30; // дефолт 30 секунд
    if (questions && questions.length > 0) {
      const totalTimeSeconds = questions.reduce((sum, q) => sum + (q.timeSeconds || 30), 0);
      averageTimeSeconds = totalTimeSeconds / questions.length;
    }

    // Кэшируем результат
    this.questionTimeCache.set(quizId, averageTimeSeconds);
    return averageTimeSeconds;
  }

  /**
   * Рассчитывает текущую позицию каната для игры (оптимизированная версия)
   */
  async calculateTugPosition(quizId: string): Promise<TugStatus> {
    // Получаем всех участников игры
    const participants = await this.participantRepository.find({
      where: { quizId },
      select: ['id', 'team'], // Оптимизация: загружаем только нужные поля
    });

    if (participants.length === 0) {
      return {
        position: 0,
        team1Score: 0,
        team2Score: 0,
        hasAnswers: false,
      };
    }

    // Получаем среднее время на вопрос (с кэшированием)
    const averageTimeSeconds = await this.getAverageQuestionTime(quizId);
    const maxTimeMs = averageTimeSeconds * 1000;

    // Получаем все ответы участников БЕЗ загрузки relations (оптимизация)
    const participantIds = participants.map((p) => p.id);
    const allAnswers = await this.answerRepository.find({
      where: { participantId: In(participantIds) },
      select: ['participantId', 'isCorrect', 'responseTimeMs'], // Оптимизация: только нужные поля
    });

    // Разделяем участников по командам
    const team1Members = participants.filter((p) => p.team === Team.TEAM_1);
    const team2Members = participants.filter((p) => p.team === Team.TEAM_2);

    // Получаем ответы каждой команды
    const team1Answers = allAnswers.filter((a) =>
      team1Members.some((m) => m.id === a.participantId),
    );
    const team2Answers = allAnswers.filter((a) =>
      team2Members.some((m) => m.id === a.participantId),
    );

    // Проверяем, есть ли ответы
    const hasAnswers = allAnswers.length > 0;

    // Рассчитываем метрики для команды 1
    const team1CorrectAnswers = this.calculateCorrectAnswers(team1Answers);
    const team1AverageSpeed = this.calculateAverageSpeed(team1Answers, maxTimeMs);
    const team1Score = this.calculateTeamScore(team1CorrectAnswers, team1AverageSpeed);

    // Рассчитываем метрики для команды 2
    const team2CorrectAnswers = this.calculateCorrectAnswers(team2Answers);
    const team2AverageSpeed = this.calculateAverageSpeed(team2Answers, maxTimeMs);
    const team2Score = this.calculateTeamScore(team2CorrectAnswers, team2AverageSpeed);

    // Обновляем позицию каната
    return this.updateTugPosition(team1Score, team2Score, hasAnswers);
  }

  /**
   * Рассчитывает вклад игрока в команду (в процентах)
   */
  calculatePlayerContribution(playerScore: number, teamTotalScore: number): number {
    if (teamTotalScore === 0) return 0;
    return Math.round((playerScore / teamTotalScore) * 10000) / 100;
  }

  /**
   * Определяет победителя
   */
  determineWinner(tugStatus: TugStatus): Team | null {
    if (tugStatus.position > 0) return Team.TEAM_1;
    if (tugStatus.position < 0) return Team.TEAM_2;
    return null; // ничья
  }

  /**
   * Очищает кэш для квиза (вызывать при завершении игры)
   */
  clearCache(quizId: string): void {
    this.questionTimeCache.delete(quizId);
  }
}

