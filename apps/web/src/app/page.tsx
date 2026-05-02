import { AuthProvider } from '@/components/auth-provider';
import { Dashboard } from '@/components/dashboard';

export default function HomePage() {
  return (
    <AuthProvider>
      <Dashboard />
    </AuthProvider>
  );
}
