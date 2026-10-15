// ============================================================================
// New Dashboard Trigger Route (/dashboard/new)
//
// Shortcut navigation route:
// - Verifies user authentication
// - Opens the Create Dashboard dialog modal via `useUIStore`
// - Redirects user seamlessly to `/dashboard/manage` where the modal opens
// ============================================================================

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { Spin } from 'antd';
import { useUIStore } from '@/store/useUIStore';

export default function NewDashboardPage() {
  const router = useRouter();
  const { token, hydrated } = useAuthStore();
  const { setCreateDashboardModalOpen } = useUIStore();

  useEffect(() => {
    if (!hydrated) return;

    if (!token) {
      router.replace('/login');
    } else {
      setCreateDashboardModalOpen(true);
      router.replace('/dashboard/manage');
    }
  }, [token, router, hydrated, setCreateDashboardModalOpen]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <Spin size="large" />
    </div>
  );
}
