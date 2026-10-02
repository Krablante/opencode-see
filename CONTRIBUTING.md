# Contributing

[English](./CONTRIBUTING.md) · [Русский](./CONTRIBUTING.ru.md) · [Home](./README.md)

Say what changed and why. A reviewer should not have to reverse-engineer the
reason from a polished wall of generated text.

For a bug fix:

1. reproduce the behavior with the smallest useful case;
2. change the smallest compatible surface;
3. add or adjust a central test that proves the contract;
4. run `npm run check`;
5. describe the tradeoff in the pull request.

Open an issue before starting a large feature or dependency. The project stays
small on purpose: no browser framework, provider SDK, auth system, image index,
or background service unless a measured requirement makes it unavoidable.

Do not commit credentials, private paths, real operator configuration, captured
personal images, or machine topology. Demo media must be reproducible from
disposable local inputs through `npm run demos`.

## Develop and verify

```bash
npm ci
npm run check
```

`src/index.ts` is loaded directly by OpenCode; no compile or bundle step is
needed. The only runtime dependency is `@opencode-ai/plugin`. Use the existing
test files to protect important behavior rather than adding a new test harness.
CI runs the same checks on Node.js 22. Real browser and provider behavior also
needs a targeted smoke check when those boundaries change.

`npm run demos` regenerates illustrated walkthroughs from disposable local
images and an actual localhost capture. It needs FFmpeg with the ASS filter,
DejaVu Sans / Sans Mono, and a Chromium executable. Use
`OPENCODE_SEE_DEMO_FONTS_DIR` for a nonstandard font directory and
`OPENCODE_SEE_CHROMIUM` for a nonstandard browser. Review both GIFs visually.
Browser and FFmpeg versions affect output bytes; binary equality is not a
useful CI contract for these media. Temporary inputs are removed on completion.

## Documentation and languages

README introduces the product and owns installation. The four handbook topics
are usage, configuration, operations, and architecture. Keep each explanation
in its owning page and link to it. Development belongs here; vulnerability
reporting belongs in SECURITY; version history belongs in CHANGELOG.

Language editions live side by side: `topic.md` is English, `topic.ru.md` is
Russian. Apply the same rule to README, CONTRIBUTING, SECURITY, and CHANGELOG.
Use the same topic set and link to the reader's language. The original LICENSE
and NOTICE remain authoritative legal texts.

To add a language, add matching pages with its language-code suffix (for example
`.uk.md` or `.de.md`) and extend the language links. There is no two-language
runtime or generator to rewrite. When behavior changes, update the meaning in
all existing editions in the same change; translations need not copy sentence
structure.

Distribution is GitHub-only. Do not publish to npm. Release tags should identify
the checked source, and release notes should match the changelog. Keep the
package private; it does not restrict the license or local plugin loading.
