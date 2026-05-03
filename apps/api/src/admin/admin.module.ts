import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminUsersController } from './users.controller';
import { AdminRolesController } from './roles.controller';
import { AdminUsersService } from './users.service';
import { AdminRolesService } from './roles.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminUsersController, AdminRolesController],
  providers: [AdminUsersService, AdminRolesService],
})
export class AdminModule {}
