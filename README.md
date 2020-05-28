<p align="center">
<img width="256" alt="bt" src="https://user-images.githubusercontent.com/15111129/83200372-2c6bce00-a111-11ea-88cc-6531d9d3d97d.png">
</p>

<h3 align="center">a bittorrent client for deno</h3>
<br>
<p align="center">
  <a href="https://github.com/rclarey/bt/actions">
    <img alt="GitHub Workflow Status" src="https://img.shields.io/github/workflow/status/rclarey/bt/CI">
  </a>
  <a href="https://github.com/rclarey/bt/releases">
    <img alt="GitHub release (latest by date)" src="https://img.shields.io/github/v/release/rclarey/bt">
  </a>
  <a href="https://doc.deno.land/https/raw.githubusercontent.com/rclarey/bt/master/mod.ts">
    <img alt="Documentation" src="https://doc.deno.land/badge.svg">
  </a>
  <a href="https://github.com/rclarey/bt/blob/master/LICENSE">
    <img alt="GitHub" src="https://img.shields.io/github/license/rclarey/bt">
  </a>
</p>
<hr>

bt is currently very early in development

## Roadmap for initial release
- [X] HTTP(S) Tracker Protocol
- [X] Tracker Server Implementation
- [X] Compact Peer Lists (Client)
- [X] Compact Peer Lists (Server)
- [X] UDP Tracker Server
- [ ] UDP Tracker Protocol
- [ ] Peer Protocol
- [ ] Resumption of torrent
- [ ] Torrent level abstraction
  - [ ] Economics for choking
  - [ ] End game mode
- [ ] Simple proof-of-concept CLI
- [ ] Multitracker Metadata Extension
- [ ] Magnet Links
- [ ] lots of tests
