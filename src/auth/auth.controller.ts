// backend/src/auth/auth.controller.ts
import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {} 

  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth(@Req() req) {}

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  googleAuthRedirect(@Req() req, @Res() res) {
 
    const jwt = this.authService.generateJwt(req.user);

    const frontendUrl = process.env.FRONTEND_URL;
    //res.redirect(`${frontendUrl}/login?token=${jwt}`);
    res.redirect(`${frontendUrl}/?token=${jwt}`);
  }
}