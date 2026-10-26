import { FormEvent, useState } from 'react';
import { User, api, setTokens } from './api';

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const sent = challengeId !== null;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const send = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api<{ challengeId: string }>('/auth/otp/request', { method: 'POST', body: { phone } });
      setChallengeId(r.challengeId);
    });
  };
  const verify = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api<{ accessToken: string; refreshToken: string; user: User; adminApprovalRequired: boolean }>(
        '/auth/otp/verify',
        { method: 'POST', body: { challengeId, phone, code: otp } },
      );
      if (r.adminApprovalRequired) throw new Error('This account cannot sign in here');
      setTokens(r);
      onLogin(r.user);
    });
  };

  return (
    <form className="card narrow" onSubmit={sent ? verify : send}>
      <h1>1ADD4U Hospital</h1>
      <p className="muted">Sign in with the phone number registered to your hospital account.</p>
      <label>
        Phone number
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" maxLength={10} disabled={sent} placeholder="10 digits" autoFocus />
      </label>
      {sent && (
        <label>
          OTP
          <input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" maxLength={6} autoFocus />
        </label>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <button disabled={busy || phone.length !== 10 || (sent && otp.length < 4)}>{sent ? 'Verify & sign in' : 'Send OTP'}</button>
      {sent && (
        <button type="button" className="link" onClick={() => { setChallengeId(null); setOtp(''); }}>
          Use a different number
        </button>
      )}
    </form>
  );
}
