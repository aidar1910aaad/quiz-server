import { IsString, IsNotEmpty, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitAnswerDto {
  @ApiProperty({
    description: 'ID участника. Получите его при присоединении к игре (POST /student/quizzes/pin/:pin/join)',
    example: 'uuid',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  participantId: string;

  @ApiProperty({
    description: 'ID выбранного варианта ответа. Получите из информации о тесте (GET /student/quizzes/pin/:pin)',
    example: 'uuid',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  selectedOptionId: string;

  @ApiProperty({
    description: 'Время ответа в миллисекундах. Время от начала вопроса до отправки ответа. Используется для расчета скорости команды.',
    example: 5000,
    minimum: 0,
    required: true,
  })
  @IsInt()
  @Min(0)
  responseTimeMs: number;
}

