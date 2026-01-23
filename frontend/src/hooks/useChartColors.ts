'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

/**
 * Chart color palette that adapts to theme
 */
export interface ChartColors {
    primary: string;
    success: string;
    warning: string;
    danger: string;
    info: string;
    muted: string;
    grid: string;
    text: string;
    background: string;
    border: string;
}

const lightColors: ChartColors = {
    primary: '#8b5cf6',  // violet-500
    success: '#22c55e',  // green-500
    warning: '#f59e0b',  // amber-500
    danger: '#ef4444',   // red-500
    info: '#3b82f6',     // blue-500
    muted: '#94a3b8',    // slate-400
    grid: '#e2e8f0',     // slate-200
    text: '#0f172a',     // slate-900
    background: '#ffffff',
    border: '#e2e8f0',   // slate-200
};

const darkColors: ChartColors = {
    primary: '#a78bfa',  // violet-400
    success: '#4ade80',  // green-400
    warning: '#fbbf24',  // amber-400
    danger: '#f87171',   // red-400
    info: '#60a5fa',     // blue-400
    muted: '#64748b',    // slate-500
    grid: '#334155',     // slate-700
    text: '#f8fafc',     // slate-50
    background: '#0f172a', // slate-900
    border: '#334155',   // slate-700
};

/**
 * Hook that returns chart colors based on current theme
 * Colors update automatically when theme changes
 */
export function useChartColors(): ChartColors {
    const { resolvedTheme } = useTheme();
    const [colors, setColors] = useState<ChartColors>(lightColors);

    useEffect(() => {
        setColors(resolvedTheme === 'dark' ? darkColors : lightColors);
    }, [resolvedTheme]);

    return colors;
}
