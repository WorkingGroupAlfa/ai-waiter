// admin-frontend/src/app/layout.tsx
import './globals.css';
import React from 'react';

export const metadata = {
  title: 'AI Waiter Admin',
  description: 'Admin panel for AI Waiter restaurant assistant',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="app-body">
        <div className="app-shell">
          <aside className="app-sidebar">
            <div className="app-brand">
              <div className="app-brand-title">AI WAITER</div>
              <div className="app-brand-subtitle">Restaurant admin panel</div>
            </div>

            <nav className="app-nav">
              <a href="/" className="app-nav-highlight">
                Dashboard
              </a>
              <a href="/menu">Menu</a>
              <a href="/orders">Orders</a>
              <a href="/sessions">Sessions</a>
              <a href="/upsell">Upsell stats</a>
              <a href="/upsell-simulate">Upsell simulator</a>
              <a href="/persona">Persona</a>
              <a href="/qr">QR generator</a>
              <a href="/training">AI training</a>
              <a href="/upsell-rules">Upsell rules</a>
<a href="/auto-related">Auto related</a>

            </nav>
          </aside>

          <main className="app-main">
            <header className="app-topbar">
              <div className="app-topbar-title">AI WAITER • ADMIN</div>
              <div className="app-topbar-right">
                Environment: <span>local dev</span>
              </div>
            </header>

            <section className="app-content">{children}</section>
          </main>
        </div>
      </body>
    </html>
  );
}

