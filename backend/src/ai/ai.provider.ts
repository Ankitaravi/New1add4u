import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

export const AI_PROVIDER = 'AI_PROVIDER';

export interface AiProvider {
  /** Returns the model's raw text reply. Throws ServiceUnavailableException if AI is not configured. */
  complete(system: string, user: string): Promise<string>;
}

/** Claude via the Messages API. Needs ANTHROPIC_API_KEY; model overridable with AI_MODEL. */
@Injectable()
export class ClaudeProvider implements AiProvider {
  private log = new Logger('AI');

  async complete(system: string, user: string): Promise<string> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new ServiceUnavailableException('AI features are not configured');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.AI_MODEL ?? 'claude-sonnet-5-5',
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      this.log.error(`Messages API ${res.status}: ${await res.text()}`);
      throw new ServiceUnavailableException('AI service is temporarily unavailable');
    }
    const data: any = await res.json();
    return (data.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  }
}
