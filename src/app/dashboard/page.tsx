// ============================================================================
// Dashboard Root Route (/dashboard)
//
// Automatically redirects users to the main system dashboard at `/overview`.
// ============================================================================

import { redirect } from 'next/navigation';

export default function DashboardPage() {
  redirect('/overview');
}
