import type { ReactElement } from 'react';

/**
 * Admin shell.
 *
 * Sidebar, RBAC routing and screens land in Phase 7; Phase 0 only proves the app builds.
 */
export function App(): ReactElement {
  return (
    <main>
      <h1>SilkGrain Admin</h1>
      <p>Admin — Phase 0 scaffold.</p>
    </main>
  );
}
