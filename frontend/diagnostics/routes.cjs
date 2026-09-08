'use strict';

const pages = new Set(['/', '/blocks', '/txs', '/assets', '/peers', '/richlist', '/stats', '/api']);
const apis = new Set(['/api/status', '/api/peers', '/api/blocks', '/api/txs', '/api/assets', '/api/richlist', '/api/stats/history']);
const commands = new Set(['getdifficulty', 'getconnectioncount', 'getblockcount', 'getblockhash', 'getblock', 'getrawtransaction', 'getnetworkhashps', 'getmoneysupply', 'getdistribution', 'getaddress', 'getaddresstxs', 'gettx', 'getbalance', 'getlasttxs', 'getcurrentprice', 'getbasicstats', 'getsummary']);

function routeGroup(url = '/') {
  const pathname = url.split('?')[0].replace(/\/$/, '') || '/';
  if (pages.has(pathname) || apis.has(pathname)) return pathname;
  if (pathname.startsWith('/_next/static/')) return '/_next/static/*';
  if (pathname === '/_next/image') return '/_next/image';
  const detail = pathname.match(/^(\/api)?\/(block|tx|address|asset)\//);
  if (detail) return `${detail[1] || ''}/${detail[2]}/*`;
  const command = pathname.split('/')[2];
  if (pathname.startsWith('/api/')) return commands.has(command) ? `/api/${command}/*` : '/api/other';
  if (/\.(png|svg|ico|woff2?|css|js)$/.test(pathname)) return '/static/*';
  return '/other';
}

function requestKind(url = '/', headers = {}) {
  if (headers.rsc === '1') return 'rsc';
  const pathname = url.split('?')[0];
  if (pathname.startsWith('/api/')) return 'api';
  if (pathname.startsWith('/_next/') || /\.(png|svg|ico|woff2?|css|js)$/.test(pathname)) return 'static';
  return 'html';
}

module.exports = { routeGroup, requestKind };
