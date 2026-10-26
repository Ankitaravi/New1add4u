import { FormEvent, useState } from 'react';
import { User, api, setToken } from './api';

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
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
      await api('/auth/otp/send', { method: 'POST', body: { phone } });
      setSent(true);
    });
  };
  const verify = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api<{ token: string; user: User }>('/auth/otp/verify', { method: 'POST', body: { phone, otp } });
      setToken(r.token);
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
        <button type="button" className="link" onClick={() => { setSent(false); setOtp(''); }}>
          Use a different number
        </button>
      )}
    </form>
  );
}
