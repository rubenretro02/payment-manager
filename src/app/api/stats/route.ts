import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = createAdminClient();

    // Get user counts
    const { count: totalUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'user');

    const { count: totalIBOs } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'ibo');

    // Get pending payments count
    const { count: pendingPayments } = await supabase
      .from('payments')
      .select('*', { count: 'exact', head: true })
      .in('status', ['pending', 'submitted']);

    // Get total owed
    const { data: owedData } = await supabase
      .from('payments')
      .select('amount_owed')
      .in('status', ['pending', 'submitted']);

    const totalOwed = owedData?.reduce((sum, p) => sum + (Number(p.amount_owed) || 0), 0) || 0;

    // Get total paid
    const { data: paidData } = await supabase
      .from('payments')
      .select('amount_paid')
      .eq('status', 'confirmed');

    const totalPaid = paidData?.reduce((sum, p) => sum + (Number(p.amount_paid) || 0), 0) || 0;

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
