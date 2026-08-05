import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import * as instancesApi from '../api/instances';

const MAX_INSTANCES = 3;
const TRANSITIONAL_STATUSES = ['creating', 'terminating'];
const ACTIVE_STATUSES = ['creating', 'running'];
const POLL_INTERVAL_MS = 4000;

function formatCountdown(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
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
      await instancesApi.create();
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
    <div style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <p>
        Logged in as {user.email} <button onClick={logout}>Log out</button>
      </p>

      <h1>Your instances</h1>
      {error && <p role="alert">{error}</p>}

      <button onClick={handleCreate} disabled={creating || activeCount >= MAX_INSTANCES}>
        Create instance
      </button>
      {activeCount >= MAX_INSTANCES && (
        <p>
          <em>Maximum of {MAX_INSTANCES} concurrent instances reached. Terminate one to create another.</em>
        </p>
      )}

      {loading ? (
        <p>Loading...</p>
      ) : instances.length === 0 ? (
        <p>No instances yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Status</th>
              <th>Created</th>
              <th>Expires in</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {instances.map((instance) => (
              <tr key={instance.id}>
                <td>{instance.id.slice(0, 8)}</td>
                <td>{instance.status}</td>
                <td>{new Date(instance.createdAt).toLocaleTimeString()}</td>
                <td>
                  {instance.status === 'running' || instance.status === 'creating'
                    ? formatCountdown(instance.expiresAt)
                    : '-'}
                </td>
                <td>
                  {instance.status === 'running' && (
                    <Link to={`/instances/${instance.id}/terminal`}>Terminal</Link>
                  )}{' '}
                  {(instance.status === 'running' || instance.status === 'creating') && (
                    <button onClick={() => handleTerminate(instance.id)}>Terminate</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
