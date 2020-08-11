<h1 align="center">
  <img width="200px" height="200px" src="https://user-images.githubusercontent.com/15111129/89845573-deca0380-db4c-11ea-839c-43efcfef7d75.png" />
  <br/> A Bittorrent client for Deno
</h1>
<p align="center">
  <a href="https://github.com/rclarey/torrent/actions">
    <img src="https://img.shields.io/github/workflow/status/rclarey/torrent/CI" alt="GitHub Workflow Status" />
  </a>
  <a href="https://github.com/rclarey/torrent/releases">
    <img src="https://img.shields.io/github/v/release/rclarey/torrent" alt="GitHub release (latest by date)" />
  </a>
  <a href="https://doc.deno.land/https/raw.githubusercontent.com/rclarey/torrent/master/mod.ts">
    <img src="https://doc.deno.land/badge.svg" alt="Documentation" />
  </a>
  <a href="https://github.com/rclarey/torrent/blob/master/LICENSE">
    <img src="https://img.shields.io/github/license/rclarey/torrent" alt="MIT License" />
  </a>
</p>

This library is currently in development.

## Roadmap for initial release
- [X] HTTP(S) Tracker Protocol
- [X] Tracker Server Implementation
- [X] Compact Peer Lists (Client)
- [X] Compact Peer Lists (Server)
- [X] UDP Trackers (Server)
- [X] UDP Trackers (Client)
- [X] Peer Protocol
- [ ] Torrent level abstraction
  - [ ] Resumption of torrent
  - [ ] Economics for choking
  - [ ] End game mode
- [ ] Simple proof-of-concept CLI
- [ ] Multitracker Metadata Extension
- [ ] Magnet Links
- [ ] lots of tests
