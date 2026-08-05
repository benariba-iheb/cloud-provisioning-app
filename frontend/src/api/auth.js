import { request } from './client';

export const register = (email, password) =>
  request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });

export const login = (email, password) =>
  request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });

export const logout = () => request('/auth/logout', { method: 'POST' });

export const me = () => request('/auth/me', { method: 'GET' });
