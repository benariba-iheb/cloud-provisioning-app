import { request } from './client';

export const list = () => request('/instances', { method: 'GET' });

export const create = (distro) => request('/instances', { method: 'POST', body: JSON.stringify({ distro }) });

export const terminate = (id) => request(`/instances/${id}`, { method: 'DELETE' });
