/**
 * Enterprise Auth Service
 *
 * Centralized authentication logic: login, signup, SSO, session refresh,
 * and logout. Wraps Supabase auth with production-grade patterns.
 */

import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';
import type { Session, User } from '@supabase/supabase-js';

// ─── Types ──────────────────────────────────────────────────────

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface SignupData extends LoginCredentials {
  fullName: string;
  orgName: string;
}

export interface AuthResult {
  success: boolean;
  user?: User;
  session?: Session;
  error?: string;
  requiresVerification?: boolean;
}

export interface SessionInfo {
  valid: boolean;
  expiresAt?: number;
  remainingMs?: number;
  user?: User;
}

// ─── Session Management ─────────────────────────────────────────

const SESSION_REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 min before expiry

export async function getSessionInfo(): Promise<SessionInfo> {
  const { data: { session }, error } = await supabase.auth.getSession();

  if (error || !session) {
    return { valid: false };
  }

  const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
  const remainingMs = expiresAt - Date.now();

  return {
    valid: remainingMs > 0,
    expiresAt,
    remainingMs: Math.max(0, remainingMs),
    user: session.user,
  };
}

export async function refreshSessionIfNeeded(): Promise<Session | null> {
  const info = await getSessionInfo();

  if (!info.valid) return null;

  if (info.remainingMs !== undefined && info.remainingMs < SESSION_REFRESH_THRESHOLD_MS) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error) {
      console.error('[AuthService] Session refresh failed:', error.message);
      return null;
    }
    return data.session;
  }

  const { data } = await supabase.auth.getSession();
  return data.session;
}

// ─── Email/Password Auth ────────────────────────────────────────

export async function login(credentials: LoginCredentials): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    user: data.user ?? undefined,
    session: data.session ?? undefined,
  };
}

export async function signup(data: SignupData): Promise<AuthResult> {
  const { data: authData, error } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      emailRedirectTo: window.location.origin,
      data: {
        full_name: data.fullName,
        org_name: data.orgName,
      },
    },
  });

  if (error) {
    return { success: false, error: error.message };
  }

  // If email confirmation is required, user won't have a session yet
  const needsVerification = !authData.session;

  return {
    success: true,
    user: authData.user ?? undefined,
    session: authData.session ?? undefined,
    requiresVerification: needsVerification,
  };
}

export async function logout(): Promise<void> {
  await supabase.auth.signOut();
}

// ─── SSO / OAuth ────────────────────────────────────────────────

export type SSOProvider = 'google';

export async function signInWithSSO(
  provider: SSOProvider,
  options?: { redirectUri?: string },
): Promise<AuthResult> {
  const redirectUri = options?.redirectUri ?? window.location.origin;

  const { error } = await lovable.auth.signInWithOAuth(provider, {
    redirect_uri: redirectUri,
  });

  if (error) {
    return { success: false, error: String(error) };
  }

  // OAuth redirects — won't return user/session synchronously
  return { success: true };
}

// ─── Password Reset ─────────────────────────────────────────────

export async function requestPasswordReset(email: string): Promise<AuthResult> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function updatePassword(newPassword: string): Promise<AuthResult> {
  const { data, error } = await supabase.auth.updateUser({ password: newPassword });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, user: data.user ?? undefined };
}

// ─── Session Refresh Timer ──────────────────────────────────────

let refreshInterval: ReturnType<typeof setInterval> | null = null;

export function startSessionRefreshLoop(intervalMs = 60_000): void {
  stopSessionRefreshLoop();
  refreshInterval = setInterval(() => {
    refreshSessionIfNeeded().catch(console.error);
  }, intervalMs);
}

export function stopSessionRefreshLoop(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}
