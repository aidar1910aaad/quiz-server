import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SimpleAuthGuard } from './guards/simple-auth.guard';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [AuthController],
  providers: [AuthService, SimpleAuthGuard],
  exports: [SimpleAuthGuard],
})
export class AuthModule {}

