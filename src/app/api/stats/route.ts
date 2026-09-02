import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = createAdminClient();

    // All five aggregates are independent — run them in parallel instead of
    // five sequential round-trips.
    const [usersRes, ibosRes, pendingCountRes, owedRes, paidRes] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'user'),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'ibo'),
      supabase.from('payments').select('*', { count: 'exact', head: true }).in('status', ['pending', 'submitted']),
      supabase.from('payments').select('amount_owed').in('status', ['pending', 'submitted']),
      supabase.from('payments').select('amount_paid').eq('status', 'confirmed'),
    ]);

    const totalUsers = usersRes.count;
    const totalIBOs = ibosRes.count;
    const pendingPayments = pendingCountRes.count;
    const totalOwed = owedRes.data?.reduce((sum, p) => sum + (Number(p.amount_owed) || 0), 0) || 0;
    const totalPaid = paidRes.data?.reduce((sum, p) => sum + (Number(p.amount_paid) || 0), 0) || 0;

    // Calculate collection rate
    const total = totalPaid + totalOwed;
    const collectionRate = total > 0 ? ((totalPaid / total) * 100).toFixed(1) : '0';

    return NextResponse.json({
      success: true,
      data: {
        totalUsers: totalUsers || 0,
        totalIBOs: totalIBOs || 0,
        pendingPayments: pendingPayments || 0,
        totalOwed,
        totalPaid,
        collectionRate: Number(collectionRate),
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch stats' }, { status: 500 });
  }
}
