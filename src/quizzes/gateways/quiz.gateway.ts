import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QuizzesService } from '../quizzes.service';
import { QuizStatus } from '../entities/quiz.entity';
import { Participant } from '../../participants/entities/participant.entity';

@WebSocketGateway({
  cors: {
    origin: '*', // Разрешить все источники для WebSocket подключений
    methods: ['GET', 'POST'],
    credentials: false, // Должно быть false при origin: '*'
  },
  namespace: '/quiz',
  transports: ['websocket', 'polling'], // Поддержка и websocket, и polling для совместимости
})
export class QuizGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(QuizGateway.name);
  private readonly pinRooms = new Map<string, Set<string>>(); // PIN -> Set of socket IDs
  // Хранилище времени начала вопросов: quizId -> questionIndex -> timestamp
  private readonly questionStartTimes = new Map<string, Map<number, number>>();
  // Таймеры для автоматического перехода к следующему вопросу: quizId -> { questionIndex, startTime, timeSeconds, timerId, pin }
  private readonly questionTimers = new Map<string, { questionIndex: number; startTime: number; timeSeconds: number; timerId: NodeJS.Timeout; pin: string }>();
  // Таймеры для автоматического завершения игры после последнего вопроса: quizId -> timeout (deprecated, используем questionTimers)
  private readonly gameFinishTimers = new Map<string, NodeJS.Timeout>();
  // Информация о последнем запущенном вопросе: quizId -> { questionIndex, questionId } (deprecated)
  private readonly lastQuestionInfo = new Map<string, { questionIndex: number; questionId: string }>();
  // Время последней активности клиента: socketId -> timestamp
  private readonly clientLastActivity = new Map<string, number>();
  // Таймаут неактивных подключений (5 минут)
  private readonly INACTIVE_TIMEOUT_MS = 5 * 60 * 1000;
  // Интервал проверки неактивных подключений (1 минута)
  private cleanupInterval: NodeJS.Timeout;

  constructor(
    private readonly quizzesService: QuizzesService,
    @InjectRepository(Participant)
    private participantRepository: Repository<Participant>,
  ) {
    // Запускаем периодическую очистку неактивных подключений
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveConnections();
    }, 60000); // Проверяем каждую минуту
  }

  /**
   * Очищает неактивные подключения (не присоединившиеся к игре более INACTIVE_TIMEOUT_MS)
   */
  private cleanupInactiveConnections(): void {
    const now = Date.now();
    const toDisconnect: string[] = [];

    // Проверяем всех клиентов
    if (this.server?.sockets?.sockets) {
      for (const [socketId, socket] of this.server.sockets.sockets.entries()) {
        const lastActivity = this.clientLastActivity.get(socketId);
        
        // Если клиент не присоединился к игре (нет PIN) и прошло много времени
        if (!socket.data.pin && lastActivity && (now - lastActivity) > this.INACTIVE_TIMEOUT_MS) {
          toDisconnect.push(socketId);
        }
      }
    }

    // Отключаем неактивные подключения
    for (const socketId of toDisconnect) {
      const socket = this.server?.sockets?.sockets?.get(socketId);
      if (socket) {
        this.logger.log(`🧹 [Cleanup] Отключение неактивного клиента: ${socketId} (не присоединился к игре за ${Math.round(this.INACTIVE_TIMEOUT_MS / 1000 / 60)} минут)`);
        socket.disconnect(true);
      }
      this.clientLastActivity.delete(socketId);
    }
  }

  /**
   * Обновляет время последней активности клиента
   */
  private updateClientActivity(socketId: string): void {
    this.clientLastActivity.set(socketId, Date.now());
  }

  handleConnection(client: Socket) {
    // Инициализируем данные клиента
    client.data.role = null;
    client.data.userId = null;
    client.data.pin = null;
    client.data.participantId = null;
    client.data.connectedAt = Date.now(); // Время подключения
    
    // Записываем время подключения как время последней активности
    this.updateClientActivity(client.id);
    
    // Логируем каждое подключение
    this.logger.log(`🔌 [Connection] Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    const pin = client.data.pin;
    const role = client.data.role;
    const userId = client.data.userId;
    const participantId = client.data.participantId;
    const connectedAt = client.data.connectedAt;
    const sessionDuration = connectedAt ? Math.round((Date.now() - connectedAt) / 1000) : 0;
    
    // Удаляем клиента из всех комнат
    this.pinRooms.forEach((sockets, pinKey) => {
      if (sockets.has(client.id)) {
        sockets.delete(client.id);
        client.leave(`quiz-${pinKey}`);
      }
    });
    
    // Логируем отключение с подробностями
    if (pin) {
      const roleLabel = role === 'teacher' ? '👨‍🏫 УЧИТЕЛЬ' : '👨‍🎓 УЧЕНИК';
      const identifier = role === 'teacher' ? `userId: ${userId?.substring(0, 8)}...` : `participantId: ${participantId?.substring(0, 8)}...`;
      this.logger.log(`🔌 [Disconnection] ${roleLabel} отключился: ${client.id}, PIN: ${pin}, ${identifier}, сессия: ${sessionDuration}с`);
    } else {
      this.logger.log(`🔌 [Disconnection] Клиент отключился (не присоединился к игре): ${client.id}`);
    }
    
    // Очищаем данные клиента при отключении
    client.data.role = null;
    client.data.userId = null;
    client.data.pin = null;
    client.data.participantId = null;
    this.clientLastActivity.delete(client.id);
  }

  onModuleDestroy() {
    // Очищаем интервал при остановке модуля
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.logger.log('🧹 [Cleanup] Очистка неактивных подключений остановлена');
    }
  }

  // Публичный метод для отправки событий из контроллеров
  emitParticipantJoined(pin: string, participant: any) {
    const roomName = `quiz-${pin}`;
    this.server.to(roomName).emit('participant-joined', {
      pin,
      participant: {
        id: participant.participantId || participant.id, // Поддержка обоих форматов
        name: participant.name,
        team: participant.team,
        joinedAt: participant.joinedAt,
      },
    });
  }

  async emitParticipantsUpdate(pin: string) {
    const roomName = `quiz-${pin}`;
    const quiz = await this.quizzesService.getQuizByPin(pin);
    
    // Получаем участников напрямую из репозитория для отправки обновления
    const participants = await this.quizzesService.getParticipantsByPin(pin, quiz.creatorId);
    
    this.server.to(roomName).emit('participants-update', {
      pin,
      participants: participants.participants,
    });
  }

  emitGameUpdate(pin: string, gameId: string, status: string, currentQuestionIndex?: number) {
    const roomName = `quiz-${pin}`;
    const payload: any = {
      gameId,
      pin,
      status,
    };
    
    // Для статуса 'finished' передаем currentQuestionIndex только если он явно указан
    // Для других статусов используем значение по умолчанию 0
    if (status === QuizStatus.FINISHED) {
      if (currentQuestionIndex !== undefined) {
        payload.currentQuestionIndex = currentQuestionIndex;
      }
    } else {
      payload.currentQuestionIndex = currentQuestionIndex ?? 0;
    }
    
    this.server.to(roomName).emit('game-update', payload);
  }

  async emitTugPositionUpdate(pin: string) {
    const roomName = `quiz-${pin}`;
    const quiz = await this.quizzesService.getQuizByPin(pin);
    const tugStatus = await this.quizzesService.getTugPosition(quiz.id);
    
    this.server.to(roomName).emit('tug-position-update', {
      pin,
      position: tugStatus.position,
      team1Score: tugStatus.team1Score,
      team2Score: tugStatus.team2Score,
      hasAnswers: tugStatus.hasAnswers,
    });
  }

  @SubscribeMessage('join-quiz')
  async handleJoinQuiz(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: {
      pin: string;
      quizId?: string;
      userId?: string;
      role: 'teacher' | 'student';
      participantId?: string;
      name?: string;
      team?: 1 | 2;
    },
  ) {
    const { pin, role, userId, participantId } = data;

    try {
      // Проверка существования теста
      const quiz = await this.quizzesService.getQuizByPin(pin);

      // Присоединение к комнате по PIN (новый формат: quiz-{pin})
      const roomName = `quiz-${pin}`;
      client.join(roomName);

      // Сохранение в мапе
      if (!this.pinRooms.has(pin)) {
        this.pinRooms.set(pin, new Set());
      }
      this.pinRooms.get(pin)!.add(client.id);

      // Сохранение данных в socket
      client.data.pin = pin;
      client.data.role = role;
      client.data.userId = userId;
      client.data.participantId = participantId;
      
      // Обновляем время последней активности (клиент присоединился к игре)
      this.updateClientActivity(client.id);

      // Дополнительная проверка для учителя: убеждаемся, что userId соответствует создателю
      if (role === 'teacher' && userId) {
        if (quiz.creatorId !== userId) {
          this.logger.warn(`⚠️ [Join] Попытка подключения как teacher с userId ${userId}, но создатель квиза ${pin} - ${quiz.creatorId}`);
          client.emit('error', { message: 'Вы не являетесь создателем этой игры' });
          return { success: false, error: 'Неверные права доступа' };
        }
        
        this.logger.log(`👨‍🏫 [Join] УЧИТЕЛЬ подключился к игре: PIN=${pin}, userId=${userId.substring(0, 8)}..., quizId=${quiz.id}, quizTitle="${quiz.title}"`);
        
        const participantsData = await this.quizzesService.getParticipantsByPin(pin, userId);
        client.emit('participants-update', {
          pin,
          participants: participantsData.participants,
        });
      } else if (role === 'student') {
        this.logger.log(`👨‍🎓 [Join] УЧЕНИК подключился к игре: PIN=${pin}, participantId=${participantId?.substring(0, 8) || 'N/A'}..., name=${data.name || 'N/A'}, team=${data.team === 1 ? '🔴 Красная' : data.team === 2 ? '🔵 Синяя' : 'N/A'}`);
      }

      // Отправляем текущее состояние игры для восстановления соединения
      client.emit('quiz-state', {
        quiz: {
          id: quiz.id,
          title: quiz.title,
          pin: quiz.pin,
          status: quiz.status,
        },
        currentQuestionIndex: 0, // Фронтенд должен отслеживать это сам
      });

      // Если игра запущена, отправляем текущую позицию каната
      if (quiz.status === QuizStatus.STARTED || quiz.status === QuizStatus.FINISHED) {
        const tugStatus = await this.quizzesService.getTugPosition(quiz.id);
        client.emit('tug-position-update', {
          pin,
          position: tugStatus.position,
          team1Score: tugStatus.team1Score,
          team2Score: tugStatus.team2Score,
          hasAnswers: tugStatus.hasAnswers,
        });
      }

      return { success: true, pin };
    } catch (error) {
      client.emit('error', { message: error.message });
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('start-quiz')
  async handleStartQuiz(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { pin: string; quizId: string; userId: string },
  ) {
    const { pin, quizId, userId } = data;
    
    this.logger.log(`📥 [Event Received] start-quiz: PIN=${pin}, quizId=${quizId}, userId=${userId?.substring(0, 8) || 'N/A'}..., clientRole=${client.data.role || 'null'}, clientPin=${client.data.pin || 'null'}`);

    if (client.data.role !== 'teacher') {
      this.logger.warn(`⚠️ [Start Quiz] Отклонено: клиент не является учителем. clientRole=${client.data.role || 'null'}, userId=${userId?.substring(0, 8) || 'N/A'}...`);
      client.emit('error', { message: 'Только учитель может запустить игру. Убедитесь, что вы отправили join-quiz с role: "teacher" перед start-quiz' });
      return { success: false };
    }

    try {
      this.logger.log(`▶️ [Start Quiz] Учитель запустил игру: PIN=${pin}, quizId=${quizId}, userId=${userId?.substring(0, 8) || 'N/A'}...`);
      
      const quiz = await this.quizzesService.startQuiz(quizId, userId);
      
      this.logger.log(`▶️ [Start Quiz] Игра запущена успешно: PIN=${pin}, totalQuestions=${quiz.questions?.length || 0}`);
      
      // Отправляем game-update событие
      this.emitGameUpdate(pin, quiz.id, quiz.status, 0);

      return { success: true };
    } catch (error) {
      client.emit('error', { message: error.message });
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('start-question')
  async handleStartQuestion(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { pin: string; currentQuestionIndex: number; timeSeconds?: number },
  ) {
    const { pin, currentQuestionIndex } = data;
    let userId = client.data.userId;
    let role = client.data.role;
    
    this.logger.log(`📥 [Event Received] start-question: PIN=${pin}, questionIndex=${currentQuestionIndex}, clientRole=${role || 'null'}, clientUserId=${userId?.substring(0, 8) || 'null'}..., clientPin=${client.data.pin || 'null'}`);

    try {
      // 1. Получение игры с вопросами (getQuizByPin всегда загружает questions)
      const quiz = await this.quizzesService.getQuizByPin(pin);
      
      this.logger.log(`📤 [Start Question] Обработка запроса на запуск вопроса: PIN=${pin}, questionIndex=${currentQuestionIndex}, totalQuestions=${quiz.questions?.length || 0}, quizStatus=${quiz.status}, userId=${userId?.substring(0, 8) || 'N/A'}...`);

      // 2. Проверка роли (если не установлена, пытаемся определить по userId и creatorId)
      if (role !== 'teacher') {
        // Если role не установлена, пытаемся проверить по userId
        if (!userId) {
          client.emit('error', { 
            message: 'Необходимо сначала подключиться через join-quiz. Отправьте событие join-quiz с role: "teacher" и userId перед отправкой start-question' 
          });
          return { success: false };
        }

        // Проверяем, является ли пользователь создателем квиза
        if (quiz.creatorId === userId) {
          // Автоматически устанавливаем роль учителя
          role = 'teacher';
          client.data.role = 'teacher';
          this.logger.warn(`Автоматически установлена роль teacher для userId ${userId} в квизе ${pin}`);
        } else {
          client.emit('error', { 
            message: 'Только учитель (создатель игры) может запустить вопрос. Убедитесь, что вы отправили join-quiz с role: "teacher" и правильным userId' 
          });
          return { success: false };
        }
      } else {
        // Если роль уже установлена как teacher, дополнительно проверяем userId
        if (quiz.creatorId !== userId) {
          client.emit('error', { 
            message: 'Только создатель игры может запускать вопросы. Проверьте правильность userId в join-quiz' 
          });
          return { success: false };
        }
      }

      // 3. Проверка наличия вопросов
      if (!quiz.questions || quiz.questions.length === 0) {
        client.emit('error', { message: 'У игры нет вопросов' });
        return { success: false };
      }

      // 4. Проверка статуса игры (более понятные сообщения)
      if (quiz.status !== QuizStatus.STARTED) {
        if (quiz.status === QuizStatus.FINISHED) {
          client.emit('error', { 
            message: 'Игра уже завершена. Нельзя запустить новый вопрос после завершения игры.',
            gameStatus: quiz.status,
            currentQuestionIndex: currentQuestionIndex,
            totalQuestions: quiz.questions.length
          });
          this.logger.warn(`Попытка запустить вопрос ${currentQuestionIndex} в завершенной игре ${pin}`);
        } else {
          client.emit('error', { 
            message: `Игра не запущена. Текущий статус: ${quiz.status}. Ожидается: '${QuizStatus.STARTED}'`,
            gameStatus: quiz.status,
            expectedStatus: QuizStatus.STARTED
          });
          this.logger.warn(`Попытка запустить вопрос в игре ${pin} со статусом ${quiz.status}`);
        }
        return { success: false };
      }

      // 6. Валидация индекса вопроса
      if (currentQuestionIndex < 0 || currentQuestionIndex >= quiz.questions.length) {
        client.emit('error', { 
          message: `Неверный индекс вопроса. Доступно вопросов: ${quiz.questions.length}, запрошен индекс: ${currentQuestionIndex}. Допустимый диапазон: 0-${quiz.questions.length - 1}`,
          totalQuestions: quiz.questions.length,
          requestedIndex: currentQuestionIndex,
          validRange: { min: 0, max: quiz.questions.length - 1 }
        });
        this.logger.warn(`Неверный индекс вопроса ${currentQuestionIndex} для игры ${pin} (всего вопросов: ${quiz.questions.length})`);
        return { success: false };
      }

      // 7. Проверка времени предыдущего вопроса (если это не первый вопрос)
      if (currentQuestionIndex > 0) {
        const previousQuestionIndex = currentQuestionIndex - 1;
        const previousQuestion = quiz.questions[previousQuestionIndex];
        
        if (previousQuestion && previousQuestion.timeSeconds) {
          // Получаем время начала предыдущего вопроса
          const quizStartTimes = this.questionStartTimes.get(quiz.id) || new Map();
          const previousQuestionStartTime = quizStartTimes.get(previousQuestionIndex);
          
          if (previousQuestionStartTime) {
            const elapsed = Date.now() - previousQuestionStartTime;
            const minTime = previousQuestion.timeSeconds * 1000; // Время из настроек вопроса в миллисекундах
            
            if (elapsed < minTime) {
              const remainingSeconds = Math.ceil((minTime - elapsed) / 1000);
              client.emit('error', { 
                message: `Время на предыдущий вопрос еще не истекло. Осталось примерно ${remainingSeconds} секунд` 
              });
              return { success: false };
            }
          }
        }
      }

      // 8. Получение текущего вопроса
      const currentQuestion = quiz.questions[currentQuestionIndex];
      if (!currentQuestion) {
        client.emit('error', { message: 'Вопрос не найден' });
        return { success: false };
      }

      // 9. Сохранение времени начала вопроса
      if (!this.questionStartTimes.has(quiz.id)) {
        this.questionStartTimes.set(quiz.id, new Map());
      }
      const quizStartTimes = this.questionStartTimes.get(quiz.id)!;
      quizStartTimes.set(currentQuestionIndex, Date.now());

      // 10. Очистка предыдущего таймера, если есть
      const currentTimer = this.questionTimers.get(quiz.id);
      if (currentTimer && currentTimer.timerId) {
        clearTimeout(currentTimer.timerId);
        this.logger.debug(`🔄 [Backend] Cleared previous timer for quiz ${quiz.id}, question ${currentTimer.questionIndex}`);
      }

      // 11. Установка таймера для автоматического перехода к следующему вопросу
      const timeMs = currentQuestion.timeSeconds * 1000 + 3000; // время вопроса + 3 секунды на просмотр результатов
      const teacherUserId = userId; // Сохраняем userId для использования в таймере
      
      const timerId = setTimeout(async () => {
        this.logger.log(`⏰ [Backend] Timer expired for question ${currentQuestionIndex} in quiz ${quiz.id}`);
        await this.autoAdvanceQuestion(quiz.id, pin, currentQuestionIndex, teacherUserId);
      }, timeMs);

      // Сохраняем информацию о таймере
      this.questionTimers.set(quiz.id, {
        questionIndex: currentQuestionIndex,
        startTime: Date.now(),
        timeSeconds: currentQuestion.timeSeconds,
        timerId,
        pin,
      });

        this.logger.log(`✅ [Start Question] Вопрос ${currentQuestionIndex} запущен: PIN=${pin}, questionId=${currentQuestion.id.substring(0, 8)}..., таймер=${currentQuestion.timeSeconds}с + 3с запас = ${Math.round(timeMs/1000)}с до автоперехода`);

      // 12. Трансляция события start-question всем участникам
      const roomName = `quiz-${pin}`;
      const timestamp = new Date().toISOString();
      
      this.server.to(roomName).emit('start-question', {
        pin,
        currentQuestionIndex,
        questionId: currentQuestion.id,
        timeSeconds: currentQuestion.timeSeconds, // Время из настроек вопроса
        timestamp,
      });

      // 13. Отправка game-update с обновленным currentQuestionIndex
      this.emitGameUpdate(pin, quiz.id, quiz.status, currentQuestionIndex);

      // 14. Также отправляем question-started для совместимости (если используется старый код)
      this.server.to(roomName).emit('question-started', {
        questionId: currentQuestion.id,
        currentQuestionIndex,
        timestamp: Date.now(),
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Error in handleStartQuestion: ${error.message}`, error.stack);
      client.emit('error', { message: error.message || 'Ошибка при запуске вопроса' });
      return { success: false, error: error.message };
    }
  }

  /**
   * Автоматически переходит к следующему вопросу или завершает игру
   * @param quizId - ID игры
   * @param pin - PIN игры
   * @param currentQuestionIndex - Индекс текущего вопроса
   * @param userId - ID пользователя (учителя)
   */
  private async autoAdvanceQuestion(quizId: string, pin: string, currentQuestionIndex: number, userId: string): Promise<void> {
    try {
      const quiz = await this.quizzesService.getQuizByPin(pin);
      
      if (!quiz) {
        this.logger.error(`❌ [Backend] Quiz not found: ${quizId}`);
        // Очищаем таймер
        this.questionTimers.delete(quizId);
        return;
      }

      // Проверяем статус игры
      if (quiz.status !== QuizStatus.STARTED) {
        this.logger.warn(`⚠️ [Backend] Game not in progress, skipping auto-advance. Status: ${quiz.status}, Quiz: ${quiz.id}`);
        // Очищаем таймер
        const timer = this.questionTimers.get(quizId);
        if (timer && timer.timerId) {
          clearTimeout(timer.timerId);
        }
        this.questionTimers.delete(quizId);
        return;
      }

      const nextIndex = currentQuestionIndex + 1;
      const totalQuestions = quiz.questions.length;

      if (nextIndex >= totalQuestions) {
        // Это был последний вопрос - завершаем игру
        this.logger.log(`🏁 [Auto Advance] Последний вопрос завершен, автоматическое завершение игры: PIN=${pin}, questionIndex=${currentQuestionIndex}, totalQuestions=${totalQuestions}`);

        // Очищаем таймер
        const timer = this.questionTimers.get(quizId);
        if (timer && timer.timerId) {
          clearTimeout(timer.timerId);
        }
        this.questionTimers.delete(quizId);

        // Завершаем игру
        await this.quizzesService.finishQuiz(quizId, userId);

        // Получаем финальную позицию каната для логирования
        const finalTugStatus = await this.quizzesService.getTugPosition(quizId);
        const winnerTeam = finalTugStatus.position >= 0 ? '🔴 Красная команда' : '🔵 Синяя команда';
        this.logger.log(`🏁 [Game Finish] Игра завершена (последний вопрос): PIN=${pin}, Победитель: ${winnerTeam}, позиция=${finalTugStatus.position.toFixed(2)}, team1Score=${finalTugStatus.team1Score}, team2Score=${finalTugStatus.team2Score}`);
        
        // Транслируем событие завершения игры (передаем индекс последнего вопроса)
        this.emitGameUpdate(pin, quiz.id, QuizStatus.FINISHED, currentQuestionIndex);
        
        // Автоматически отправляем результаты учителю
        try {
          const results = await this.quizzesService.getResults(quiz.id, userId);
          const roomName = `quiz-${pin}`;
          // Отправляем результаты только учителю (нужно будет фильтровать на фронтенде по userId или role)
          this.server.to(roomName).emit('quiz-results', results);
          this.logger.log(`📊 [Results] Результаты игры отправлены учителю: PIN=${pin}, team1Score=${results.team1.totalScore}, team2Score=${results.team2.totalScore}`);
        } catch (error) {
          this.logger.error(`❌ [Results] Ошибка при отправке результатов: ${error.message}`);
        }
      } else {
        // Переходим к следующему вопросу
        this.logger.log(`⏭️ [Auto Advance] Автоматический переход к следующему вопросу: PIN=${pin}, текущий=${currentQuestionIndex}, следующий=${nextIndex}, всего=${totalQuestions}`);

        const nextQuestion = quiz.questions[nextIndex];

        // Транслируем событие start-question для следующего вопроса
        const roomName = `quiz-${pin}`;
        const timestamp = new Date().toISOString();

        this.server.to(roomName).emit('start-question', {
          pin: pin,
          currentQuestionIndex: nextIndex,
          questionId: nextQuestion.id,
          timeSeconds: nextQuestion.timeSeconds,
          timestamp,
        });

        // Также отправляем game-update
        this.emitGameUpdate(pin, quiz.id, quiz.status, nextIndex);

        // Сохраняем время начала нового вопроса
        if (!this.questionStartTimes.has(quizId)) {
          this.questionStartTimes.set(quizId, new Map());
        }
        const quizStartTimes = this.questionStartTimes.get(quizId)!;
        quizStartTimes.set(nextIndex, Date.now());

        // Устанавливаем таймер для следующего вопроса
        const nextTimeMs = nextQuestion.timeSeconds * 1000 + 3000; // время вопроса + 3 секунды на результаты
        const nextTimerId = setTimeout(() => {
          this.logger.log(`⏰ [Backend] Timer expired for question ${nextIndex} in quiz ${quizId}`);
          this.autoAdvanceQuestion(quizId, pin, nextIndex, userId);
        }, nextTimeMs);

        // Сохраняем информацию о таймере
        this.questionTimers.set(quizId, {
          questionIndex: nextIndex,
          startTime: Date.now(),
          timeSeconds: nextQuestion.timeSeconds,
          timerId: nextTimerId,
          pin,
        });

        this.logger.log(`✅ [Backend] Next question ${nextIndex} started, timer set for quiz ${quizId}: ${nextTimeMs}ms (${nextQuestion.timeSeconds + 3} сек)`);
      }
    } catch (error) {
      this.logger.error(`❌ [Backend] Error in autoAdvanceQuestion: ${error.message}`, error.stack);
      // Очищаем таймер при ошибке
      this.questionTimers.delete(quizId);
    }
  }


  @SubscribeMessage('submit-answer')
  async handleSubmitAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { pin: string; questionId: string; participantId: string; selectedOptionId: string; responseTimeMs: number },
  ) {
    const { pin, questionId, participantId, selectedOptionId, responseTimeMs } = data;
    
    this.logger.log(`📥 [Event Received] submit-answer: PIN=${pin}, questionId=${questionId.substring(0, 8)}..., participantId=${participantId.substring(0, 8)}..., responseTime=${Math.round(responseTimeMs/1000)}с`);

    try {
      // Получаем информацию об участнике для логирования
      const participant = await this.participantRepository.findOne({ 
        where: { id: participantId },
        select: ['id', 'name', 'team'],
      });
      const participantName = participant?.name || 'Unknown';
      const participantTeam = participant?.team === 1 ? '🔴 Красная' : participant?.team === 2 ? '🔵 Синяя' : 'Unknown';
      
      this.logger.log(`📝 [Answer] Ученик ответил: PIN=${pin}, name="${participantName}", team=${participantTeam}, questionId=${questionId.substring(0, 8)}..., responseTime=${Math.round(responseTimeMs/1000)}с`);
      
      const answer = await this.quizzesService.submitAnswer(
        pin,
        questionId,
        participantId,
        {
          participantId,
          selectedOptionId,
          responseTimeMs,
        },
      );

      const roomName = `quiz-${pin}`;
      
      const correctness = answer.isCorrect ? '✅ ПРАВИЛЬНО' : '❌ НЕПРАВИЛЬНО';
      this.logger.log(`📝 [Answer] Результат ответа: "${participantName}" (${participantTeam}) - ${correctness}, responseTime=${Math.round(answer.responseTimeMs/1000)}с`);

      // 1. Отправляем answer-confirmed всем в комнате (фронтенд будет фильтровать по participantId)
      this.server.to(roomName).emit('answer-confirmed', {
        participantId,
        questionId,
        isCorrect: answer.isCorrect,
        responseTimeMs: answer.responseTimeMs,
      });

      // 2. Отправляем обновление позиции каната всем участникам в комнате
      await this.emitTugPositionUpdate(pin);
      
      // Логируем позицию каната
      if (answer.tugStatus) {
        this.logger.log(`🎯 [Tug Position] Обновление позиции каната: PIN=${pin}, position=${answer.tugStatus.position.toFixed(2)}, team1Score=${answer.tugStatus.team1Score}, team2Score=${answer.tugStatus.team2Score}`);
      }
      
      // Если игра автоматически завершилась, отправляем game-update
      if (answer.gameFinished) {
        const quiz = await this.quizzesService.getQuizByPin(pin);
        const winnerTeam = answer.tugStatus.position >= 100 ? '🔴 Красная команда' : '🔵 Синяя команда';
        this.logger.log(`🏁 [Game Finish] Игра автоматически завершена (позиция каната достигла ±100): PIN=${pin}, Победитель: ${winnerTeam}, позиция=${answer.tugStatus.position.toFixed(2)}`);
        this.emitGameUpdate(pin, quiz.id, quiz.status);
        
        // Автоматически отправляем результаты учителю
        try {
          // Получаем userId учителя из участников комнаты (первый учитель в комнате)
          const roomName = `quiz-${pin}`;
          const sockets = await this.server.in(roomName).fetchSockets();
          const teacherSocket = sockets.find(s => s.data.role === 'teacher' && s.data.userId);
          const teacherUserId = teacherSocket?.data.userId;
          
          if (teacherUserId) {
            const results = await this.quizzesService.getResults(quiz.id, teacherUserId);
            this.server.to(roomName).emit('quiz-results', results);
            this.logger.log(`📊 [Results] Результаты игры отправлены учителю: PIN=${pin}, team1Score=${results.team1.totalScore}, team2Score=${results.team2.totalScore}`);
          }
        } catch (error) {
          this.logger.error(`❌ [Results] Ошибка при отправке результатов: ${error.message}`);
        }
      }
      
      return { 
        success: true, 
        isCorrect: answer.isCorrect, 
        tugStatus: answer.tugStatus, 
        gameFinished: answer.gameFinished 
      };
    } catch (error) {
      client.emit('error', { message: error.message });
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('get-tug-position')
  async handleGetTugPosition(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { pin: string },
  ) {
    const { pin } = data;

    try {
      const quiz = await this.quizzesService.getQuizByPin(pin);
      const tugStatus = await this.quizzesService.getTugPosition(quiz.id);

      // Отправляем в новом формате
      client.emit('tug-position-update', {
        pin,
        position: tugStatus.position,
        team1Score: tugStatus.team1Score,
        team2Score: tugStatus.team2Score,
        hasAnswers: tugStatus.hasAnswers,
      });
      
      return { success: true, tugStatus };
    } catch (error) {
      client.emit('error', { message: error.message });
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('finish-question')
  async handleFinishQuestion(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { pin: string; questionId: string },
  ) {
    const { pin, questionId } = data;
    const userId = client.data.userId;

    if (client.data.role !== 'teacher') {
      client.emit('error', { message: 'Только учитель может завершить вопрос' });
      return { success: false };
    }

    try {
      const quiz = await this.quizzesService.getQuizByPin(pin);
      const roomName = `quiz-${pin}`;

      // Проверяем, является ли это последним вопросом
      const timer = this.questionTimers.get(quiz.id);
      const isLastQuestion = timer && quiz.questions.length > 0 && timer.questionIndex === quiz.questions.length - 1;

      // Уведомление всех участников о завершении вопроса
      this.server.to(roomName).emit('question-finished', {
        questionId,
        timestamp: Date.now(),
      });
      
      this.logger.log(`⏹️ [Finish Question] Учитель завершил вопрос вручную: PIN=${pin}, questionId=${questionId.substring(0, 8)}..., isLastQuestion=${isLastQuestion}`);

      // Если это последний вопрос, автоматически завершаем игру
      if (isLastQuestion && quiz.status === QuizStatus.STARTED) {
        // Отменяем таймер автоматического перехода, если он есть
        const currentTimer = this.questionTimers.get(quiz.id);
        if (currentTimer && currentTimer.timerId) {
          clearTimeout(currentTimer.timerId);
          this.questionTimers.delete(quiz.id);
        }

        // Завершаем игру
        await this.quizzesService.finishQuiz(quiz.id, userId);
        
        // Получаем финальную позицию каната для логирования
        const finalTugStatus = await this.quizzesService.getTugPosition(quiz.id);
        const winnerTeam = finalTugStatus.position >= 0 ? '🔴 Красная команда' : '🔵 Синяя команда';
        this.logger.log(`🏁 [Game Finish] Игра завершена (учитель завершил последний вопрос): PIN=${pin}, Победитель: ${winnerTeam}, позиция=${finalTugStatus.position.toFixed(2)}, team1Score=${finalTugStatus.team1Score}, team2Score=${finalTugStatus.team2Score}`);
        
        // Отправляем game-update с финальным статусом (передаем индекс последнего вопроса)
        const lastQuestionIndex = timer ? timer.questionIndex : quiz.questions.length - 1;
        this.emitGameUpdate(pin, quiz.id, QuizStatus.FINISHED, lastQuestionIndex);
        
        // Автоматически отправляем результаты учителю
        try {
          const results = await this.quizzesService.getResults(quiz.id, userId);
          const roomName = `quiz-${pin}`;
          this.server.to(roomName).emit('quiz-results', results);
          this.logger.log(`📊 [Results] Результаты игры отправлены учителю: PIN=${pin}, team1Score=${results.team1.totalScore}, team2Score=${results.team2.totalScore}`);
        } catch (error) {
          this.logger.error(`❌ [Results] Ошибка при отправке результатов: ${error.message}`);
        }
      }

      return { success: true, isLastQuestion };
    } catch (error) {
      this.logger.error(`Ошибка в handleFinishQuestion: ${error.message}`, error.stack);
      client.emit('error', { message: error.message || 'Ошибка при завершении вопроса' });
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('finish-quiz')
  async handleFinishQuiz(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { pin: string; quizId: string; userId: string },
  ) {
    const { pin, quizId, userId } = data;

    if (client.data.role !== 'teacher') {
      client.emit('error', { message: 'Только учитель может завершить игру' });
      return { success: false };
    }

    try {
      this.logger.log(`🛑 [Finish Quiz] Учитель завершил игру вручную: PIN=${pin}, quizId=${quizId}, userId=${userId?.substring(0, 8) || 'N/A'}...`);
      
      const quiz = await this.quizzesService.finishQuiz(quizId, userId);
      
      // Отменяем таймер автоматического перехода, если он есть
      const currentTimer = this.questionTimers.get(quiz.id);
      if (currentTimer && currentTimer.timerId) {
        clearTimeout(currentTimer.timerId);
        this.questionTimers.delete(quiz.id);
      }
      
      // Очищаем данные о времени начала вопросов для этой игры
      this.questionStartTimes.delete(quiz.id);
      
      // Получаем финальную позицию каната для логирования
      const finalTugStatus = await this.quizzesService.getTugPosition(quizId);
      const winnerTeam = finalTugStatus.position >= 0 ? '🔴 Красная команда' : '🔵 Синяя команда';
      this.logger.log(`🏁 [Game Finish] Игра завершена (учитель завершил вручную): PIN=${pin}, Победитель: ${winnerTeam}, позиция=${finalTugStatus.position.toFixed(2)}, team1Score=${finalTugStatus.team1Score}, team2Score=${finalTugStatus.team2Score}`);
      
      // Отправляем game-update с финальным статусом
      // Получаем индекс последнего вопроса из таймера или вычисляем
      const lastQuestionIndex = currentTimer ? currentTimer.questionIndex : (quiz.questions?.length || 1) - 1;
      this.emitGameUpdate(pin, quiz.id, quiz.status, lastQuestionIndex);
      
      // Автоматически отправляем результаты учителю
      try {
        const results = await this.quizzesService.getResults(quiz.id, userId);
        const roomName = `quiz-${pin}`;
        this.server.to(roomName).emit('quiz-results', results);
        this.logger.log(`📊 [Results] Результаты игры отправлены учителю: PIN=${pin}, team1Score=${results.team1.totalScore}, team2Score=${results.team2.totalScore}`);
      } catch (error) {
        this.logger.error(`❌ [Results] Ошибка при отправке результатов: ${error.message}`);
      }

      return { success: true };
    } catch (error) {
      client.emit('error', { message: error.message });
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('get-results')
  async handleGetResults(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { pin: string; quizId: string; userId: string },
  ) {
    const { pin, quizId, userId } = data;

    if (client.data.role !== 'teacher') {
      client.emit('error', { message: 'Только учитель может получить результаты' });
      return { success: false };
    }

    try {
      this.logger.log(`📊 [Get Results] Запрос результатов игры: PIN=${pin}, quizId=${quizId}, userId=${userId?.substring(0, 8) || 'N/A'}...`);
      
      const results = await this.quizzesService.getResults(quizId, userId);

      // Отправка результатов только учителю
      client.emit('results', results);
      
      this.logger.log(`📊 [Get Results] Результаты отправлены: PIN=${pin}, team1Score=${results.team1.totalScore}, team2Score=${results.team2.totalScore}, totalParticipants=${results.quiz.totalParticipants}`);

      return { success: true };
    } catch (error) {
      client.emit('error', { message: error.message });
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('get-participants')
  async handleGetParticipants(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { pin: string; userId: string },
  ) {
    const { pin, userId } = data;

    if (client.data.role !== 'teacher') {
      client.emit('error', { message: 'Только учитель может получить список участников' });
      return { success: false };
    }

    try {
      const participantsData = await this.quizzesService.getParticipantsByPin(pin, userId);
      client.emit('participants-update', {
        pin,
        participants: participantsData.participants,
      });
      return { success: true, participants: participantsData.participants };
    } catch (error) {
      client.emit('error', { message: error.message });
      return { success: false, error: error.message };
    }
  }
}

