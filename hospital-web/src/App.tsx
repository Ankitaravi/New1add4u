import { useEffect, useState } from 'react';
import { ApiError, User, api, getToken, setToken } from './api';
import { Dashboard } from './Dashboard';
import { Login } from './Login';

const ALLOWED = ['HOSPITAL_ADMIN', 'SUPER_ADMIN'];

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!getToken());

  useEffect(() => {
    if (!getToken()) return;
    api<User>('/auth/me')
      .then(setUser)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const logout = () => {
    api('/auth/logout', { method: 'POST' }).catch(() => {});
    setToken(null);
    setUser(null);
  };

  if (loading) return <p className="center muted">Loading…</p>;
  if (!user) return <Login onLogin={setUser} />;
  if (!ALLOWED.includes(user.role)) {
    return (
      <div className="card narrow">
        <h1>Hospital admin access only</h1>
        <p className="muted">This account ({user.phone}) is a {user.role.toLowerCase()} account.</p>
        <button onClick={logout}>Sign out</button>
      </div>
    );
  }
  return <Dashboard user={user} onLogout={logout} />;
}
