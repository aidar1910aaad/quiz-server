import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Регистрация нового пользователя (учителя)',
    description: `Регистрирует нового пользователя в системе. После регистрации вы получите user.id, который нужно использовать в заголовке X-User-Id для доступа к эндпоинтам учителя.
    
**Важно:**
- email должен быть уникальным
- password минимум 6 символов
- fullName минимум 2 символа`,
  })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ 
    status: 201, 
    description: 'Пользователь успешно зарегистрирован',
    schema: {
      example: {
        message: 'Пользователь успешно зарегистрирован',
        user: {
          id: 'uuid',
          email: 'user@example.com',
          fullName: 'Иванов Иван Иванович',
          createdAt: '2025-12-15T12:00:00.000Z'
        }
      }
    }
  })
  @ApiResponse({ status: 409, description: 'Пользователь с таким email уже существует' })
  @ApiResponse({ status: 400, description: 'Ошибка валидации данных' })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Вход в систему (для учителя)',
    description: `Вход в систему для учителя. После успешного входа вы получите user.id, который нужно использовать в заголовке X-User-Id для доступа к эндпоинтам учителя.
    
**Использование:**
1. Выполните вход через этот эндпоинт
2. Сохраните user.id из ответа
3. Используйте user.id в заголовке X-User-Id для всех запросов к /teacher/quizzes/*`,
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Успешный вход',
    schema: {
      example: {
        message: 'Успешный вход',
        user: {
          id: 'uuid',
          email: 'user@example.com',
          fullName: 'Иванов Иван Иванович',
          createdAt: '2025-12-15T12:00:00.000Z'
        }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Неверный email или пароль' })
  @ApiResponse({ status: 400, description: 'Ошибка валидации данных' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }
}

