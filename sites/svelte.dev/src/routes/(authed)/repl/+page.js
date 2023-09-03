import { redirect } from '@sveltejs/kit';

export function load({ url }) {
	const query = url.searchParams;
	const gist = query.get('gist');
	const example = query.get('example');
	const version = query.get('version');
	const vim = query.get('vim');

	// redirect to v2 REPL if appropriate
	if (/^[^>]?[12]/.test(version)) {
		throw redirect(302, `https://v2.svelte.dev/repl?${query}`);
	}

	const id = gist || example || 'hello-world';
	// we need to filter out null values
	const q = new URLSearchParams(
		Object.entries({
			version,
			vim
		}).filter(([, value]) => value !== null)
	).toString();
	throw redirect(301, `/repl/${id}?${q}`);
}
