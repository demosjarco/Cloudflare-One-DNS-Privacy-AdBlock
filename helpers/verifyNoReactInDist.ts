import { readFile, readdir, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

// Kumo (https://github.com/cloudflare/kumo) is a React component library, but this app only consumes its Tailwind CSS tokens (see src/global.css) - its React runtime must never end up in the client/server bundles. This scans build output for telltale strings so an accidental JS import of the package gets caught instead of silently shipping React.
// A bare `createElement` isn't safe to match on its own - Qwik's own runtime calls `document.createElement(...)` all over its output - so `createElement` is only flagged when qualified as `React.createElement`, alongside the `react-dom` package name and bare `"react"`/`'react'` import specifiers.
const FORBIDDEN_PATTERN = /react-dom|(["'])react\1|React\.createElement/;

// CodeQL (js/path-injection) rightly flags a raw argv value reaching readdir/readFile - resolve + realpath it and pin it under the project root before it ever touches the filesystem, mirroring CodeQL's own documented sanitizer shape (resolve -> realpath -> startsWith(root)). Kept as an iterative walk in this same scope, rather than a recursive helper taking `dir` as a parameter, so the validated path and every read stay in one traceable flow.
const projectRoot = await realpath(process.cwd());
const projectRootWithSep = projectRoot + sep;
const targetDir = await realpath(resolve(projectRoot, process.argv[2] ?? 'dist'));
if (targetDir !== projectRoot && !targetDir.startsWith(projectRootWithSep)) {
	throw new Error(`Refusing to scan "${targetDir}" - it escapes the project root "${projectRoot}".`);
}

const offenders: { file: string; matches: string[] }[] = [];
const queue = [targetDir];

let dir: string | undefined;
while ((dir = queue.shift()) !== undefined) {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			queue.push(entryPath);
			continue;
		}

		const content = await readFile(entryPath, 'utf-8');
		const matches = content.match(new RegExp(FORBIDDEN_PATTERN, 'g'));
		if (matches) {
			offenders.push({ file: entryPath, matches: [...new Set(matches)] });
		}
	}
}

if (offenders.length > 0) {
	const summary = offenders.map(({ file, matches }) => `  ${file} (${matches.join(', ')})`).join('\n');
	throw new Error(`Found forbidden pattern ${FORBIDDEN_PATTERN} in "${targetDir}" - React appears to have been bundled:\n${summary}`);
}

console.log(`No occurrences of ${FORBIDDEN_PATTERN} found in "${targetDir}".`);
