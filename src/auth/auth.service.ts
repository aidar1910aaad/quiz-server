import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async register(registerDto: RegisterDto): Promise<{ message: string; user: UserResponseDto }> {
    const { email, fullName, password } = registerDto;

    // Проверка существования пользователя (только email для ускорения)
    const existingUser = await this.userRepository.findOne({ 
      where: { email },
      select: ['id'], // Выбираем только id для ускорения
    });
    if (existingUser) {
      throw new ConflictException('Пользователь с таким email уже существует');
    }

    // Хеширование пароля
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Создание пользователя
    const user = this.userRepository.create({
      email,
      fullName,
      password: hashedPassword,
    });

    const savedUser = await this.userRepository.save(user);

    // Удаляем пароль из ответа
    const { password: _, ...userWithoutPassword } = savedUser;

    return {
      message: 'Пользователь успешно зарегистрирован',
      user: userWithoutPassword as UserResponseDto,
    };
  }

  async login(loginDto: LoginDto): Promise<{ message: string; user: UserResponseDto }> {
    const { email, password } = loginDto;

    // Поиск пользователя (выбираем только нужные поля)
    const user = await this.userRepository.findOne({ 
      where: { email },
      select: ['id', 'email', 'fullName', 'password', 'createdAt'], // Явно указываем поля
    });
    if (!user) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    // Проверка пароля
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    // Удаляем пароль из ответа
    const { password: _, ...userWithoutPassword } = user;

    return {
      message: 'Успешный вход',
      user: userWithoutPassword as UserResponseDto,
    };
  }
}

