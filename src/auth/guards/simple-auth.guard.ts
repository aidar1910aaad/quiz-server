import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Injectable()
export class SimpleAuthGuard implements CanActivate {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    
    // Простая авторизация через заголовок X-User-Id
    const userId = request.headers['x-user-id'] || request.body?.userId || request.query?.userId;

    if (!userId) {
      throw new UnauthorizedException('Требуется авторизация. Передайте X-User-Id в заголовке или userId в body/query');
    }

    // Проверка существования пользователя
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id'],
    });

    if (!user) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    // Добавляем пользователя в запрос
    request.user = { id: user.id };

    return true;
  }
}



