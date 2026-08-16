'use client';

import { useEffect, useState } from 'react';
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
        <div className="w-full h-[250px] bg-card border border-border rounded-card p-4 lg:p-5 shadow-card">
            <h3 className="eyebrow mb-4">
                Network Difficulty (Last 24h)
            </h3>
            <div className="w-full h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data}>
                        <XAxis dataKey="height" hide={true} />
                        <YAxis domain={[minDiff - padding, maxDiff + padding]} hide={true} />
                        <Tooltip
                            content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                    const d = payload[0].payload as DifficultyData;
                                    return (
                                        <div
                                            className="p-3 rounded-inner shadow-card text-sm"
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
                            fillOpacity={0.15}
                            fill={colors.info}
                            isAnimationActive={false}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
