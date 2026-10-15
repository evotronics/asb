# asb ChangeLog

## 0.1.0 - TBD

### Changed
- **BREAKING**: Rewrite in JavaScript (Node.js >= 22.12) as an installable
  `asb` command (also installed as `anything-sandbox`). Renamed from "Agent
  Sandbox" to "Anything Sandbox".

## Classic shell version

The original `asb` (2026) was a bash script, `asb`, configured with `ASB_*`
environment variables or a sourced `asb.conf` file, and ran one container
per checkout of the script. It was replaced by this rewrite.
