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

For a normal Chromium or Chrome executable, a CDP failure may fall back while
capture time remains. Cancellation and timeout never trigger fallback:

```text
chromium --headless=new --disable-gpu \
  --user-data-dir=<temporary-profile> \
  --screenshot=<path> --window-size=<width>,<height> \
  --virtual-time-budget=<milliseconds> <url>
```

The CLI runs with an isolated profile. Its PNG is read from that profile, the
browser is stopped, and the profile is removed. The plugin then saves the final
output with exclusive creation, just as it does for CDP.

Snap Chromium is different. Snap gives Chromium a private view of `/tmp`, so a
CLI process may report success while the host cannot see the screenshot file.
For a detected snap launcher, CDP is mandatory and CLI fallback is disabled.
The temporary CDP profile lives in snap-visible user storage, while image bytes
return over loopback WebSocket.

## Timeout and cancellation

`screenshotTimeoutMs` (30,000 by default) is one budget for browser startup,
CDP discovery, navigation, late-content waiting, capture, and any CLI fallback.
It does not restart for each command or backend. Both backends stop on the
calling tool's abort signal. Shutdown and profile removal finish before the
result is returned and may add a short cleanup delay after the deadline.

The browser is given one second to exit after SIGTERM; if necessary, SIGKILL
follows and the plugin waits for exit before removing its profile. On Unix the
browser has its own process group: shutdown also kills remaining children after
the launcher exits, preventing late writes from recreating the profile. No
cleanup daemon or persistent browser is involved.

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
