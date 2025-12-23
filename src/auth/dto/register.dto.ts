import { IsEmail, IsString, MinLength, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({
    description: 'Email пользователя',
    example: 'user@example.com',
  })
  @IsEmail({}, { message: 'Некорректный email' })
  @IsNotEmpty({ message: 'Email обязателен' })
  email: string;

  @ApiProperty({
    description: 'Полное имя пользователя (ФИО)',
    example: 'Иванов Иван Иванович',
    minLength: 2,
  })
  @IsString({ message: 'ФИО должно быть строкой' })
  @IsNotEmpty({ message: 'ФИО обязательно' })
  @MinLength(2, { message: 'ФИО должно содержать минимум 2 символа' })
  fullName: string;

  @ApiProperty({
    description: 'Пароль пользователя',
    example: 'password123',
    minLength: 6,
  })
  @IsString({ message: 'Пароль должен быть строкой' })
  @IsNotEmpty({ message: 'Пароль обязателен' })
  @MinLength(6, { message: 'Пароль должен содержать минимум 6 символов' })
  password: string;
}

