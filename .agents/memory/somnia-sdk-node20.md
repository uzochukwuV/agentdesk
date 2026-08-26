---
name: Somnia SDK on Node 20
description: Runtime compatibility requirement for the Somnia markets SDK price-feed subscription.
---

The Somnia markets SDK price-feed subscription expects a browser-style global `WebSocket`, which Node 20 does not provide. Use the already-installed `ws` package as the global bridge before constructing or starting the engine.

**Why:** Without the bridge, the server can bind its HTTP port but engine startup fails when the SDK hydrates its price-feed WebSocket.

**How to apply:** Keep the bridge in the server bootstrap path for Node 20 deployments; do not expose wallet keys or move them into client-visible configuration.