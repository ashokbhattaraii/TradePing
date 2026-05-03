import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PermissionsService } from './permissions.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PermissionsService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
  exports: [AuthService, PermissionsService],
})
export class AuthModule {}
