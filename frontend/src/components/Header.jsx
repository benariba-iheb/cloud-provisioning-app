import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link to="/" className="app-brand">
          <svg
            className="app-logo"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M17.5 19A3.5 3.5 0 0 0 21 15.5c0-2.79-2.54-4.5-5-4.5-.47 0-.89.09-1.3.27A6.47 6.47 0 0 0 14.5 4a6.5 6.5 0 0 0-6.2 4.58C5.58 8.87 3 11 3 14c0 3.31 2.69 6 6 6h8.5z" />
          </svg>
          Cloud Platform
        </Link>
        {user && (
          <div className="app-header-user">
            <Link to="/dashboard">Dashboard</Link>
            <span className="mono">{user.email}</span>
            <button className="secondary" onClick={logout}>
              Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
