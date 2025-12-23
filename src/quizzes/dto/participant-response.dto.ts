import { ApiProperty } from '@nestjs/swagger';

export class ParticipantResponseDto {
  @ApiProperty({ description: 'ID участника (используйте для отправки ответов)', example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' })
  participantId: string;

  @ApiProperty({ description: 'ID игры', example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' })
  quizId: string;

  @ApiProperty({ description: 'Имя участника', example: 'Иван Иванов' })
  name: string;

  @ApiProperty({ description: 'Команда (1 или 2)', enum: [1, 2], example: 1 })
  team: number;

  @ApiProperty({ description: 'PIN-код игры', example: '123456' })
  pin: string;

  @ApiProperty({ description: 'Дата присоединения', example: '2025-12-16T12:00:00.000Z' })
  joinedAt: Date;
}



