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

## Text tool fonts

All four are licensed under the SIL Open Font License 1.1, which allows commercial use, embedding and redistribution. "Common characters" below means GB2312 level-1 hanzi (3,755) plus ASCII and common Chinese punctuation; characters outside a subset fall back to Fusion Pixel 12px.

### Fusion Pixel Font

- Files: `public/fonts/fusion-pixel-12px-proportional-zh_hans.otf.woff2` (release 2026.09.25, unmodified); `public/fonts/fusion-pixel-8px-proportional-zh_hans-common.woff2` (release 2026.11.10, subset to common characters)
- Source: https://github.com/TakWolf/fusion-pixel-font
- Copyright (c) 2022, TakWolf
- License: SIL Open Font License 1.1 (`public/fonts/OFL.txt`)

### Resource Han Rounded

- File: `public/fonts/resource-han-rounded-cn-bold-common.woff2` (CN Bold, release v0.990, subset to common characters)
- Source: https://github.com/CyanoHao/Resource-Han-Rounded
- Copyright © 2018—2022 Cyano Hao. Portions © 2014-2021 Adobe, with Reserved Font Name 'Source'.
- License: SIL Open Font License 1.1 (`public/fonts/OFL-resource-han-rounded.txt`)

### ZCOOL QingKe HuangYou（站酷庆科黄油体）

- File: `public/fonts/zcool-qingke-huangyou-common.woff2` (subset to common characters)
- Source: https://github.com/google/fonts/tree/main/ofl/zcoolqingkehuangyou
- Copyright 2018 The ZCOOL QingKe HuangYou Project Authors
- License: SIL Open Font License 1.1 (`public/fonts/OFL-zcool-qingke-huangyou.txt`)

### Smiley Sans（得意黑）

- File: `public/fonts/SmileySans-Oblique.ttf.woff2`, unmodified (the license reserves the names "Smiley" and "得意黑", so it is not subset)
- Source: https://github.com/atelier-anchor/smiley-sans (release v2.0.1)
- Copyright (c) 2022--2024, atelierAnchor, with Reserved Font Name <Smiley> and <得意黑>.
- License: SIL Open Font License 1.1 (`public/fonts/OFL-smiley-sans.txt`)

## HEIC decoding — heic2any

- npm package `heic2any`, MIT License. Loaded only when a HEIC/HEIF photo is selected.

## React

- npm packages `react`, `react-dom`, MIT License.

## MARD color data

- `src/core/palette-data.ts` lists MARD bead color codes with approximate screen colors, compiled from the public MARD color chart at https://www.pixel-beads.com/mard-bead-color-chart (retrieved 2026-10-04). MARD is a trademark of its owner; this project is not affiliated with MARD.
