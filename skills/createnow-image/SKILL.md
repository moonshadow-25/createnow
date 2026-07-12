---
name: createnow-image
description: Generate or edit images through the CreateNow official image API. Use when the user asks to create an image from text, transform an image, or generate visual assets with CreateNow.
---

# CreateNow Image

Use the bundled CLI to generate images through the CreateNow official API.

## Required environment

The caller must provide a CreateNow API key through `CREATENOW_API_KEY`. Never ask for, print, store, or place the key in a command argument.

```bash
export CREATENOW_API_KEY="..."
```

Optional environment variables:

- `CREATENOW_API_BASE_URL`: API base URL. Defaults to `https://myapi.firstarpc.com/v1`.
- `CREATENOW_IMAGE_MODEL`: Default image model. Defaults to `nova-pro`.

## Commands

Generate an image from text:

```bash
python scripts/createnow_image.py generate \
  --prompt "A cinematic mountain lake at sunrise, photorealistic" \
  --size 1024x1024 \
  --output ./createnow-image.png
```

Edit an existing local image:

```bash
python scripts/createnow_image.py edit \
  --image ./source.png \
  --prompt "Change the scene to a rainy neon city at night" \
  --size 1024x1024 \
  --output ./createnow-edited.png
```

Edit from an accessible image URL:

```bash
python scripts/createnow_image.py edit \
  --image-url "https://example.com/source.png" \
  --prompt "Turn this into a clean watercolor illustration" \
  --size 1024x1024 \
  --output ./createnow-edited.png
```

Use `--model` to choose an explicit available model. Known models include `nova-pro`, `nova-max`, `r-gi2`, and `g-gi2`.

Use `--json` when a machine-readable API response is needed. Otherwise the CLI downloads the first returned image and prints the absolute output path and source URL.

## Behavior

- Send text-to-image requests to `POST /images/generations` with `model`, `prompt`, and `size`.
- Send image-to-image requests to the same endpoint with an additional `image` array. Local files are converted to a data URI; URLs are sent unchanged.
- Treat output URLs as the generated image result. Download them immediately when `--output` is provided because providers may expire result URLs.
- Report the API error response without exposing `CREATENOW_API_KEY`.
- Do not claim the image is generated until the API response contains an image URL and the requested output file has been written.
