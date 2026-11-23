# Browser dependency

- **Three.js 0.160.1**, classic UMD build (`three.min.js`).
- Source: https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.min.js
- License: MIT; see [THREE-LICENSE.txt](THREE-LICENSE.txt).

The version is pinned and served with the game, not fetched from a CDN at runtime.
The classic script build deliberately preserves opening `index.html` directly via
`file://` as well as GitHub Pages deployment, without requiring a bundler or npm.
Three.js is only used by the presentation layer; the solver and saved-game format
are unchanged. If WebGL is unavailable, the game uses its SVG renderer.
