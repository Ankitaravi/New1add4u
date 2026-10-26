import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { IsString, Matches, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { Public } from './roles';

class RequestOtpDto {
  @Matches(/^\d{10}$/, { message: 'phone must be 10 digits' })
  phone: string;
}
class VerifyOtpDto extends RequestOtpDto {
  @IsString() @MinLength(1) challengeId: string;
  @IsString() @MinLength(1) code: string;
}
class RefreshDto {
  @IsString() @MinLength(1) refreshToken: string;
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public() @Post('otp/request')
  request(@Body() b: RequestOtpDto) {
    return this.auth.requestOtp(b.phone);
  }

  @Public() @Post('otp/verify')
  verify(@Body() b: VerifyOtpDto) {
    return this.auth.verifyOtp(b.challengeId, b.phone, b.code);
  }

  @Public() @Post('refresh') @HttpCode(200)
  refresh(@Body() b: RefreshDto) {
    return this.auth.refresh(b.refreshToken);
  }

  /** Public: it is called when the access token may already be gone; the refresh token authorises it. */
  @Public() @Post('logout') @HttpCode(200)
  logout(@Body() b: RefreshDto) {
    return this.auth.logout(b.refreshToken);
  }

  @Get('me')
  me(@Req() req: any) {
    return req.user;
  }
}
