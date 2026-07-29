// backend/src/auth/auth.controller.ts
import { Controller, Get, Req, Res, UseGuards, Post, Body, HttpCode, HttpStatus, Delete, Param } from '@nestjs/common';
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
    const frontendUrl = process.env.FRONTEND_URL;
    const user = req.user; // Extraemos al usuario

    // 👇 Verificamos si tiene 2FA activado ANTES de darle el JWT
    if (user.isTwoFactorEnabled) {
      // Si tiene 2FA, lo mandamos al frontend enviando su ID por la URL, SIN el token final
      res.redirect(`${frontendUrl}/?requires2FA=${user.id}`);
    } else {
      // Si no tiene 2FA, el flujo normal: generamos JWT y lo dejamos pasar
      const jwt = this.authService.generateJwt(user);
      res.redirect(`${frontendUrl}/?token=${jwt}`);
    }
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED) // Devuelve 201 Created
  async register(@Body() body: { email: string; nickname: string; passwordPlain: string }) {
    return await this.authService.registerLocalUser(body.email, body.nickname, body.passwordPlain);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK) // Devuelve 200 OK
  async verifyOtp(@Body() body: { email: string; otpCode: string }) {
    return await this.authService.verifyOtp(body.email, body.otpCode);
  }


  @Post('login')
  @HttpCode(HttpStatus.OK) // Devuelve 200 OK
  async loginLocal(@Body() body: { email: string; passwordPlain: string }) {
    return await this.authService.loginLocal(body.email, body.passwordPlain);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() body: { email: string }) {
    return await this.authService.forgotPassword(body.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() body: { token: string; newPasswordPlain: string }) {
    return await this.authService.resetPassword(body.token, body.newPasswordPlain);
  }


  @Post('2fa/generate')
  @HttpCode(HttpStatus.OK)
  async generateTwoFactorSecret(@Body() body: { userId: string }) {
    return await this.authService.generateTwoFactorSecret(body.userId);
  }

  @Post('2fa/turn-on')
  @HttpCode(HttpStatus.OK)
  async turnOnTwoFactorAuthentication(@Body() body: { userId: string; token: string }) {
    return await this.authService.turnOnTwoFactorAuthentication(body.userId, body.token);
  }

  @Post('2fa/authenticate')
  @HttpCode(HttpStatus.OK)
  async authenticate2fa(@Body() body: { userId: string; token: string }) {
    return await this.authService.loginWith2fa(body.userId, body.token);
  }

  @Delete('account/:id')
  @HttpCode(HttpStatus.OK)
  async deleteAccount(@Param('id') id: string) {
    return await this.authService.deleteAccount(id);
  }
}