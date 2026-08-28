import { ErrorBoundary } from './ErrorBoundary';
import { AppShell } from './AppShell';
import { ToastContainer } from '@/ui/feedback/ToastContainer';
import { GlobalConfirmDialog } from '@/ui/feedback/GlobalConfirmDialog';
import '@/styles/feedback.css';

export function App() {
  return (
    <ErrorBoundary>
      <AppShell />
      <ToastContainer />
      <GlobalConfirmDialog />
    </ErrorBoundary>
  );
}
