'use client';

import { useAuthContext } from '@/components/providers/AuthProvider';

// Reads the app-wide auth state. The actual authentication happens once in
// <AuthProvider> (mounted in the root layout); this hook no longer triggers a
// request per component.
export function useAuth() {
  return useAuthContext();
}
