'use client';

import { useEffect, useState, useId } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useChartColors } from '@/hooks/useChartColors';
import { ChartSkeleton } from '@/components/ui/Skeleton';

interface DifficultyData {
    time: number;
    height: number;
    difficulty: number;
}

export function DifficultyGraph() {
    const [data, setData] = useState<DifficultyData[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const colors = useChartColors();
    const gradientId = useId();

    useEffect(() => {
        const fetchData = async () => {
            try {
                const res = await fetch('/api/stats/history');
                if (!res.ok) throw new Error('Failed to fetch data');
                const json = await res.json();
                setData(json);
            } catch (err) {
                console.error(err);
                setError('Failed to load difficulty history');
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, []);

    if (error) return null;
    if (isLoading) return <ChartSkeleton height={250} />;
    if (data.length === 0) return null;

    const minDiff = Math.min(...data.map(d => d.difficulty));
    const maxDiff = Math.max(...data.map(d => d.difficulty));
    const padding = (maxDiff - minDiff) * 0.1;

    return (
        <div className="w-full h-[250px] bg-card/50 border border-border/50 rounded-xl p-4 mb-6 shadow-sm">
            <h3 className="text-sm font-medium text-muted-foreground mb-4 uppercase tracking-wider ml-2">
                Network Difficulty (Last 24h)
            </h3>
            <div className="w-full h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data}>
                        <defs>
                            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={colors.info} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={colors.info} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <XAxis dataKey="height" hide={true} />
                        <YAxis domain={[minDiff - padding, maxDiff + padding]} hide={true} />
                        <Tooltip
                            content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                    const d = payload[0].payload as DifficultyData;
                                    return (
                                        <div
                                            className="p-3 rounded-lg shadow-lg text-sm"
                                            style={{
                                                backgroundColor: colors.background,
                                                border: `1px solid ${colors.border}`,
                                                color: colors.text,
                                            }}
                                        >
                                            <div className="font-bold">Block #{d.height}</div>
                                            <div style={{ color: colors.muted }}>
                                                {new Date(d.time * 1000).toLocaleString()}
                                            </div>
                                            <div className="mt-1 font-mono" style={{ color: colors.primary }}>
                                                Diff: {d.difficulty.toFixed(4)}
                                            </div>
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                        <Area
                            type="monotone"
                            dataKey="difficulty"
                            stroke={colors.info}
                            strokeWidth={2}
                            fillOpacity={1}
                            fill={`url(#${gradientId})`}
                            isAnimationActive={false}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
