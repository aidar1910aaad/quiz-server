import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class AppService {
  constructor(
    @InjectDataSource()
    private dataSource: DataSource,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  async checkDatabaseConnection(): Promise<{ status: string; message: string; database?: string }> {
    try {
      const result = await this.dataSource.query('SELECT NOW() as current_time, current_database() as database');
      return {
        status: 'connected',
        message: 'База данных успешно подключена',
        database: result[0]?.database || 'unknown',
      };
    } catch (error) {
      return {
        status: 'error',
        message: `Ошибка подключения к базе данных: ${error.message}`,
      };
    }
  }
}
