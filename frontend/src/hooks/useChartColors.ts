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
    primary: '#ea580c',  // brand orange (text-safe)
    success: '#16a34a',
    warning: '#d97706',
    danger: '#dc2626',
    info: '#f97316',     // orange for the main series
    muted: '#9ca3af',
    grid: '#e5e7eb',
    text: '#111827',
    background: '#ffffff',
    border: '#e5e7eb',
};

const darkColors: ChartColors = {
    primary: '#fb923c',
    success: '#4ade80',
    warning: '#fbbf24',
    danger: '#f87171',
    info: '#fb923c',
    muted: '#9ca3af',
    grid: '#374151',
    text: '#f9fafb',
    background: '#1f2937',
    border: '#374151',
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
