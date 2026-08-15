import { type ClassValue, clsx } from "clsx";
import config from '../config.json';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/**
 * Format a Unix timestamp to locale string
 */
export function formatDate(
  timestamp: number,
  options?: Intl.DateTimeFormatOptions
): string {
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: '2-digit',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  };
  return new Date(timestamp * 1000).toLocaleString(undefined, options ?? defaultOptions);
}

/**
 * Format a number with specified decimal places
 */
export function formatNumber(value: number, decimals = 2): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ---------------------------------------------------------------------------
// Exact amounts
//
// The API delivers XNA and asset amounts as decimal strings with 8 decimals
// ("21000000000.12345678"). Never turn them into a JS number for display or
// arithmetic: doubles lose satoshis above 2^53 (~90 M XNA). These helpers work
// on the string / on BigInt satoshis instead.
// ---------------------------------------------------------------------------

export const AMOUNT_DECIMALS = 8;
const ZERO = BigInt(0);
const TEN = BigInt(10);
const SATS_PER_UNIT = TEN ** BigInt(AMOUNT_DECIMALS);

/**
 * Parse a decimal amount string ("123.456", "-0.00000001", "50000") into
 * satoshis (BigInt). Digits beyond 8 decimals are truncated. Numbers are
 * accepted for legacy callers but go through their (possibly lossy) string
 * form; empty/invalid input gives zero.
 */
export function satsOf(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined) return ZERO;
  const text = (typeof value === 'number' ? value.toFixed(AMOUNT_DECIMALS) : String(value)).trim();
  const match = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) return ZERO;
  const [, sign, whole, frac = ''] = match;
  const fracPadded = (frac + '0'.repeat(AMOUNT_DECIMALS)).slice(0, AMOUNT_DECIMALS);
  const sats = BigInt(whole || '0') * SATS_PER_UNIT + BigInt(fracPadded || '0');
  return sign === '-' ? -sats : sats;
}

export interface FormatAmountOptions {
  /** Decimals to show (0..8). Rounds half away from zero. Default 8. */
  decimals?: number;
  /** Drop trailing zeros of the fraction (and the point if nothing is left). */
  trim?: boolean;
  /** Thousands separators in the integer part. */
  grouping?: boolean;
}

/**
 * Format satoshis (BigInt) as a decimal string.
 */
export function formatSats(sats: bigint, options: FormatAmountOptions = {}): string {
  const decimals = Math.min(AMOUNT_DECIMALS, Math.max(0, options.decimals ?? AMOUNT_DECIMALS));
  const negative = sats < ZERO;
  let abs = negative ? -sats : sats;

  // Round to the requested decimals (half away from zero)
  const drop = AMOUNT_DECIMALS - decimals;
  if (drop > 0) {
    const unit = TEN ** BigInt(drop);
    abs = (abs + unit / BigInt(2)) / unit;
  }
  const scale = TEN ** BigInt(decimals);
  const whole = abs / scale;
  let frac = decimals > 0 ? (abs % scale).toString().padStart(decimals, '0') : '';

  if (options.trim) frac = frac.replace(/0+$/, '');

  const wholeText = options.grouping
    ? whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    : whole.toString();

  const text = frac.length > 0 ? `${wholeText}.${frac}` : wholeText;
  return negative && (whole !== ZERO || frac.replace(/0/g, '').length > 0) ? `-${text}` : text;
}

/**
 * Format a decimal amount string exactly (no float in between).
 * `formatAmount("21000000000.12345678")` -> "21000000000.12345678";
 * `formatAmount("50000", { decimals: 2, grouping: true })` -> "50,000.00".
 */
export function formatAmount(
  value: string | number | null | undefined,
  options: FormatAmountOptions = {}
): string {
  return formatSats(satsOf(value), options);
}

/** Sum of decimal amount strings, exact. */
export function sumAmounts(values: Array<string | number | null | undefined>): bigint {
  return values.reduce<bigint>((acc, v) => acc + satsOf(v), ZERO);
}

/**
 * Format satoshis to XNA with 8 decimal places
 */
export function formatXNA(satoshis: number | bigint): string {
  return formatSats(typeof satoshis === 'bigint' ? satoshis : BigInt(Math.round(satoshis)));
}

// Singleton formatters for performance
const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const compactNumberFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

/**
 * Format a number as USD currency
 */
export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

/**
 * Format a number in compact notation (e.g., 1.2K, 3.4M)
 */
export function formatCompactNumber(value: number): string {
  return compactNumberFormatter.format(value);
}

/**
 * Format hashrate with appropriate unit
 */
export function formatHashrate(rate: number): string {
  if (rate < 1e3) return `${rate.toFixed(2)} H/s`;
  if (rate < 1e6) return `${(rate / 1e3).toFixed(2)} KH/s`;
  if (rate < 1e9) return `${(rate / 1e6).toFixed(2)} MH/s`;
  if (rate < 1e12) return `${(rate / 1e9).toFixed(2)} GH/s`;
  if (rate < 1e15) return `${(rate / 1e12).toFixed(2)} TH/s`;
  return `${(rate / 1e15).toFixed(2)} PH/s`;
}

/**
 * Get CSS class for transaction amount highlighting based on thresholds
 */
export function getAmountClass(amount: number | string | bigint): string {
  const thresholds = config.thresholds?.amountColors ?? {
    high: 50_000_000,
    medium: 10_000_000,
    low: 1_000_000,
  };

  // Only a coarse comparison against whole-XNA thresholds: a double is fine here.
  const value =
    typeof amount === 'bigint' ? Number(amount / SATS_PER_UNIT) :
    typeof amount === 'string' ? Number(amount) : amount;

  if (value >= thresholds.high) {
    return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
  }
  if (value >= thresholds.medium) {
    return "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200";
  }
  if (value >= thresholds.low) {
    return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200";
  }
  return "bg-muted/40 text-foreground";
}

/**
 * Total output of a transaction as a decimal string: the API's `totalOutput`
 * when present, otherwise the exact sum of its outputs.
 */
export function getTotalOutput(tx: { totalOutput?: string | number; vout?: Array<{ value?: string | number }> }): string {
  if (tx.totalOutput !== undefined && tx.totalOutput !== null) return String(tx.totalOutput);
  if (!tx.vout) return '0';
  return formatSats(sumAmounts(tx.vout.map(o => o.value)));
}
