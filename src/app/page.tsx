// ============================================================================
// Application Root Route (/)
//
// Default landing entry point: redirects visitors to the `/login` authentication screen.
// ============================================================================

import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/login');
}
