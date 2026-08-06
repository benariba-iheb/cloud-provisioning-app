import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Header from '../components/Header';

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
    <div className="page">
      <Header />
      <div className="page-content">
        <h1>Cloud Platform</h1>
        <p>
          Ephemeral Ubuntu instances, provisioned on demand.{' '}
          <span className="mono">Backend status: {status}</span>
        </p>
        {user ? (
          <p>
            Welcome back, {user.email}. <Link to="/dashboard">Go to your dashboard →</Link>
          </p>
        ) : (
          <p>
            <Link to="/login">Log in</Link> or <Link to="/register">create an account</Link> to get
            started.
          </p>
        )}
      </div>
    </div>
  );
}
