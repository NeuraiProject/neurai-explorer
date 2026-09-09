import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

for (const enabled of [false, true]) {
    test(`Prisma diagnostics ${enabled ? 'publish only durations' : 'do not register query events when disabled'}`, () => {
        let options, listener;
        const messages = [];
        runInNewContext(source, {
            exports: {}, process: { env: { NODE_ENV: 'production', EXPLORER_METRICS: enabled ? '1' : '0' } },
            require(name) {
                if (name === 'node:diagnostics_channel') return { channel: () => ({ publish: value => messages.push(JSON.stringify(value)) }) };
                if (name === '@prisma/client') return { PrismaClient: class {
                    constructor(config) { options = config; }
                    $on(event, callback) { assert.equal(event, 'query'); listener = callback; }
                } };
                throw new Error(`Unexpected import: ${name}`);
            },
        });
        if (enabled) {
            assert.ok(options.log.some(entry => entry.emit === 'event' && entry.level === 'query'));
            listener({ duration: 12, query: 'private SQL', params: 'private parameters', target: 'private connection' });
            assert.deepEqual(messages, ['{"duration_ms":12}']);
        } else {
            assert.equal(listener, undefined);
            assert.equal(JSON.stringify(options.log), '["error"]');
        }
    });
}
