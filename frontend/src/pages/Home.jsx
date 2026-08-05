import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Home() {
  const { user } = useAuth();
  const [status, setStatus] = useState('checking...');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => setStatus(data.status))
      .catch(() => setStatus('unreachable'));
  }, []);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>Cloud Platform</h1>
      <p>Backend status: {status}</p>
      {user ? (
        <p>
          Welcome back, {user.email}. <Link to="/dashboard">Go to dashboard</Link>
        </p>
      ) : (
        <p>
          <Link to="/login">Log in</Link> or <Link to="/register">Register</Link>
        </p>
      )}
    </div>
  );
}
