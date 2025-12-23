import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AppService } from './app.service';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  
  // Настройка CORS для всех источников (для деплоя на Railway и других платформах)
  app.enableCors({
    origin: '*', // Разрешить все источники (самый простой способ для деплоя)
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-User-Id', 'Origin', 'X-Requested-With'],
    exposedHeaders: ['Content-Length', 'Content-Type'],
    credentials: false, // Должно быть false при origin: '*'
    maxAge: 86400, // 24 часа кеширования preflight запросов
  });
  
  // Включение валидации
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  
  // Настройка Swagger
  const config = new DocumentBuilder()
    .setTitle('Quiz Server API')
    .setDescription(
      `# Система викторин с реальным временем

## Описание
API для создания и проведения интерактивных викторин в реальном времени с системой перетягивания каната между командами.

## Основной flow:

### Для учителя:
1. **Регистрация/Вход**: POST /auth/register или POST /auth/login
2. **Создание теста**: POST /teacher/quizzes (получаете PIN-код)
3. **Просмотр участников**: GET /teacher/quizzes/pin/:pin/participants
4. **Запуск игры**: POST /teacher/quizzes/:quizId/start
5. **Запуск вопроса**: WebSocket событие 'start-question'
6. **Просмотр позиции каната**: GET /teacher/quizzes/:quizId/tug-position
7. **Завершение игры**: POST /teacher/quizzes/:quizId/finish
8. **Результаты**: GET /teacher/quizzes/:quizId/results

### Для ученика:
1. **Получение информации о тесте**: GET /student/quizzes/pin/:pin
2. **Присоединение к игре**: POST /student/quizzes/pin/:pin/join (получаете participantId)
3. **Подключение к WebSocket**: namespace '/quiz', событие 'join-quiz'
4. **Отправка ответа**: WebSocket событие 'submit-answer' или POST /student/quizzes/pin/:pin/questions/:questionId/answer
5. **Получение обновлений**: Слушать события 'tug-position-updated', 'question-started', 'question-finished'

## WebSocket события (namespace: /quiz):

### От клиента:
- \`join-quiz\` - Присоединиться к игре
- \`submit-answer\` - Отправить ответ на вопрос
- \`get-tug-position\` - Получить текущую позицию каната
- \`get-participants\` - Получить список участников (только учитель)
- \`start-quiz\` - Запустить игру (только учитель)
- \`start-question\` - Запустить вопрос (только учитель)
- \`finish-question\` - Завершить вопрос (только учитель)
- \`finish-quiz\` - Завершить игру (только учитель)

### От сервера:
- \`quiz-info\` - Информация о тесте
- \`participant-joined\` - Новый участник присоединился
- \`new-participant\` - Уведомление учителю о новом участнике
- \`quiz-started\` - Игра запущена
- \`question-started\` - Вопрос запущен
- \`answer-submitted\` - Ответ отправлен (для учителя)
- \`answer-confirmed\` - Ответ подтвержден (для ученика)
- \`tug-position-updated\` - Обновление позиции каната
- \`question-finished\` - Вопрос завершен
- \`quiz-finished\` - Игра завершена
- \`participants-list\` - Список участников
- \`tug-position\` - Текущая позиция каната
- \`error\` - Ошибка

## Позиция каната:
- **position**: от -100 (команда 2 побеждает) до +100 (команда 1 побеждает)
- **hasAnswers**: false - если нет ответов (начальное состояние), true - если есть ответы
- **team1Score**: Баллы команды 1 = (правильные ответы × 50) + (средняя скорость × 10)
- **team2Score**: Баллы команды 2 = (правильные ответы × 50) + (средняя скорость × 10)

## Авторизация:
- **Учителя**: Требуется заголовок \`X-User-Id\` с ID пользователя
- **Ученики**: Авторизация не требуется, работают через PIN-код`,
    )
    .setVersion('1.0')
    .addTag('auth', '🔐 Авторизация и регистрация')
    .addTag('health', '💚 Проверка состояния сервера')
    .addTag('Teacher - Quizzes', '👨‍🏫 Эндпоинты для учителей (создание и управление тестами)')
    .addTag('Student - Quizzes', '👨‍🎓 Эндпоинты для учеников (присоединение и ответы)')
    .addApiKey(
      { type: 'apiKey', name: 'X-User-Id', in: 'header', description: 'ID пользователя (для учителей). Получите его после регистрации/входа.' },
      'X-User-Id',
    )
    .addServer('http://localhost:3001', 'Локальный сервер разработки')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);
  
  // Проверка подключения к БД
  const appService = app.get(AppService);
  const dbStatus = await appService.checkDatabaseConnection();
  
  if (dbStatus.status === 'connected') {
    logger.log(`✅ База данных подключена: ${dbStatus.database}`);
  } else {
    logger.error(`❌ Ошибка подключения к БД: ${dbStatus.message}`);
  }
  
  // Railway и другие платформы предоставляют PORT через переменную окружения
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
  await app.listen(port, '0.0.0.0'); // Слушаем на всех интерфейсах для деплоя
  logger.log(`🚀 Приложение запущено на порту ${port}`);
  logger.log(`📊 Доступные эндпоинты:`);
  logger.log(`   - GET http://localhost:${port}/`);
  logger.log(`   - GET http://localhost:${port}/health/db`);
  logger.log(`   - POST http://localhost:${port}/auth/register`);
  logger.log(`   - POST http://localhost:${port}/auth/login`);
  logger.log(`📚 Swagger документация: http://localhost:${port}/api`);
}
bootstrap();
