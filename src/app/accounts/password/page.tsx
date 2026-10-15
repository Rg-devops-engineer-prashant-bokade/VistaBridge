// ============================================================================
// Password Settings Redirect Route (/accounts/password)
//
// Automatically redirects users to the unified profile settings tab at `/accounts/profile`.
// ============================================================================

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PasswordPageRedirect() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace('/accounts/profile');
  }, [router]);

  return null;
}
