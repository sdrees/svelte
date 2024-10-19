import * as fs from 'node:fs';
import { assert } from 'vitest';
import { migrate } from 'svelte/compiler';
import { try_read_file } from '../helpers.js';
import { suite, type BaseTest } from '../suite.js';

interface ParserTest extends BaseTest {
	skip_filename?: boolean;
	logs?: string[];
}

const { test, run } = suite<ParserTest>(async (config, cwd) => {
	const input = fs
		.readFileSync(`${cwd}/input.svelte`, 'utf-8')
		.replace(/\s+$/, '')
		.replace(/\r/g, '');

	const logs: any[] = [];

	if (config.logs) {
		console.log = (...args) => {
			logs.push(...args);
		};
	}

	const actual = migrate(input, {
		filename: config.skip_filename ? undefined : `output.svelte`
	}).code;

	if (config.logs) {
		assert.deepEqual(logs, config.logs);
	}

	// run `UPDATE_SNAPSHOTS=true pnpm test migrate` to update parser tests
	if (process.env.UPDATE_SNAPSHOTS || !fs.existsSync(`${cwd}/output.svelte`)) {
		fs.writeFileSync(`${cwd}/output.svelte`, actual);
	} else {
		fs.writeFileSync(`${cwd}/_actual.svelte`, actual);

		const expected = try_read_file(`${cwd}/output.svelte`);
		assert.deepEqual(actual.trim(), expected?.trim());
	}
});

export { test };

await run(__dirname);
