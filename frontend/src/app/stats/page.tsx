import { connection } from 'next/server';
import { getDailyStats } from '@/lib/services/dailyStats';
import StatsView from './StatsView';

export default async function StatsPage() {
    // Defer database access until runtime; keep the data cache available.
    await connection();
    const cleanStats = await getDailyStats();

    return (
        <div className="container mx-auto px-4 py-8">
            <StatsView data={cleanStats} />
        </div>
    );
}
