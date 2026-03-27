"""
清理双主图 bug 产生的脏副本文件。

脏副本特征：images/{asset_id}.json，文件名（stem）≠ 文件内容中的 image_id 字段。

运行方式：
    env/python.exe cleanup_corrupt_images.py
"""
import json
from pathlib import Path

projects_dir = Path("data/projects")
deleted = []

for images_dir in projects_dir.glob("*/images"):
    for f in images_dir.glob("*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            image_id = data.get("image_id")
            if image_id and f.stem != image_id:
                print(f"DELETE: {f}  (filename={f.stem}, image_id={image_id})")
                deleted.append(str(f))
                f.unlink()
        except Exception as e:
            print(f"SKIP {f}: {e}")

print(f"\n共删除 {len(deleted)} 个脏副本文件")
