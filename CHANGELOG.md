# Changelog

[English](./CHANGELOG.md) · [Русский](./CHANGELOG.ru.md) · [Home](./README.md)

All notable changes to this project are documented here.

## Unreleased

- Read session history in growing tail windows for both image-source modes;
  stop after the requested batch or five recent unique images. Decode only
  selected candidates and reuse stored base64 instead of encoding it again.
- Limit images to 20 MiB, read local files sequentially, and propagate tool
  cancellation to file and session reads. Support short lossless WebP headers.
- Disable tools in vision delegate sessions, stop server-side execution on
  timeout/cancellation even when retaining the session, and reject partial
  assistant text accompanied by a server error. Propagate caller cancellation.
  Guide text-only callers to `screenshot` for requested web pages as well as
  `image_view` for existing images.
- Validate config object shapes and timer ranges; do not infer image capability
  merely from the configured delegate name. Cancel capability lookups with the
  calling tool and bound optional compaction-history recovery to five seconds.
- Bound screenshot viewports to 32 megapixels, capture the viewport consistently,
  validate returned PNG headers, and reject symlink escapes from the output root.
  Fix permission checks for dot-prefixed child paths.
- Honor explicit browser selection without silent substitution; discover standard
  Windows Chrome installations.
- Organize the handbook into matching English and Russian usage, configuration,
  operations, and architecture pages. Shorten README and localize contributor,
  security, and changelog pages with an extensible language-suffix convention.
- Make the example configuration portable and demo media explicit illustrated
  tool calls. Remove a brittle binary-media comparison and bound demo rendering
  threads.
- Mark the package private to prevent npm publication; remove the unused failing
  publish workflow and destructive standalone staging script. Keep GitHub and
  existing operator deployment as the distribution paths.

## 0.4.1 - 2026-09-16

- Keep permission helpers out of the plugin entry point so OpenCode does not
  mistake them for plugin initializers and report a failed load.
- Share one capture timeout across CDP discovery, navigation, capture, and CLI
  fallback. Cancellation and timeout never start another browser attempt.
- Settle CDP commands and event waits on connection failure or shutdown, avoiding
  unhandled rejections after a failed navigation.
- Wait for browser exit and remove temporary profiles on success and failure.
  On Unix, terminate the capture's isolated process group, including children
  that outlive the launcher and could recreate a deleted profile.
  Give CLI capture its own profile and save both backends with exclusive output
  creation, avoiding default-profile collisions and accidental overwrites.

## 0.4.0 - 2026-08-22

- Add `visionDelegate.forceFor`, an exact `provider/model` list that routes
  selected native-vision callers through the configured delegate while keeping
  automatic delegation for text-only models.
- Return delegated text without image attachments for forced callers, allowing
  operators to avoid provider-specific attachment handling without changing
  OpenCode or OpenCodez core.
- Keep the default path unchanged and allocation-light: routing adds one exact
  list check, and native vision still returns the original attachment without an
  extra model request.

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
