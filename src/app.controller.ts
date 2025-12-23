import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Главная страница' })
  @ApiResponse({ status: 200, description: 'Приветственное сообщение' })
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health/db')
  @ApiOperation({ summary: 'Проверка подключения к базе данных' })
  @ApiResponse({ 
    status: 200, 
    description: 'Статус подключения к БД',
    schema: {
      example: {
        status: 'connected',
        message: 'База данных успешно подключена',
        database: 'railway'
      }
    }
  })
  async checkDatabase() {
    return await this.appService.checkDatabaseConnection();
  }
}
