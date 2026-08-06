import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as instancesApi from '../api/instances';
import Header from '../components/Header';

const MAX_INSTANCES = 3;
const TRANSITIONAL_STATUSES = ['creating', 'terminating'];
const ACTIVE_STATUSES = ['creating', 'running'];
const POLL_INTERVAL_MS = 4000;
// Keep in sync with DISTRO_IMAGES in backend/src/services/k8sService.js.
const DISTROS = [
  { value: 'ubuntu', label: 'Ubuntu 24.04' },
  { value: 'arch', label: 'Arch Linux' },
  { value: 'opensuse', label: 'openSUSE Leap 15.6' },
];
const distroLabel = (value) => DISTROS.find((d) => d.value === value)?.label || value;

function formatCountdown(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function Dashboard() {
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [distro, setDistro] = useState(DISTROS[0].value);
  const [, forceTick] = useState(0);
  const pollTimeoutRef = useRef(null);

  // Fetches once, and if anything is still transitioning, schedules exactly
  // one more round - so calling this after create/terminate naturally
  // resumes polling without stacking duplicate timers.
  const refresh = useCallback(async () => {
    clearTimeout(pollTimeoutRef.current);
    let fetched;
    try {
      fetched = (await instancesApi.list()).instances;
      setInstances(fetched);
    } catch (err) {
      setError(err.message);
      fetched = [];
    } finally {
      setLoading(false);
    }
    if (fetched.some((i) => TRANSITIONAL_STATUSES.includes(i.status))) {
      pollTimeoutRef.current = setTimeout(refresh, POLL_INTERVAL_MS);
    }
    return fetched;
  }, []);

  useEffect(() => {
    refresh();
    return () => clearTimeout(pollTimeoutRef.current);
  }, [refresh]);

  // Countdown text ticks independently of the status-polling above.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const activeCount = instances.filter((i) => ACTIVE_STATUSES.includes(i.status)).length;

  const handleCreate = async () => {
    setError(null);
    setCreating(true);
    try {
      await instancesApi.create(distro);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleTerminate = async (id) => {
    setError(null);
    try {
      await instancesApi.terminate(id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="page">
      <Header />
      <div className="page-content">
        <h1>Your instances</h1>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <div className="instances-toolbar">
          <select
            value={distro}
            onChange={(e) => setDistro(e.target.value)}
            disabled={creating || activeCount >= MAX_INSTANCES}
            aria-label="Distro"
          >
            {DISTROS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
          <button onClick={handleCreate} disabled={creating || activeCount >= MAX_INSTANCES}>
            {creating ? 'Creating…' : 'Create instance'}
          </button>
          {activeCount >= MAX_INSTANCES && (
            <span className="hint" style={{ margin: 0 }}>
              Maximum of {MAX_INSTANCES} concurrent instances reached. terminate one to create
              another.
            </span>
          )}
        </div>

        {loading ? (
          <p>Loading…</p>
        ) : instances.length === 0 ? (
          <div className="empty-state">No instances yet. create one to get started.</div>
        ) : (
          <table className="instances-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>OS</th>
                <th>Status</th>
                <th>Created</th>
                <th>Expires in</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {instances.map((instance) => (
                <tr key={instance.id}>
                  <td className="mono">{instance.id.slice(0, 8)}</td>
                  <td>{distroLabel(instance.distro)}</td>
                  <td>
                    <span className={`status-badge status-${instance.status}`}>
                      {instance.status}
                    </span>
                  </td>
                  <td>{new Date(instance.createdAt).toLocaleTimeString()}</td>
                  <td className="mono">
                    {instance.status === 'running' || instance.status === 'creating'
                      ? formatCountdown(instance.expiresAt)
                      : '–'}
                  </td>
                  <td>
                    <div className="actions">
                      {instance.status === 'running' && (
                        <Link to={`/instances/${instance.id}/terminal`}>Terminal</Link>
                      )}
                      {(instance.status === 'running' || instance.status === 'creating') && (
                        <button className="danger" onClick={() => handleTerminate(instance.id)}>
                          Terminate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
