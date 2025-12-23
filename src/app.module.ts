import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { QuizzesModule } from './quizzes/quizzes.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        // Используем URL из переменных окружения
        const databaseUrl = configService.get<string>('DATABASE_URL') || configService.get<string>('DATABASE_PUBLIC_URL');
        
        // Определяем провайдера БД для правильной настройки SSL
        const isNeon = databaseUrl?.includes('neon.tech');
        const isRailway = databaseUrl?.includes('proxy.rlwy.net');
        
        const config: any = {
          type: 'postgres',
          url: databaseUrl,
          autoLoadEntities: true,
          synchronize: true,
          logging: false,
          extra: {
            // Оптимизация пула для удаленной БД
            max: 5, // Увеличиваем для Neon (более стабильный)
            min: 1,
            connectionTimeoutMillis: 20000, // 20 секунд
            idleTimeoutMillis: 30000, // 30 секунд
            // Настройки для стабильности соединения
            keepAlive: true,
            keepAliveInitialDelayMillis: 0,
            application_name: 'quiz-server',
            // Примечание: Neon не поддерживает параметры в options при использовании pooled connection
          },
        };
        
        // SSL настройки в зависимости от провайдера
        if (isNeon) {
          // Neon использует стандартные SSL сертификаты
          config.ssl = {
            rejectUnauthorized: true, // Neon использует валидные сертификаты
          };
        } else if (isRailway) {
          // Railway использует самоподписанные сертификаты
          config.ssl = {
            rejectUnauthorized: false,
          };
          config.extra.ssl = {
            rejectUnauthorized: false,
          };
        }
        
        return config;
      },
      inject: [ConfigService],
    }),
    AuthModule,
    QuizzesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
