import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Kumo (https://github.com/cloudflare/kumo) is a React component library, but this app only consumes its Tailwind CSS tokens (see src/global.css) - its React runtime must never end up in the client/server bundles. This scans build output for telltale strings so an accidental JS import of the package gets caught instead of silently shipping React.
// A bare `createElement` isn't safe to match on its own - Qwik's own runtime calls `document.createElement(...)` all over its output - so `createElement` is only flagged when qualified as `React.createElement`, alongside the `react-dom` package name and bare `"react"`/`'react'` import specifiers.
const FORBIDDEN_PATTERN = /react-dom|(["'])react\1|React\.createElement/;

const targetDir = process.argv[2] ?? 'dist';

const walk = async (dir: string): Promise<string[]> => {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async (entry) => {
			const entryPath = join(dir, entry.name);
			return entry.isDirectory() ? walk(entryPath) : [entryPath];
		}),
	);
	return files.flat();
};

const files = await walk(targetDir);

const offenders: { file: string; matches: string[] }[] = [];

for (const file of files) {
	const content = await readFile(file, 'utf-8');
	const matches = content.match(new RegExp(FORBIDDEN_PATTERN, 'g'));
	if (matches) {
		offenders.push({ file, matches: [...new Set(matches)] });
	}
}

if (offenders.length > 0) {
	const summary = offenders.map(({ file, matches }) => `  ${file} (${matches.join(', ')})`).join('\n');
	throw new Error(`Found forbidden pattern ${FORBIDDEN_PATTERN} in "${targetDir}" - React appears to have been bundled:\n${summary}`);
}

console.log(`No occurrences of ${FORBIDDEN_PATTERN} found in "${targetDir}".`);
