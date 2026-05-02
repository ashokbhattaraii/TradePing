import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.guard';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('google')
  async google(@Body() body: { credential?: string }) {
    return { success: true, data: await this.auth.signInWithGoogle(body.credential ?? '') };
  }

  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return { success: true, data: req.authUser };
  }

  @Post('logout')
  logout() {
    return { success: true, data: { ok: true } };
  }
}
