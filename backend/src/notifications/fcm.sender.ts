import { Injectable, Logger } from '@nestjs/common';
import { PushSender } from './push';

const DEAD = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'];

/**
 * Firebase Cloud Messaging via firebase-admin. Enabled when FIREBASE_SERVICE_ACCOUNT
 * (the service-account JSON, as a string) is set; otherwise pushes are skipped and
 * only the in-app notification row is stored.
 */
@Injectable()
export class FcmSender implements PushSender {
  private log = new Logger('FCM');
  private messaging: any;

  private async init() {
    if (this.messaging !== undefined) return this.messaging;
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) return (this.messaging = null);
    const { initializeApp, getApps, cert } = await import('firebase-admin/app');
    const { getMessaging } = await import('firebase-admin/messaging');
    const app = getApps()[0] ?? initializeApp({ credential: cert(JSON.parse(raw)) });
    return (this.messaging = getMessaging(app));
  }

  async send(tokens: string[], title: string, body: string): Promise<string[]> {
    if (!tokens.length) return [];
    const m = await this.init();
    if (!m) return [];
    const res = await m.sendEachForMulticast({ tokens, notification: { title, body } });
    return res.responses.flatMap((r: any, i: number) => (!r.success && DEAD.includes(r.error?.code) ? [tokens[i]] : []));
  }
}
