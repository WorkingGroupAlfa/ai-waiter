// admin-frontend/src/app/login/page.tsx
'use client';

import React, { useState } from 'react';

export default function LoginPage() {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) {
      setError('Please enter admin token');
      return;
    }
    window.localStorage.setItem('adminToken', token.trim());
    window.location.href = '/';
  }

  return (
    <div className="max-w-md mx-auto mt-24 border rounded p-6 bg-white">
      <h1 className="text-xl font-semibold mb-4">Admin login</h1>
      <p className="text-sm text-gray-600 mb-4">
        Enter <code>ADMIN_TOKEN</code> from backend .env
      </p>

      {error && <div className="text-red-600 mb-2">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm mb-1">Admin token</label>
          <input
            type="password"
            className="border rounded px-3 py-2 w-full"
            value={token}
            onChange={e => setToken(e.target.value)}
          />
        </div>

        <button
          type="submit"
          className="w-full py-2 bg-black text-white rounded"
        >
          Login
        </button>
      </form>
    </div>
  );
}
