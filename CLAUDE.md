# Code comments

Write code without comments by default. Add one only when it explains something a senior developer would struggle to work out from the code itself: a non-obvious why, a library or browser workaround, an ordering or security constraint, a subtle formula.

When a comment is warranted:

- Keep it to 1-2 lines.
- Never reference stories, epics, FR/AC/NFR ids, reviews, or file:line locations. That context belongs in commits and PRs.
- Never narrate what the code does, restate names or types, describe history ("previously", "fixed by"), or leave commented-out code.
- No JSDoc that only paraphrases the signature.

`pnpm lint:comments` (part of `pnpm lint` and CI) fails on comment blocks over 2 lines and on story/epic/FR/AC/file:line references.
