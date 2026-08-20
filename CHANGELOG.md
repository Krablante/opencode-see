# Changelog

All notable changes to this project are documented here.

## Unreleased

## 0.3.0 - 2026-08-20

- Let `image_view` inspect the latest image batch or up to five newest unique
  images already stored in the calling OpenCode session, including top-level
  user file parts and completed tool attachments.
- Add an optional per-call `question` to `image_view` and `screenshot`, appended
  to the configured baseline prompt so text-only callers receive focused,
  visibly grounded answers from the vision delegate.
- Guide only text-only active models to use `image_view` immediately for opaque
  image attachments instead of searching the filesystem or guessing, while
  leaving native vision model prompts unchanged.
- Keep session retrieval current-session-only, data-URL-only, signature-checked,
  cacheless, and bounded to five returned images.

## 0.2.0 - 2026-08-20

- Add configurable vision delegation through a temporary OpenCode session so
  text-only active models receive grounded image descriptions without plugin
  credentials or a core patch.
- Preserve the zero-overhead native attachment path for models that declare
  image input support, and report explicit errors when delegation is disabled or
  fails.
- Add active-model capability tracking, SDK session cleanup, bounded timeouts,
  an unrestricted one-string `provider/model` delegate switch with legacy
  compatibility, environment overrides, unit coverage, and English/Russian
  documentation.
- Restore the latest image tool batch for the immediate continuation after
  compatible remote mid-turn compaction, without a separate provider or config
  lookup, caching, persistent state, or changes to ordinary OpenCode and local
  provider paths.

## 0.1.0 - 2026-08-20

- Add `image_view` for one to five local PNG, JPEG, WebP, or GIF files.
- Add path authorization, signature-based MIME detection, dimensions, and core-resize metadata.
- Add CDP-first Chromium page capture with a lightweight CLI fallback.
- Add portable configuration, English and Russian documentation, tests, and reproducible demos.
