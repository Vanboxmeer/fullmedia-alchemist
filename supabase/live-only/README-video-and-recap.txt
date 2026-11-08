2026-11-08 live-only edge function updates (deployed via MCP, verify_jwt=false):
- alchemist-video-plan v5: `get` also returns slides {slide, photo, words} and mode; new action `set_mode` {skus|sku, mode: prepared|short|''}.
- alchemist-recap v8: 546 fix. Montage tiles and slide renders run one at a time; pictures fetched small.
The dashboard (dashboard/index.html) draws "Prepared for video" slides and "Make the video" in the browser from the video plan. Nothing is stored.
