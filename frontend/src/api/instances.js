import { request } from './client';

export const list = () => request('/instances', { method: 'GET' });

export const create = () => request('/instances', { method: 'POST' });

export const terminate = (id) => request(`/instances/${id}`, { method: 'DELETE' });
