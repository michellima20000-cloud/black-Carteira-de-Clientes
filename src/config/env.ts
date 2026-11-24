const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
const fallbackApiUrl = 'http://localhost:3000';

export const API_BASE_URL = (configuredApiUrl || fallbackApiUrl).replace(/\/+$/, '');
