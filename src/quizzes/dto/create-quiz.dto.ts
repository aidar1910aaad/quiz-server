import { IsString, IsNotEmpty, IsArray, ValidateNested, MinLength, IsInt, Min, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAnswerOptionDto {
  @ApiProperty({
    description: 'Текст варианта ответа',
    example: 'Вариант 1',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  text: string;

  @ApiProperty({
    description: 'Порядковый номер варианта (1-4). Должен быть уникальным в рамках вопроса.',
    example: 1,
    minimum: 1,
    maximum: 4,
  })
  @IsInt()
  @Min(1)
  order: number;
}

export class CreateQuestionDto {
  @ApiProperty({
    description: 'Текст вопроса',
    example: 'Сколько будет 2+2?',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  text: string;

  @ApiProperty({
    description: 'Время на ответ в секундах. Участники должны ответить в течение этого времени.',
    example: 30,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  timeSeconds: number;

  @ApiProperty({
    description: 'Порядковый номер правильного варианта ответа (1-4). Должен соответствовать order одного из вариантов в массиве options.',
    example: 1,
    minimum: 1,
    maximum: 4,
  })
  @IsInt()
  @Min(1)
  correctAnswerOrder: number;

  @ApiProperty({
    description: 'Варианты ответов. Должно быть ровно 4 варианта с order от 1 до 4.',
    type: [CreateAnswerOptionDto],
    example: [
      { text: '3', order: 1 },
      { text: '4', order: 2 },
      { text: '5', order: 3 },
      { text: '6', order: 4 },
    ],
    minItems: 4,
    maxItems: 4,
  })
  @IsArray()
  @ArrayMinSize(4)
  @ValidateNested({ each: true })
  @Type(() => CreateAnswerOptionDto)
  options: CreateAnswerOptionDto[];

  @ApiProperty({
    description: 'Порядок вопроса в тесте. Вопросы будут отображаться в порядке возрастания этого значения.',
    example: 1,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  order: number;
}

export class CreateQuizDto {
  @ApiProperty({
    description: 'Название теста. Будет отображаться участникам.',
    example: 'Математика для 5 класса',
    minLength: 3,
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  title: string;

  @ApiProperty({
    description: 'Список вопросов. Минимум 1 вопрос. После создания теста будет автоматически сгенерирован уникальный 6-значный PIN-код.',
    type: [CreateQuestionDto],
    example: [
      {
        text: 'Сколько будет 2+2?',
        timeSeconds: 30,
        correctAnswerOrder: 2,
        options: [
          { text: '3', order: 1 },
          { text: '4', order: 2 },
          { text: '5', order: 3 },
          { text: '6', order: 4 },
        ],
        order: 1,
      },
    ],
    minItems: 1,
    required: true,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionDto)
  questions: CreateQuestionDto[];
}

