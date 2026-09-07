import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { redirect } from 'next/navigation';
import type { RolePackId } from '@/lib/roles/packs';

export type BeaconUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: 'user' | 'admin';
  role_pack: RolePackId | null;
  has_resume: boolean;
};

// Server component / route helper that returns the current logged-in user
// hydrated from the users table. Returns null if not logged in or if the
// auth session exists but no matching users row (edge case during onboarding).
export async function getCurrentUser(): Promise<BeaconUser | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Supabase env vars missing');

  const cookieStore = await cookies();
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) cookieStore.set(name, value, options);
      },
    },
  });

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  const { data } = await supabase
    .from('users')
    .select('id, email, display_name, role, role_pack, resume_text')
    .eq('id', authUser.id)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    id: string;
    email: string;
    display_name: string | null;
    role: 'user' | 'admin';
    role_pack: RolePackId | null;
    resume_text: string | null;
  };
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
    role_pack: row.role_pack,
    has_resume: !!row.resume_text,
  };
}

export async function requireUser(): Promise<BeaconUser> {
  const u = await getCurrentUser();
  if (!u) redirect('/login');
  return u;
}

export async function requireAdmin(): Promise<BeaconUser> {
  const u = await requireUser();
  if (u.role !== 'admin') redirect('/dashboard');
  return u;
}
