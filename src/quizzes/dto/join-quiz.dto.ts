import { IsString, IsNotEmpty, IsInt, IsEnum, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Team } from '../../participants/entities/participant.entity';

export class JoinQuizDto {
  @ApiProperty({
    description: 'Имя участника. Должно быть уникальным в рамках одной игры.',
    example: 'Иван Иванов',
    minLength: 2,
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  name: string;

  @ApiProperty({
    description: 'Команда участника. 1 = Команда 1, 2 = Команда 2. Участники одной команды соревнуются вместе.',
    enum: Team,
    example: 1,
    required: true,
  })
  @IsInt()
  @IsEnum(Team)
  team: Team;
}

