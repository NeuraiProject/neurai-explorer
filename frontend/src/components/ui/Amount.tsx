import { formatAmount, formatSats, type FormatAmountOptions } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface AmountProps extends FormatAmountOptions {
    /** Decimal string (or BigInt satoshis via `sats`) */
    value?: string | number | null;
    sats?: bigint;
    /** Optional unit rendered after the number (e.g. "XNA") */
    unit?: string;
    /** Prefix such as "+" / "-" */
    sign?: string;
    className?: string;
    unitClassName?: string;
}

/**
 * Renders an exact decimal amount with the fractional part slightly smaller
 * than the integer part, so long numbers read at a glance:
 *   4,827,319,701.36219727  ->  4,827,319,701 .36219727 (decimals ~2pt smaller)
 * Formatting is exact (string / BigInt based, see lib/utils).
 */
export function Amount({ value, sats, unit, sign, className, unitClassName, ...options }: AmountProps) {
    const text = sats !== undefined ? formatSats(sats, options) : formatAmount(value, options);
    const [whole, frac] = text.split('.');
    return (
        <span className={cn('font-mono font-medium tabular-nums whitespace-nowrap', className)}>
            {sign}
            {whole}
            {frac !== undefined && (
                <span className="text-[0.82em] opacity-80">.{frac}</span>
            )}
            {unit && <span className={cn('ml-1 text-[0.8em] font-medium opacity-70', unitClassName)}>{unit}</span>}
        </span>
    );
}
