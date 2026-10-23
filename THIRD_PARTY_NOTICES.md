# Third-Party Notices

This project is released under the MIT License (see `LICENSE`). It bundles or depends on the following third-party works.

## Background removal model — U²-Netp

- Files: `public/models/U-2-Netp/` (`onnx/model.onnx`, `config.json`, `preprocessor_config.json`), redistributed unmodified
- Source: https://huggingface.co/BritishWerewolf/U-2-Netp (revision `7112208dbac3a3642496c8d54e2f0f9bb3dc1dc8`)
- Original project: https://github.com/xuebinqin/U-2-Net
- License: Apache License 2.0 (`public/models/U-2-Netp/LICENSE`)
- SHA-256 of `onnx/model.onnx`: `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`

## ONNX Runtime Web

- npm package `onnxruntime-web` (Microsoft), MIT License. Its WebAssembly runtime is copied to `public/ort/` at build time and served from this site.

## Pixel font — Fusion Pixel Font

- File: `public/fonts/fusion-pixel-12px-proportional-zh_hans.otf.woff2`, unmodified
- Source: https://github.com/TakWolf/fusion-pixel-font (release 2026.09.25)
- License: SIL Open Font License 1.1 (`public/fonts/OFL.txt`)

## HEIC decoding — heic2any

- npm package `heic2any`, MIT License. Loaded only when a HEIC/HEIF photo is selected.

## React

- npm packages `react`, `react-dom`, MIT License.

## MARD color data

- `src/core/palette-data.ts` lists MARD bead color codes with approximate screen colors, compiled from the public MARD color chart at https://www.pixel-beads.com/mard-bead-color-chart (retrieved 2026-10-04). MARD is a trademark of its owner; this project is not affiliated with MARD.
