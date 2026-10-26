export const PUSH_SENDER = 'PUSH_SENDER';

export interface PushSender {
  /** Returns the subset of `tokens` that FCM reports as no longer valid. */
  send(tokens: string[], title: string, body: string): Promise<string[]>;
}
