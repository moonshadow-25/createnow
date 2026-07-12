---
name: createnow-image
description: Generate or edit images through the CreateNow official image API. Use when the user asks to create an image from text, transform an image, or generate visual assets with CreateNow.
---

# CreateNow Image

Use the bundled CLI to generate images through the CreateNow official API.

## Configuration

The downloaded skill includes a local `.env` with its CreateNow API configuration and a `models.json` list of available image models. Do not print, move, commit, or pass the API key as a command argument. Explicit environment variables can override the downloaded configuration when needed.

## Commands

List available models and the default model:

```bash
python scripts/createnow_image.py models
```

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

Use `--model` to choose an explicit model shown by the `models` command. Without `--model`, the downloaded default model is used.

Use `--json` when a machine-readable API response is needed. Otherwise the CLI downloads the first returned image and prints the absolute output path and source URL.

## Behavior

- Send text-to-image requests to `POST /images/generations` with `model`, `prompt`, and `size`.
- Send image-to-image requests to the same endpoint with an additional `image` array. Local files are converted to a data URI; URLs are sent unchanged.
- Treat output URLs as the generated image result. Download them immediately when `--output` is provided because providers may expire result URLs.
- Report API errors without exposing `CREATENOW_API_KEY`.
- Do not claim the image is generated until the API response contains an image URL and the requested output file has been written.
