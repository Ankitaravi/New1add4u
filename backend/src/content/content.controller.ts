import {
  BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, Req,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '../generated/prisma/client';
import { Roles } from '../auth/roles';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

class ArticleDto {
  @IsString() @MinLength(3) @MaxLength(200) title: string;
  @IsString() @MinLength(20) body: string;
}
class UpdateArticleDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MinLength(20) body?: string;
}
class ModerateDto {
  @IsIn(['APPROVED', 'REJECTED']) status: 'APPROVED' | 'REJECTED';
  @IsOptional() @IsString() @MinLength(3) note?: string;
}

const AUTHOR = { select: { id: true, name: true, role: true } };

@Controller('content/articles')
export class ContentController {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  /** Verified doctors and students may write; everything goes through moderation. */
  @Post() @Roles(Role.DOCTOR, Role.STUDENT)
  async create(@Req() req: any, @Body() b: ArticleDto) {
    if (req.user.role === 'DOCTOR') {
      const d = await this.prisma.doctor.findUnique({ where: { userId: req.user.id } });
      if (!d?.isVerified) throw new ForbiddenException('Only verified doctors can publish articles');
    }
    return this.prisma.article.create({ data: { ...b, authorId: req.user.id } });
  }

  @Get()
  list(@Query('q') q?: string, @Query('page') page = '1', @Query('limit') limit = '20') {
    const take = Math.min(Math.max(parseInt(limit) || 20, 1), 50);
    const skip = (Math.max(parseInt(page) || 1, 1) - 1) * take;
    return this.prisma.article.findMany({
      where: { status: 'APPROVED', ...(q && { OR: [{ title: { contains: q, mode: 'insensitive' } }, { body: { contains: q, mode: 'insensitive' } }] }) },
      include: { author: AUTHOR },
      orderBy: { createdAt: 'desc' },
      take, skip,
    });
  }

  @Get('mine')
  mine(@Req() req: any) {
    return this.prisma.article.findMany({ where: { authorId: req.user.id }, orderBy: { createdAt: 'desc' } });
  }

  @Get('pending') @Roles(Role.HOSPITAL_ADMIN)
  pending() {
    return this.prisma.article.findMany({ where: { status: 'PENDING' }, include: { author: AUTHOR }, orderBy: { createdAt: 'asc' } });
  }

  @Get(':id')
  async one(@Req() req: any, @Param('id') id: string) {
    const a = await this.prisma.article.findUnique({ where: { id }, include: { author: AUTHOR } });
    const privileged = a && (a.authorId === req.user.id || ['HOSPITAL_ADMIN', 'SUPER_ADMIN'].includes(req.user.role));
    if (!a || (a.status !== 'APPROVED' && !privileged)) throw new NotFoundException('Article not found');
    return a;
  }

  /** Editing sends the article back to moderation. */
  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() b: UpdateArticleDto) {
    const { count } = await this.prisma.article.updateMany({
      where: { id, authorId: req.user.id },
      data: { ...b, status: 'PENDING', moderationNote: null },
    });
    if (!count) throw new NotFoundException('Article not found');
    return this.prisma.article.findUnique({ where: { id } });
  }

  @Patch(':id/moderate') @Roles(Role.HOSPITAL_ADMIN)
  async moderate(@Param('id') id: string, @Body() b: ModerateDto) {
    if (b.status === 'REJECTED' && !b.note) throw new BadRequestException('A rejection needs a note for the author');
    const a = await this.prisma.article.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Article not found');
    const u = await this.prisma.article.update({ where: { id }, data: { status: b.status, moderationNote: b.note ?? null } });
    await this.notifications.notify(
      a.authorId,
      b.status === 'APPROVED' ? 'Article approved' : 'Article needs changes',
      b.status === 'APPROVED' ? `"${a.title}" is now published.` : `"${a.title}" was not approved: ${b.note}`,
    );
    return u;
  }
}
