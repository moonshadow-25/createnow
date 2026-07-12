#!/usr/bin/env python3
"""CreateNow official image API command-line client."""

import argparse
import base64
import json
import mimetypes
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_BASE_URL = "https://myapi.firstarpc.com/v1"
DEFAULT_MODEL = "nova-pro"


def fail(message: str, status: int = 1) -> None:
    print(f"Error: {message}", file=sys.stderr)
    raise SystemExit(status)


def get_api_key() -> str:
    api_key = os.environ.get("CREATENOW_API_KEY", "").strip()
    if not api_key:
        fail("CREATENOW_API_KEY is required.")
    return api_key


def get_base_url() -> str:
    return os.environ.get("CREATENOW_API_BASE_URL", DEFAULT_BASE_URL).rstrip("/")


def image_data_uri(image_path: Path) -> str:
    if not image_path.is_file():
        fail(f"Image file not found: {image_path}")
    content_type, _ = mimetypes.guess_type(image_path.name)
    if content_type not in {"image/jpeg", "image/png", "image/webp"}:
        fail("Only JPEG, PNG, and WebP images are supported.")
    encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return f"data:{content_type};base64,{encoded}"


def post_image_request(payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        f"{get_base_url()}/images/generations",
        data=body,
        headers={
            "Authorization": f"Bearer {get_api_key()}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=180) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        fail(f"CreateNow API returned HTTP {exc.code}: {detail}")
    except URLError as exc:
        fail(f"Could not reach CreateNow API: {exc.reason}")
    except json.JSONDecodeError:
        fail("CreateNow API returned invalid JSON.")


def get_image_url(response: dict) -> str:
    items = response.get("data")
    if not isinstance(items, list) or not items:
        fail(f"CreateNow API returned no images: {json.dumps(response, ensure_ascii=False)}")
    url = items[0].get("url") if isinstance(items[0], dict) else None
    if not isinstance(url, str) or not url:
        fail("CreateNow API returned an image without a URL.")
    return url


def download_image(url: str, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    request = Request(url, headers={"User-Agent": "CreateNowImageSkill/1.0"})
    try:
        with urlopen(request, timeout=180) as response:
            output.write_bytes(response.read())
    except HTTPError as exc:
        fail(f"Generated image download returned HTTP {exc.code}.")
    except URLError as exc:
        fail(f"Could not download generated image: {exc.reason}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate and edit images with CreateNow.")
    parser.add_argument("--model", default=os.environ.get("CREATENOW_IMAGE_MODEL", DEFAULT_MODEL))
    parser.add_argument("--size", default="1024x1024")
    parser.add_argument("--output", "-o", type=Path)
    parser.add_argument("--json", action="store_true", dest="as_json")

    subcommands = parser.add_subparsers(dest="command", required=True)
    generate = subcommands.add_parser("generate", help="Generate an image from text.")
    generate.add_argument("--prompt", required=True)

    edit = subcommands.add_parser("edit", help="Generate an image from a source image and prompt.")
    edit.add_argument("--prompt", required=True)
    source = edit.add_mutually_exclusive_group(required=True)
    source.add_argument("--image", type=Path)
    source.add_argument("--image-url")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    payload = {"model": args.model, "prompt": args.prompt, "size": args.size, "response_format": "url"}

    if args.command == "edit":
        source = args.image_url if args.image_url else image_data_uri(args.image)
        payload["image"] = [source]

    response = post_image_request(payload)
    image_url = get_image_url(response)

    if args.as_json:
        print(json.dumps(response, ensure_ascii=False))
        return

    if not args.output:
        print(image_url)
        return

    download_image(image_url, args.output)
    print(f"Saved image: {args.output.resolve()}")
    print(f"Source URL: {image_url}")


if __name__ == "__main__":
    main()
