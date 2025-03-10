import { redirect } from 'next/navigation';

export default function DashboardPage() {
  // Redirect to the catalog page
  redirect('/catalog');
} 