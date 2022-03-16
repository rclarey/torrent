<h1>
  A BitTorrent client for Deno
  <img align="right" width="200px" height="200px" src="https://user-images.githubusercontent.com/15111129/89845573-deca0380-db4c-11ea-839c-43efcfef7d75.png" />
</h1>

<a href="https://github.com/rclarey/torrent/actions">
  <img src="https://img.shields.io/github/workflow/status/rclarey/torrent/CI" alt="GitHub Workflow Status" />
</a>
<a href="https://github.com/rclarey/torrent/releases">
  <img src="https://img.shields.io/github/v/release/rclarey/torrent" alt="GitHub release (latest by date)" />
</a>
<a href="https://doc.deno.land/https/raw.githubusercontent.com/rclarey/torrent/master/mod.ts">
  <img src="https://doc.deno.land/badge.svg" alt="Documentation" />
</a>
<a href="https://deno-visualizer.danopia.net/dependencies-of/https/raw.githubusercontent.com/rclarey/torrent/master/client.ts">
  <img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fdeno-visualizer.danopia.net%2Fshields%2Fdep-count%2Fhttps%2Fraw.githubusercontent.com%2Frclarey%2Ftorrent%2Fmaster%2Fclient.ts" alt="Dependencies" />
</a>
<a href="https://github.com/rclarey/torrent/blob/master/LICENSE">
  <img src="https://img.shields.io/github/license/rclarey/torrent" alt="MIT License" />
</a>

This library is currently in development.

## Roadmap for initial release

- [x] HTTP(S) Tracker Protocol
- [x] Tracker Server Implementation
- [x] Compact Peer Lists (Client)
- [x] Compact Peer Lists (Server)
- [x] UDP Trackers (Server)
- [x] UDP Trackers (Client)
- [x] Peer Protocol
- [ ] Torrent level abstraction
  - [ ] Resumption of torrent
  - [ ] Economics for choking
  - [ ] End game mode
- [ ] Simple proof-of-concept CLI
- [ ] Multitracker Metadata Extension
- [ ] Magnet Links
- [ ] lots of tests
