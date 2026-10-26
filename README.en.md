<div align="center">

<img src=".github/assets/logo.svg" alt="DouDou" width="72">

# DouDou · Bead Pattern Maker

**Turn any image into a ready-to-make fuse bead (拼豆) pattern. Free, open source, and your image never leaves the browser.**

[Try it online](https://zlgan-spec.github.io/doudou-pindou/) · [Make a pattern](https://zlgan-spec.github.io/doudou-pindou/#/make) · [Color chart](https://zlgan-spec.github.io/doudou-pindou/#/colors)

[![Try it online](https://img.shields.io/badge/try_it-zlgan--spec.github.io-1a1a1a?style=flat-square)](https://zlgan-spec.github.io/doudou-pindou/) [![MIT](https://img.shields.io/badge/license-MIT-1a1a1a?style=flat-square)](LICENSE)

[中文](README.md) · **English**

<img src=".github/assets/screenshot.png" alt="Pattern editor" width="880">

</div>

> The interface is in Chinese for now.

## Features

- **Image in, pattern out**: drop, paste or pick an image - cartoons, pixel art and photos, including iPhone HEIC
- **Board sizes**: auto, 52×52, 78×78, 104×104 pegboards, or a custom size; anything larger than 104 is split into 104 boards with seams and board labels
- **Standard pattern sheet**: color code in every cell, a bold line every 10 beads, coordinates on all four sides, and a legend with the bead count per color
- **Adjustable color count**: slide left to merge colors, right to add shades; applied on release
- **Built-in editor**: brush, fill, selection, text, multi-ring outline, denoise, mirror, background removal, side-by-side reference, full undo
- **Re-editable downloads**: the PNG carries the pattern data, so you can drop it back in and keep editing; large patterns download as a zip with an overview plus one sheet per board
- **Color chart**: all 221 MARD colors, searchable by code or hex, click to copy

## Privacy

Images are processed in your browser and never uploaded. No accounts, no analytics, no personal data. Favorites and settings stay in your own browser.

## How it works

The input is first classified as pixel art, flat artwork or a photo. Pixel art is mapped back to its original grid, one bead per pixel; flat artwork keeps its own palette; photos are quantized by color family. Background removal runs a ~4 MB model in the browser. Every pattern is placed on the smallest board that fits it (52 / 78 / 104), and larger ones are tiled with 104 boards. See [How it works](docs/how-it-works.md) (Chinese).

## Run locally

Requires Node.js 20+.

```bash
npm install
npm run dev     # open http://localhost:5190
npm test
```

## Roadmap

- [x] Image to pattern, online editing, re-editable downloads
- [x] Auto and custom sizes, large patterns split into 104 boards
- [x] Two-way color count adjustment
- [x] Pattern library: original patterns, added over time
- [x] Line cleanup
- [ ] Full background fill (for coasters)
- [ ] One-click palette swap
- [ ] Mirror symmetry fix

## Contributing

- Bugs and ideas: [open an issue](https://github.com/zlgan-spec/doudou-pindou/issues/new/choose)
- Submitting patterns or code: see [CONTRIBUTING.md](CONTRIBUTING.md) (Chinese)
- Copyright concerns about a pattern: use the "copyright" issue template and it will be reviewed and removed if confirmed

## Credits and license

Color codes compiled from the public MARD color chart (MARD is a trademark of its owner; this project is not affiliated with MARD). Background removal model U²-Netp (Apache-2.0). Pixel font Fusion Pixel Font (OFL-1.1). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Code released under the [MIT](LICENSE) license.
