// admin-frontend/src/lib/api.ts
import axios from 'axios';

const baseURL =
  process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000/api/v1';

export const apiClient = axios.create({
  baseURL,
});

// Автоматически подставляем x-admin-token из localStorage
apiClient.interceptors.request.use(config => {
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('adminToken');
    if (token) {
      config.headers = config.headers || {};
      (config.headers as any)['x-admin-token'] = token;
    }
  }
  return config;
});
