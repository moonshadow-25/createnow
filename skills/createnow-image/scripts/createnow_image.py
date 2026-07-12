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
SKILL_DIR = Path(__file__).resolve().parent.parent


def fail(message: str, status: int = 1) -> None:
    print(f"Error: {message}", file=sys.stderr)
    raise SystemExit(status)


def _parse_dotenv_value(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] == '"':
        value = value[1:-1]
        return value.replace("\\n", "\n").replace("\\r", "\r").replace('\\"', '"').replace("\\\\", "\\")
    return value


def load_dotenv(path: Path = SKILL_DIR / ".env") -> dict[str, str]:
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key:
            values[key] = _parse_dotenv_value(value)
    return values


def get_config_value(name: str, dotenv: dict[str, str], default: str = "") -> str:
    return os.environ.get(name, "").strip() or dotenv.get(name, "").strip() or default


def load_models(path: Path = SKILL_DIR / "models.json") -> dict:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"Could not load models.json: {exc}")
    models = raw.get("models") if isinstance(raw, dict) else None
    default_model = raw.get("default_model") if isinstance(raw, dict) else None
    if not isinstance(models, list) or not isinstance(default_model, str) or not default_model.strip():
        fail("models.json must contain models and default_model.")

    cleaned = []
    for item in models:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        model = str(item.get("model") or "").strip()
        if label and model:
            cleaned.append({"label": label, "model": model})
    return {"models": cleaned, "default_model": default_model.strip()}


def redact(value: str, api_key: str) -> str:
    return value.replace(api_key, "[REDACTED]") if api_key else value


def get_api_key(dotenv: dict[str, str]) -> str:
    api_key = get_config_value("CREATENOW_API_KEY", dotenv)
    if not api_key:
        fail("CREATENOW_API_KEY is required.")
    return api_key


def get_base_url(dotenv: dict[str, str]) -> str:
    return get_config_value("CREATENOW_API_BASE_URL", dotenv, DEFAULT_BASE_URL).rstrip("/")


def image_data_uri(image_path: Path) -> str:
    if not image_path.is_file():
        fail(f"Image file not found: {image_path}")
    content_type, _ = mimetypes.guess_type(image_path.name)
    if content_type not in {"image/jpeg", "image/png", "image/webp"}:
        fail("Only JPEG, PNG, and WebP images are supported.")
    encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return f"data:{content_type};base64,{encoded}"


def post_image_request(payload: dict, base_url: str, api_key: str) -> dict:
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        f"{base_url}/images/generations",
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=180) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = redact(exc.read().decode("utf-8", errors="replace"), api_key)
        fail(f"CreateNow API returned HTTP {exc.code}: {detail}")
    except URLError as exc:
        fail(f"Could not reach CreateNow API: {redact(str(exc.reason), api_key)}")
    except json.JSONDecodeError:
        fail("CreateNow API returned invalid JSON.")


def get_image_url(response: dict, api_key: str) -> str:
    items = response.get("data")
    if not isinstance(items, list) or not items:
        fail(f"CreateNow API returned no images: {redact(json.dumps(response, ensure_ascii=False), api_key)}")
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


def build_parser(models: dict, dotenv: dict[str, str]) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate and edit images with CreateNow.")
    parser.add_argument("--model", default=get_config_value("CREATENOW_IMAGE_MODEL", dotenv, models["default_model"]))
    parser.add_argument("--size", default="1024x1024")
    parser.add_argument("--output", "-o", type=Path)
    parser.add_argument("--json", action="store_true", dest="as_json")

    subcommands = parser.add_subparsers(dest="command", required=True)
    subcommands.add_parser("models", help="List available image models.")
    generate = subcommands.add_parser("generate", help="Generate an image from text.")
    generate.add_argument("--prompt", required=True)

    edit = subcommands.add_parser("edit", help="Generate an image from a source image and prompt.")
    edit.add_argument("--prompt", required=True)
    source = edit.add_mutually_exclusive_group(required=True)
    source.add_argument("--image", type=Path)
    source.add_argument("--image-url")
    return parser


def main() -> None:
    dotenv = load_dotenv()
    models = load_models()
    args = build_parser(models, dotenv).parse_args()

    if args.command == "models":
        print(json.dumps(models, ensure_ascii=False, indent=2))
        return

    allowed_models = {item["model"] for item in models["models"]}
    allowed_models.add(models["default_model"])
    if args.model not in allowed_models:
        fail("Unknown model. Run the models command to see available models.")

    api_key = get_api_key(dotenv)
    payload = {"model": args.model, "prompt": args.prompt, "size": args.size, "response_format": "url"}
    if args.command == "edit":
        source = args.image_url if args.image_url else image_data_uri(args.image)
        payload["image"] = [source]

    response = post_image_request(payload, get_base_url(dotenv), api_key)
    image_url = get_image_url(response, api_key)
    if args.as_json:
        print(redact(json.dumps(response, ensure_ascii=False), api_key))
        return
    if not args.output:
        print(image_url)
        return

    download_image(image_url, args.output)
    print(f"Saved image: {args.output.resolve()}")
    print(f"Source URL: {image_url}")


if __name__ == "__main__":
    main()
