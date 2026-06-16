import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, ConfigDict

from app.core.context import get_current_data_root
from app.services import AssetService, ImageService, ProjectService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/materials", tags=["materials"])

MATERIAL_ASSET_TYPE = "material"
MAX_ZIP_SIZE = 200 * 1024 * 1024


def _get_projects_dir():
    from app.core.config import settings

    data_root = get_current_data_root()
    if data_root:
        return data_root / "projects"
    return settings.PROJECTS_DIR


class MaterialCreate(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    description: str = ""


class MaterialUpdate(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: Optional[str] = None
    description: Optional[str] = None
    front_image_id: Optional[str] = None
    angle_image_ids: Optional[List[str]] = None
    zip_media_url: Optional[str] = None
    zip_file_name: Optional[str] = None
    zip_size: Optional[int] = None


class LookCreate(BaseModel):
    name: str
    prompt: str = ""


class LookUpdate(BaseModel):
    name: Optional[str] = None
    prompt: Optional[str] = None
    image_id: Optional[str] = None
    audit_asset_id: Optional[str] = None
    audit_status: Optional[str] = None
    status: Optional[str] = None


class LookGenerateRequest(BaseModel):
    clothing_image_id: Optional[str] = None
    clothing_image_url: Optional[str] = None
    prompt: str = ""
    size: Optional[str] = None
    model: Optional[str] = None


class MaterialAuditRequest(BaseModel):
    image_ids: Optional[List[str]] = None


def _now() -> str:
    return datetime.now().isoformat()


def _image_url(project_id: str, image: Optional[Dict[str, Any]]) -> Optional[str]:
    if not image:
        return None
    if image.get("local_path"):
        return f"/api/projects/{project_id}/images/files/{image['local_path']}"
    return image.get("image_path")


def _audit_snapshot(image: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not image:
        return {"audit_asset_id": None, "audit_status": None}
    return {
        "audit_asset_id": image.get("volcengine_asset_id"),
        "audit_status": image.get("volcengine_asset_status"),
    }


def _hydrate_material(project_id: str, material: Dict[str, Any]) -> Dict[str, Any]:
    result = dict(material)
    front_image = ImageService.get_image(project_id, result.get("front_image_id")) if result.get("front_image_id") else None
    result["front_image_url"] = _image_url(project_id, front_image)
    result["front_audit_asset_id"] = front_image.get("volcengine_asset_id") if front_image else None
    result["front_audit_status"] = front_image.get("volcengine_asset_status") if front_image else None

    angle_images = []
    for image_id in result.get("angle_image_ids") or []:
        image = ImageService.get_image(project_id, image_id)
        angle_images.append({
            "image_id": image_id,
            "image_url": _image_url(project_id, image),
            **_audit_snapshot(image),
        })
    result["angle_images"] = angle_images

    looks = []
    for look in result.get("looks") or []:
        look_copy = dict(look)
        image = ImageService.get_image(project_id, look_copy.get("image_id")) if look_copy.get("image_id") else None
        look_copy["image_url"] = _image_url(project_id, image)
        audit = _audit_snapshot(image)
        look_copy["audit_asset_id"] = audit["audit_asset_id"] or look_copy.get("audit_asset_id")
        look_copy["audit_status"] = audit["audit_status"] or look_copy.get("audit_status")
        looks.append(look_copy)
    result["looks"] = looks
    return result


def _load_material(project_id: str, material_id: str) -> Dict[str, Any]:
    material = AssetService.load_asset(project_id, MATERIAL_ASSET_TYPE, material_id)
    if not material:
        raise HTTPException(status_code=404, detail="素材不存在")
    return material


def _find_look(material: Dict[str, Any], look_id: str) -> Dict[str, Any]:
    for look in material.get("looks") or []:
        if look.get("look_id") == look_id:
            return look
    raise HTTPException(status_code=404, detail="妆造不存在")


def _save_material(project_id: str, material: Dict[str, Any]) -> Dict[str, Any]:
    return AssetService.save_asset(project_id, MATERIAL_ASSET_TYPE, material)


@router.get("")
async def list_materials(project_id: str):
    materials = AssetService.list_assets(project_id, MATERIAL_ASSET_TYPE, include_children=True)
    return [_hydrate_material(project_id, item) for item in materials]


@router.post("")
async def create_material(project_id: str, request: MaterialCreate):
    if not ProjectService.get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    data = request.model_dump()
    material = {
        **data,
        "asset_type": MATERIAL_ASSET_TYPE,
        "asset_id": str(uuid.uuid4()),
        "front_image_id": data.get("front_image_id"),
        "angle_image_ids": data.get("angle_image_ids") or [],
        "looks": data.get("looks") or [],
        "created_at": _now(),
    }
    return _hydrate_material(project_id, _save_material(project_id, material))


@router.get("/{material_id}")
async def get_material(project_id: str, material_id: str):
    return _hydrate_material(project_id, _load_material(project_id, material_id))


@router.put("/{material_id}")
async def update_material(project_id: str, material_id: str, request: MaterialUpdate):
    material = _load_material(project_id, material_id)
    update_data = request.model_dump(exclude_unset=True)
    if "angle_image_ids" in update_data:
        angle_ids = [image_id for image_id in update_data["angle_image_ids"] if image_id]
        if len(angle_ids) > 5:
            raise HTTPException(status_code=400, detail="最多上传5张角度图")
        update_data["angle_image_ids"] = angle_ids
    material.update(update_data)
    return _hydrate_material(project_id, _save_material(project_id, material))


@router.delete("/{material_id}")
async def delete_material(project_id: str, material_id: str):
    if not AssetService.delete_asset(project_id, MATERIAL_ASSET_TYPE, material_id):
        raise HTTPException(status_code=404, detail="素材不存在")
    return {"success": True}


@router.post("/{material_id}/zip")
async def upload_material_zip(request: Request, project_id: str, material_id: str, file: UploadFile = File(...)):
    material = _load_material(project_id, material_id)
    suffix = Path(file.filename or "").suffix.lower()
    if suffix != ".zip":
        raise HTTPException(status_code=400, detail="仅支持 zip 人脸库")

    content = await file.read()
    if len(content) > MAX_ZIP_SIZE:
        raise HTTPException(status_code=400, detail="zip 人脸库必须小于200MB")

    media_id = str(uuid.uuid4())
    filename = f"material_faces_{media_id}.zip"
    media_dir = _get_projects_dir() / project_id / "generate" / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    with open(media_dir / filename, "wb") as handle:
        handle.write(content)

    public_url = f"{str(request.base_url).rstrip('/')}/api/projects/{project_id}/generate/media/files/{filename}"
    material.update({
        "zip_media_id": media_id,
        "zip_media_url": public_url,
        "zip_file_name": file.filename or filename,
        "zip_size": len(content),
    })
    return _hydrate_material(project_id, _save_material(project_id, material))


@router.post("/{material_id}/looks")
async def create_look(project_id: str, material_id: str, request: LookCreate):
    material = _load_material(project_id, material_id)
    look = {
        "look_id": str(uuid.uuid4()),
        "name": request.name,
        "prompt": request.prompt,
        "status": "draft",
        "created_at": _now(),
        "updated_at": _now(),
    }
    material.setdefault("looks", []).append(look)
    return _hydrate_material(project_id, _save_material(project_id, material))


@router.patch("/{material_id}/looks/{look_id}")
async def update_look(project_id: str, material_id: str, look_id: str, request: LookUpdate):
    material = _load_material(project_id, material_id)
    look = _find_look(material, look_id)
    for key, value in request.model_dump(exclude_unset=True).items():
        look[key] = value
    look["updated_at"] = _now()
    return _hydrate_material(project_id, _save_material(project_id, material))


@router.delete("/{material_id}/looks/{look_id}")
async def delete_look(project_id: str, material_id: str, look_id: str):
    material = _load_material(project_id, material_id)
    looks = material.get("looks") or []
    material["looks"] = [look for look in looks if look.get("look_id") != look_id]
    if len(material["looks"]) == len(looks):
        raise HTTPException(status_code=404, detail="妆造不存在")
    return _hydrate_material(project_id, _save_material(project_id, material))


@router.post("/{material_id}/looks/{look_id}/generate")
async def generate_look(project_id: str, material_id: str, look_id: str, request: LookGenerateRequest):
    from app.api.generation.image import edit_image
    from app.api.generation.models import ImageEditRequest

    material = _load_material(project_id, material_id)
    look = _find_look(material, look_id)
    front_image_id = material.get("front_image_id")
    angle_image_ids = [image_id for image_id in material.get("angle_image_ids") or [] if image_id]
    if not front_image_id:
        raise HTTPException(status_code=400, detail="请先上传正脸图")
    if len(angle_image_ids) < 5:
        raise HTTPException(status_code=400, detail="请先上传5张不同角度面部照片")
    if not request.clothing_image_id and not request.clothing_image_url:
        raise HTTPException(status_code=400, detail="请上传服饰图")

    project = ProjectService.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    from app.api.generation.template_helpers import get_active_template

    ai_config = project.get("ai_config", {})
    fixed_prefix = get_active_template(ai_config, "material_look")
    if not fixed_prefix:
        raise HTTPException(status_code=500, detail="缺少素材合成妆造服务提示词")
    prompt_parts = [fixed_prefix, look.get("prompt") or "", request.prompt]
    prompt = "\n".join(part.strip() for part in prompt_parts if part and part.strip())

    reference_image_ids = [front_image_id, *angle_image_ids]
    reference_image_urls = []
    if request.clothing_image_id:
        reference_image_ids.append(request.clothing_image_id)
    if request.clothing_image_url:
        reference_image_urls.append(request.clothing_image_url)

    record = await edit_image(project_id, ImageEditRequest(
        asset_id=material_id,
        asset_type=MATERIAL_ASSET_TYPE,
        prompt=prompt,
        size=request.size,
        reference_image_ids=reference_image_ids,
        reference_image_urls=reference_image_urls,
        model=request.model,
        generation_scope="material_look",
    ))
    look.update({
        "image_id": record.get("image_id"),
        "status": "generated",
        "generated_at": _now(),
        "updated_at": _now(),
    })
    saved = _hydrate_material(project_id, _save_material(project_id, material))
    return {"material": saved, "image": record, "look": next((item for item in saved.get("looks", []) if item.get("look_id") == look_id), None)}


def _update_audit_snapshots(material: Dict[str, Any], submitted: List[Dict[str, Any]]) -> None:
    by_image_id = {item.get("image_id"): item for item in submitted if item.get("image_id")}
    front_image_id = material.get("front_image_id")
    if front_image_id in by_image_id:
        item = by_image_id[front_image_id]
        material["front_audit_asset_id"] = item.get("asset_id")
        material["front_audit_status"] = item.get("status")
        material["front_submitted_at"] = _now()
    for look in material.get("looks") or []:
        image_id = look.get("image_id")
        if image_id in by_image_id:
            item = by_image_id[image_id]
            look["audit_asset_id"] = item.get("asset_id")
            look["audit_status"] = item.get("status")
            look["submitted_at"] = _now()


@router.post("/{material_id}/audit-submit-new")
async def submit_new_material_assets(project_id: str, material_id: str):
    from app.api.generation.assets import submit_assets_core

    material = _load_material(project_id, material_id)
    image_ids = []
    front_image_id = material.get("front_image_id")
    if front_image_id:
        front = ImageService.get_image(project_id, front_image_id)
        if not front or front.get("volcengine_asset_status") not in {"Active", "Processing"}:
            image_ids.append(front_image_id)
    for look in material.get("looks") or []:
        image_id = look.get("image_id")
        if not image_id:
            continue
        image = ImageService.get_image(project_id, image_id)
        if image and image.get("volcengine_asset_status") in {"Active", "Processing"}:
            continue
        image_ids.append(image_id)
    if not image_ids:
        return {"submitted": [], "skipped": [], "material": _hydrate_material(project_id, material)}
    result = await submit_assets_core(project_id, image_ids)
    _update_audit_snapshots(material, result.get("submitted") or [])
    return {**result, "material": _hydrate_material(project_id, _save_material(project_id, material))}


@router.post("/{material_id}/audit-resubmit-all")
async def resubmit_all_material_assets(project_id: str, material_id: str):
    from app.api.generation.assets import resubmit_assets_core

    material = _load_material(project_id, material_id)
    image_ids = [material.get("front_image_id"), *[look.get("image_id") for look in material.get("looks") or []]]
    image_ids = [image_id for image_id in image_ids if image_id]
    if not image_ids:
        raise HTTPException(status_code=400, detail="没有可提审图片")
    result = await resubmit_assets_core(project_id, image_ids)
    _update_audit_snapshots(material, result.get("submitted") or [])
    return {**result, "material": _hydrate_material(project_id, _save_material(project_id, material))}
