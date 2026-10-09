#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const MAX_LINES = 2
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/
const SKIP = /(^|\/)(_bmad|_bmad-output|\.agents|\.claude\/skills|node_modules|dist)\/|\.d\.m?ts$/
const DIRECTIVE =
	/^\s*(\/\/\/\s*<reference|\/\/\s*@ts-|\/\*\s*@vite-ignore|\/\*\s*#__PURE__|\/\/\s*@vitest-environment|\/\*\*?\s*@vitest-environment|\/\/\s*biome-ignore|\/\/\s*eslint-|#!)/
const PROCESS_REF = [
	/\b[Ss]tor(y|ies) \d+[.-]\d+/,
	/\b[Ee]pics? \d+\b/,
	/\bN?FR-?\d+\b/,
	/\bAC-?\d+\b/,
	/\bUX-DR\d+\b/,
	/\bBUG-[A-Z0-9]+\b/,
	/\b[\w-]+\.(tsx?|jsx?|mjs|cjs):\d+/,
]

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const files = (
	args.length > 0
		? args
		: execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
				cwd: root,
				encoding: 'utf8',
			})
				.split('\n')
				.filter(Boolean)
).filter((f) => SOURCE.test(f) && !SKIP.test(f) && fs.existsSync(path.join(root, f)))

function collectComments(text, fileName) {
	const kind = /\.[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
	const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, kind)
	const seen = new Map()
	const add = (ranges) => {
		for (const r of ranges ?? []) seen.set(r.pos, r)
	}
	const visit = (node) => {
		add(ts.getLeadingCommentRanges(text, node.pos))
		add(ts.getTrailingCommentRanges(text, node.end))
		for (const child of node.getChildren(sf)) visit(child)
	}
	visit(sf)
	return { sf, comments: [...seen.values()].sort((a, b) => a.pos - b.pos) }
}

// JSDoc type tags are the type system in .mjs files, not prose.
const JSDOC_TYPE_TAG = /^\s*@(param|returns?|type|typedef|template|satisfies)\s*\{/

function contentLines(raw) {
	return raw
		.split('\n')
		.map((l) => l.replace(/^\s*(\/\*\*?|\*\/|\*|\/\/)?/, '').replace(/\*\/\s*$/, ''))
		.filter((l) => l.trim() !== '' && !JSDOC_TYPE_TAG.test(l)).length
}

const problems = []
for (const file of files) {
	const text = fs.readFileSync(path.join(root, file), 'utf8')
	const { sf, comments } = collectComments(text, file)
	const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1
	const groups = []
	for (const c of comments) {
		const raw = text.slice(c.pos, c.end)
		if (DIRECTIVE.test(raw)) continue
		const prev = groups.at(-1)
		const joinable =
			prev &&
			c.kind === ts.SyntaxKind.SingleLineCommentTrivia &&
			prev.kind === ts.SyntaxKind.SingleLineCommentTrivia &&
			prev.ownLine &&
			/^[ \t]*\r?\n[ \t]*$/.test(text.slice(prev.end, c.pos))
		if (joinable) {
			prev.end = c.end
			prev.raw += `\n${raw}`
		} else {
			const ownLine = text.slice(text.lastIndexOf('\n', c.pos - 1) + 1, c.pos).trim() === ''
			groups.push({ pos: c.pos, end: c.end, kind: c.kind, raw, ownLine })
		}
	}
	for (const g of groups) {
		const line = lineOf(g.pos)
		const n = contentLines(g.raw)
		if (n > MAX_LINES) problems.push(`${file}:${line}  comment is ${n} lines (max ${MAX_LINES})`)
		const ref = PROCESS_REF.find((re) => re.test(g.raw))
		if (ref) problems.push(`${file}:${line}  process/file reference: ${g.raw.match(ref)[0]}`)
	}
}

if (problems.length > 0) {
	console.error(problems.join('\n'))
	console.error(
		`\n${problems.length} comment problem(s). Delete comments the code already explains; keep only short notes on non-obvious behaviour, without story/epic/FR/AC or file:line references.`
	)
	process.exit(1)
}
console.log(`check-comments: ${files.length} files OK`)
