// admin-frontend/src/lib/auth.ts

export function ensureAdminToken() {
  if (typeof window === 'undefined') return;
  const token = window.localStorage.getItem('adminToken');
  if (!token) {
    window.location.href = '/login';
  }
}
