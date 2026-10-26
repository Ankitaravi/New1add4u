import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiError, AppointmentRow, Department, DoctorRow, Hospital, Stats, User, api, rupees } from './api';

type Tab = 'overview' | 'appointments' | 'doctors' | 'departments';
const TABS: [Tab, string][] = [['overview', 'Overview'], ['appointments', 'Appointments'], ['doctors', 'Doctors'], ['departments', 'Departments']];

export function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [hospital, setHospital] = useState<Hospital | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('overview');

  useEffect(() => {
    api<Hospital>('/hospitals/profile')
      .then(setHospital)
      .catch((e) => (e instanceof ApiError && e.status === 404 ? setHospital(null) : Promise.reject(e)));
  }, []);

  if (hospital === undefined) return <p className="center muted">Loading…</p>;
  if (hospital === null) return <CreateHospital onCreated={setHospital} />;

  return (
    <div className="shell">
      <header>
        <div>
          <strong>{hospital.name}</strong>
          {hospital.city && <span className="muted"> · {hospital.city}</span>}
        </div>
        <div className="row">
          <span className="muted">{user.name ?? user.phone}</span>
          <button className="link" onClick={onLogout}>Sign out</button>
        </div>
      </header>
      <nav>
        {TABS.map(([id, label]) => (
          <button key={id} className={id === tab ? 'tab active' : 'tab'} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      <main>
        {tab === 'overview' && <Overview />}
        {tab === 'appointments' && <Appointments />}
        {tab === 'doctors' && <Doctors />}
        {tab === 'departments' && <Departments />}
      </main>
    </div>
  );
}

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => {
    api<T>(path).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  }, [path]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

function CreateHospital({ onCreated }: { onCreated: (h: Hospital) => void }) {
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      onCreated(await api<Hospital>('/hospitals/profile', { method: 'PUT', body: { name, city: city || undefined } }));
    } catch (err: any) {
      setError(err.message);
    }
  };
  return (
    <form className="card narrow" onSubmit={submit}>
      <h1>Set up your hospital</h1>
      <label>Hospital name<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
      <label>City<input value={city} onChange={(e) => setCity(e.target.value)} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button disabled={name.trim().length < 2}>Create</button>
    </form>
  );
}

function Overview() {
  const { data, error } = useLoad<Stats>('/hospitals/stats');
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <>
      <div className="tiles">
        <Tile label="Doctors" value={String(data.doctors)} />
        <Tile label="Appointments" value={String(data.appointments)} />
        <Tile label="Revenue (paid)" value={rupees(data.revenuePaise)} />
      </div>
      <h2>Appointments by status</h2>
      {Object.keys(data.byStatus).length === 0 ? (
        <p className="muted">No appointments yet. Link doctors under the Doctors tab.</p>
      ) : (
        <table>
          <thead><tr><th>Status</th><th className="num">Count</th></tr></thead>
          <tbody>
            {Object.entries(data.byStatus).map(([s, n]) => (
              <tr key={s}><td><Badge status={s} /></td><td className="num">{n}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

const Tile = ({ label, value }: { label: string; value: string }) => (
  <div className="tile"><div className="muted">{label}</div><div className="big">{value}</div></div>
);
const Badge = ({ status }: { status: string }) => <span className={`badge ${status.toLowerCase()}`}>{status.replace('_', ' ').toLowerCase()}</span>;

function Appointments() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const { data, error } = useLoad<AppointmentRow[]>(`/hospitals/appointments?date=${date}`);
  return (
    <>
      <label className="inline">Date <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
      {error && <p className="error">{error}</p>}
      {data && data.length === 0 && <p className="muted">No appointments on this day.</p>}
      {data && data.length > 0 && (
        <table>
          <thead><tr><th>Time</th><th>Patient</th><th>Doctor</th><th>Status</th><th className="num">Paid</th></tr></thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.id}>
                <td>{a.slot}</td>
                <td>{a.user.name ?? a.user.phone}</td>
                <td>{a.doctor.user.name ?? 'Doctor'}{a.doctor.specialization && <span className="muted"> · {a.doctor.specialization}</span>}</td>
                <td><Badge status={a.status} /></td>
                <td className="num">{rupees(a.totalPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Doctors() {
  const { data, error, reload } = useLoad<DoctorRow[]>('/hospitals/doctors');
  const [hpr, setHpr] = useState('');
  const [msg, setMsg] = useState('');
  const link = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/hospitals/doctors', { method: 'POST', body: { hprId: hpr.replace(/\D/g, '') } });
      setHpr(''); setMsg(''); reload();
    } catch (err: any) {
      setMsg(err.message);
    }
  };
  const unlink = async (id: string) => {
    if (!confirm('Remove this doctor from your hospital?')) return;
    await api(`/hospitals/doctors/${id}`, { method: 'DELETE' });
    reload();
  };
  return (
    <>
      <form className="row" onSubmit={link}>
        <input value={hpr} onChange={(e) => setHpr(e.target.value)} placeholder="HPR ID, e.g. 71-1234-5678-9012" aria-label="HPR ID" />
        <button disabled={hpr.replace(/\D/g, '').length !== 14}>Link doctor</button>
      </form>
      {msg && <p className="error" role="alert">{msg}</p>}
      {error && <p className="error">{error}</p>}
      {data && data.length === 0 && <p className="muted">No doctors linked yet. Only verified doctors can be linked.</p>}
      {data && data.length > 0 && (
        <table>
          <thead><tr><th>Name</th><th>Specialization</th><th>Stream</th><th className="num">Fee</th><th /></tr></thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.id}>
                <td>{d.name ?? '—'}</td><td>{d.specialization ?? '—'}</td><td>{d.medicalStream ?? '—'}</td>
                <td className="num">{rupees(d.feePaise)}</td>
                <td><button className="link" onClick={() => unlink(d.id)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Departments() {
  const { data, error, reload } = useLoad<Department[]>('/hospitals/departments');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/hospitals/departments', { method: 'POST', body: { name } });
      setName(''); setMsg(''); reload();
    } catch (err: any) {
      setMsg(err.message);
    }
  };
  const remove = async (id: string) => {
    await api(`/hospitals/departments/${id}`, { method: 'DELETE' });
    reload();
  };
  return (
    <>
      <form className="row" onSubmit={add}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New department" aria-label="Department name" />
        <button disabled={name.trim().length < 2}>Add</button>
      </form>
      {msg && <p className="error" role="alert">{msg}</p>}
      {error && <p className="error">{error}</p>}
      {data && data.length === 0 && <p className="muted">No departments yet.</p>}
      <ul className="list">
        {data?.map((d) => (
          <li key={d.id}>{d.name}<button className="link" onClick={() => remove(d.id)}>Remove</button></li>
        ))}
      </ul>
    </>
  );
}
