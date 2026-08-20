# Capture backends

## Browser discovery

The first executable found wins:

1. configured `chromiumPath` or `OPENCODE_SEE_CHROMIUM`;
2. `chromium-browser`;
3. `google-chrome`;
4. home snap launcher and `/snap/bin/chromium` on Linux;
5. `chromium`;
6. the standard Google Chrome app path on macOS;
7. Microsoft Edge under Program Files on Windows.

## CDP first

The primary path starts Chromium with an ephemeral profile and
`--remote-debugging-port=0`. The plugin reads `DevToolsActivePort`, discovers
the page target over loopback HTTP, and uses the built-in Node WebSocket to:

1. enable the Page domain;
2. set viewport metrics;
3. navigate to the URL;
4. wait for load plus the configured virtual-time budget;
5. call `Page.captureScreenshot` with `captureBeyondViewport`;
6. write the returned PNG bytes itself.

No browser automation framework is installed.

## CLI fallback

For a normal Chromium or Chrome executable, a CDP failure falls back to:

```text
chromium --headless=new --disable-gpu \
  --screenshot=<path> --window-size=<width>,<height> \
  --virtual-time-budget=<milliseconds> <url>
```

Snap Chromium is different. Snap gives Chromium a private view of `/tmp`, so a
CLI process may report success while the host cannot see the screenshot file.
For a detected snap launcher, CDP is mandatory and CLI fallback is disabled.
The temporary CDP profile lives in snap-visible user storage, while image bytes
return over loopback WebSocket.

## Installing a browser

Ubuntu/Debian:

```bash
sudo apt install chromium-browser
```

Fedora:

```bash
sudo dnf install chromium
```

macOS and Windows users may install Google Chrome; Windows can also use the
bundled Microsoft Edge. Set `OPENCODE_SEE_CHROMIUM` when auto-discovery does not
find the executable.
