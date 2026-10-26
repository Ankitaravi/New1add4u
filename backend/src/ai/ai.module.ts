import { Module } from '@nestjs/common';
import { AI_PROVIDER, ClaudeProvider } from './ai.provider';
import { AiController } from './ai.controller';

@Module({ controllers: [AiController], providers: [{ provide: AI_PROVIDER, useClass: ClaudeProvider }] })
export class AiModule {}
