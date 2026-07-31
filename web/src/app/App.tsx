import { ErrorBoundary } from './ErrorBoundary';
import { AppShell } from './AppShell';

export function App() {
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  );
}
