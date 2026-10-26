import { Body, Controller, Get, Headers, Post, Req } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import { AuthService } from './auth.service';
import { Public } from './roles';

class SendOtpDto {
  @Matches(/^\d{10}$/, { message: 'phone must be 10 digits' })
  phone: string;
}
class VerifyOtpDto extends SendOtpDto {
  @IsString()
  otp: string;
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public() @Post('otp/send')
  send(@Body() b: SendOtpDto) {
    return this.auth.sendOtp(b.phone);
  }

  @Public() @Post('otp/verify')
  verify(@Body() b: VerifyOtpDto) {
    return this.auth.verifyOtp(b.phone, b.otp);
  }

  @Get('me')
  me(@Req() req: any) {
    return req.user;
  }

  @Post('logout')
  logout(@Headers('authorization') h: string) {
    return this.auth.logout(h.slice(7));
  }
}
