import prisma from "@/lib/db";
import { getAddressData } from '@/lib/services/address';
import { Card } from '@/components/ui/Card';
import { TxIdDisplay } from "@/components/TxIdDisplay";
import Link from 'next/link';
import { AddressAsset, Transaction, TransactionInput, TransactionOutput, Address } from "@/types";
import { formatSats, satsOf, sumAmounts } from "@/lib/utils";
import { Amount } from "@/components/ui/Amount";
import { InvalidParamError, LIMITS, assertPagination, isValidAddress, parseIntParam } from "@/lib/validation";

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function AddressPage({ params, searchParams }: { params: Promise<{ address: string }>, searchParams: Promise<{ page?: string }> }) {
    const { address } = await params;
    const { page: pageParam } = await searchParams;
    const addrStr = address;

    // Everything below hits the DB, so reject bad input first: a malformed
    // address, a non-integer page, or a page deeper than the offset limit.
    if (!isValidAddress(addrStr)) {
        return <div className="text-center p-8 text-destructive">Invalid address.</div>;
    }
    let page: number;
    try {
        page = assertPagination(
            parseIntParam('page', pageParam, { default: 1, min: 1, max: Number.MAX_SAFE_INTEGER }),
            PAGE_SIZE,
        ).page;
    } catch (e) {
        if (e instanceof InvalidParamError) {
            return <div className="text-center p-8 text-destructive">{e.message}.</div>;
        }
        throw e;
    }

    let addr: Address | null = null;
    let assetBalances: AddressAsset[] = [];

    // Parallel data fetching
    try {
        const [addrData, assetsRes] = await Promise.all([
            getAddressData(addrStr, page, PAGE_SIZE),
            prisma.addressAsset.findMany({
                where: {
                    address: addrStr,
                    balance: { gt: 0 }
                },
                include: { asset: true },
                orderBy: { balance: 'desc' }
            })
        ]);

        addr = addrData;

        // Use DB results directly
        assetBalances = assetsRes.map(row => ({
            asset: row.assetName,
            balance: row.balance.toString(),
            units: row.asset?.units ?? 0
        }));

    } catch (e) {
        console.error("Error loading address data:", e);
    }

    if (!addr) {
        return <div className="text-center p-8 text-destructive">Address not found or error loading data.</div>;
    }

    /**
     * Net XNA moved by the address in a tx, in satoshis (exact). The history
     * rows carry received/sent; walking vin/vout is only a fallback.
     */
    function getTxNetSats(tx: Transaction, address: string): bigint {
        if (tx.received !== undefined && tx.sent !== undefined) {
            return satsOf(tx.received) - satsOf(tx.sent);
        }
        const received = sumAmounts((tx.vout || [])
            .filter((v: TransactionOutput) => (v?.scriptPubKey?.addresses || []).includes(address))
            .map(v => v.value));
        const sent = sumAmounts((tx.vin || [])
            .filter((v: TransactionInput) => (v?.addresses || []).includes(address))
            .map(v => v.value));
        return received - sent;
    }

    const ZERO = BigInt(0);

    function formatAssetDelta(delta: string) {
        const sats = satsOf(delta);
        const sign = sats > ZERO ? "+" : sats < ZERO ? "-" : "";
        return `${sign}${formatSats(sats < ZERO ? -sats : sats, { trim: true, grouping: true })}`;
    }

    const browsablePages = Math.min(addr.totalPages || 0, Math.floor(LIMITS.SKIP_MAX / PAGE_SIZE) + 1);

    return (
        <div className="flex flex-col gap-8 container mx-auto px-4 py-8">
            <div>
                <div className="flex flex-col gap-1 mb-2"><span className="eyebrow">Wallet</span><h1 className="text-2xl lg:text-3xl font-bold tracking-tight">Address</h1></div>
                <p className="mono-box text-muted-foreground inline-block">{addr.address}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <Card title="Overview">
                    <div className="p-6 grid gap-4">
                        <div className="flex justify-between items-center border-b border-border pb-2 last:border-0 last:pb-0">
                            <span className="text-muted-foreground text-sm font-medium">Balance</span>
                            <Amount value={addr.balance} unit="XNA" className="font-medium" unitClassName="text-primary" />
                        </div>
                        <div className="flex justify-between items-center border-b border-border pb-2 last:border-0 last:pb-0">
                            <span className="text-muted-foreground text-sm font-medium">Total Received</span>
                            <Amount value={addr.totalReceived} className="text-green-600 dark:text-green-400" />
                        </div>
                        <div className="flex justify-between items-center border-b border-border pb-2 last:border-0 last:pb-0">
                            <span className="text-muted-foreground text-sm font-medium">Total Sent</span>
                            <Amount value={addr.totalSent} className="text-red-600 dark:text-red-400" />
                        </div>
                        <div className="flex justify-between items-center border-b border-border pb-2 last:border-0 last:pb-0">
                            <span className="text-muted-foreground text-sm font-medium">Transactions</span>
                            <span className="font-mono">{addr.txs}</span>
                        </div>
                    </div>
                </Card>

                <Card title="Assets Held">
                    <div className="p-6 max-h-[300px] overflow-y-auto space-y-3 custom-scrollbar">
                        {assetBalances.length > 0 ? (
                            assetBalances.map((asset: AddressAsset, i: number) => (
                                <div key={i} className="flex justify-between items-center p-3 bg-muted/20 rounded-lg hover:bg-muted/40 transition-colors">
                                    <Link href={`/asset/${asset.asset}`} prefetch={false} className="font-medium text-primary hover:underline">
                                        {asset.asset}
                                    </Link>
                                    <Amount value={asset.balance} decimals={asset.units ?? 0} grouping className="text-muted-foreground font-semibold" />
                                </div>
                            ))
                        ) : (
                            <div className="text-center text-muted-foreground text-sm">No assets held (or syncer lag).</div>
                        )}
                    </div>
                </Card>
            </div>

            <div className="space-y-4">
                <h2 className="text-2xl font-semibold">Transactions</h2>
                <div className="space-y-4">
                    {addr.transactions?.map((tx: Transaction) => {
                        const netSats = getTxNetSats(tx, addrStr);
                        const isIncoming = netSats > ZERO;
                        const isOutgoing = netSats < ZERO;
                        const amountClass = isIncoming
                            ? "text-green-600 dark:text-green-400"
                            : isOutgoing
                                ? "text-red-600 dark:text-red-400"
                                : "text-muted-foreground";
                        const amountSign = isIncoming ? "+" : isOutgoing ? "-" : "";
                        const amountAbs = isOutgoing ? -netSats : netSats;
                        const assetLabels = (tx.assetDeltas ?? [])
                            .filter(a => satsOf(a.delta) !== ZERO)
                            .map(a => ({
                                asset: a.asset,
                                label: formatAssetDelta(a.delta),
                                className: satsOf(a.delta) > ZERO ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400",
                            }));
                        const dateTime = new Date(tx.blocktime * 1000).toLocaleString(undefined, {
                            year: '2-digit',
                            month: 'numeric',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: 'numeric',
                        });

                        return (
                            <Card key={tx.txid}>
                                <div className="p-4 flex flex-col lg:grid lg:grid-cols-[65%_35%] lg:items-center gap-3">
                                    <div className="flex flex-col min-w-0">
                                        <Link href={`/tx/${tx.txid}`} prefetch={false} className="block min-w-0 overflow-hidden text-primary font-mono text-sm lg:text-base hover:underline">
                                            <TxIdDisplay txid={tx.txid} className="text-sm lg:text-base" />
                                        </Link>
                                    </div>
                                    <div className="hidden lg:flex flex-col items-end gap-1 pr-2">
                                        <Amount sats={amountAbs} sign={amountSign} decimals={3} unit="XNA" className={`font-medium ${amountClass}`} />
                                        {assetLabels.map(a => (
                                            <span key={a.asset} className={`font-mono text-sm ${a.className}`}>
                                                {a.label} <Link href={`/asset/${a.asset}`} prefetch={false} className="hover:underline">{a.asset}</Link>
                                            </span>
                                        ))}
                                        <span className="text-sm text-muted-foreground">{dateTime}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-sm text-muted-foreground lg:hidden">
                                        <span>{dateTime}</span>
                                        <span className="flex flex-col items-end">
                                            <Amount sats={amountAbs} sign={amountSign} decimals={3} unit="XNA" className={`font-medium ${amountClass}`} />
                                            {assetLabels.map(a => (
                                                <span key={a.asset} className={`font-mono ${a.className}`}>
                                                    {a.label} <Link href={`/asset/${a.asset}`} prefetch={false} className="hover:underline">{a.asset}</Link>
                                                </span>
                                            ))}
                                        </span>
                                    </div>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            </div>

            {(addr.totalPages || 0) > browsablePages && (
                <p className="mt-4 text-sm text-muted-foreground">
                    Showing the most recent {browsablePages.toLocaleString('en-US')} pages of transaction history.
                    Older transactions remain available by transaction ID.
                </p>
            )}
            <div className="flex justify-between items-center mt-4 bg-muted/20 p-4 rounded-lg">
                {page > 1 ? (
                    <Link href={`/address/${addrStr}?page=${page - 1}`} prefetch={false} className="text-primary hover:underline">&larr; Previous</Link>
                ) : <span className="text-muted-foreground pointer-events-none opacity-50">&larr; Previous</span>}

                <span className="text-sm font-medium text-muted-foreground">Page {addr.page} of {browsablePages}</span>

                {page < browsablePages ? (
                    <Link href={`/address/${addrStr}?page=${page + 1}`} prefetch={false} className="text-primary hover:underline">Next &rarr;</Link>
                ) : <span className="text-muted-foreground pointer-events-none opacity-50">Next &rarr;</span>}
            </div>
        </div>
    );
}
