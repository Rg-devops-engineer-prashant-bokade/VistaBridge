// ============================================================================
// Auth Store (Zustand)
//
// Manages the user login session in memory:
// - Stores the logged-in user profile, role, and GeoServer URL
// - Keeps the JWT access token in RAM memory (not in localStorage for security)
// - Handles token expiration checks and automatic refresh via /api/auth/token/refresh
// ============================================================================


import { create } from 'zustand';

interface User {
  id?: number;
  username: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  role?: 'ADMIN' | 'USER';
  geoserverAuth?: string;
  geoserverUrl?: string;
  profile?: {
    role: string;
  };
}

interface AuthState {
  user: User | null;
  token: string | null;
  // NOTE: Auth credentials and access tokens are held exclusively in RAM memory.
  // The refresh token is stored exclusively in a secure HttpOnly cookie (set by the server).
  // Zero sensitive credentials remain in localStorage.
  hydrated: boolean;
  setAuth: (user: User, token: string) => void;
  clearAuth: () => void;
  setHydrated: (val: boolean) => void;
  refreshAccessToken: () => Promise<string | null>;
  /** Returns true if the access token expires within the next 60 seconds. */
  isTokenExpiringSoon: () => boolean;
  /** Returns true if the access token is already expired. */
  isTokenExpired: () => boolean;
}

// Decode a JWT payload without a library. Returns null on any error.
function decodeTokenPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

function getTokenExp(token: string | null): number | null {
  if (!token) return null;
  const payload = decodeTokenPayload(token);
  const exp = payload?.exp;
  return typeof exp === 'number' ? exp * 1000 : null;
}

// Module-level deduplication guard.
// Holds the single in-flight refresh promise so concurrent callers share one request.
let refreshPromise: Promise<string | null> | null = null;

export const useAuthStore = create<AuthState>()((set, get) => ({

  user: null,
  token: null,
  hydrated: false,

  setAuth: (user, token) =>
    set((state) => ({
      user: state.user ? { ...state.user, ...user } : user,
      token,
      hydrated: true,
    })),

  clearAuth: () => set({ user: null, token: null, hydrated: true }),

  setHydrated: (val) => set({ hydrated: val }),

  isTokenExpired: () => {
    const exp = getTokenExp(get().token);
    if (exp === null) return false; // can't tell — treat as valid
    return Date.now() >= exp;
  },

  isTokenExpiringSoon: () => {
    const exp = getTokenExp(get().token);
    if (exp === null) return false;
    const THRESHOLD_MS = 60 * 1000; // 60 seconds
    return exp - Date.now() < THRESHOLD_MS && Date.now() < exp;
  },

  refreshAccessToken: async () => {
    // The refresh token is in an HttpOnly cookie — the browser sends it
    // automatically. We just call the refresh endpoint.
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      try {
        const response = await fetch('/api/auth/token/refresh', {
          method: 'POST',
          credentials: 'include', // ensures cookies are sent
        });

        if (response.status === 401 || response.status === 400) {
          // Refresh token is invalid or revoked — clear auth
          set({ user: null, token: null, hydrated: true });
          return null;
        }
        if (!response.ok) {
          set({ hydrated: true });
          return null;
        }

        const data = await response.json();
        set((state) => ({
          token: data.access,
          user: data.user ? (state.user ? { ...state.user, ...data.user } : data.user) : state.user,
          hydrated: true,
        }));
        return data.access as string;
      } catch {
        set({ hydrated: true });
        return null;
      } finally {
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  },
}));
