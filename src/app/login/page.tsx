'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CreditCard, Loader2, AlertCircle } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const supabase = getSupabaseClient();

      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }

      if (data.user) {
        // Look up the corresponding user row by auth_user_id (preferred) or email
        let userData: { id: string; role: string; status: string; email: string | null; telegram_first_name: string | null; [key: string]: unknown } | null = null;

        const byAuthId = await supabase
          .from('users')
          .select('*')
          .eq('auth_user_id', data.user.id)
          .maybeSingle();
        if (byAuthId.data) {
          userData = byAuthId.data;
        } else {
          const byEmail = await supabase
            .from('users')
            .select('*')
            .ilike('email', email)
            .maybeSingle();
          userData = byEmail.data;
        }

        if (!userData) {
          setError('No account found for this email. Contact your admin.');
          await supabase.auth.signOut();
          setLoading(false);
          return;
        }

        if (userData.status === 'suspended' || userData.status === 'inactive') {
          setError('Your account is not active. Contact your admin.');
          await supabase.auth.signOut();
          setLoading(false);
          return;
        }

        // Store user in localStorage for our auth hook
        localStorage.setItem('auth_user', JSON.stringify(userData));

        // Route based on role: regular users/partners go to my-accounts, admins/IBOs to dashboard
        if (userData.role === 'user' || userData.role === 'partner') {
          router.push('/dashboard/my-accounts');
        } else {
          router.push('/dashboard');
        }
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <CreditCard className="h-7 w-7" />
          </div>
          <CardTitle className="text-2xl">Sign In</CardTitle>
          <CardDescription>
            Log in with your email and password
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 text-sm text-red-600 bg-red-50 rounded-lg">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
