"""
CRUD API for Scans (nested under projects)
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from database import get_db
from models.db_models import User, Project, Scan
from api.auth import get_current_user
from jobs.job_manager import get_job_manager

router = APIRouter()


class ScanCreate(BaseModel):
    name: Optional[str] = ""


class ScanUpdate(BaseModel):
    name: Optional[str] = None


class ScanResponse(BaseModel):
    id: int
    project_id: int
    job_id: Optional[str] = None
    name: str
    status: Optional[str] = None  # from Job if job_id exists
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


def _scan_to_response(s: Scan) -> ScanResponse:
    return ScanResponse(
        id=s.id,
        project_id=s.project_id,
        job_id=s.job_id,
        name=s.name or "",
        status=None,  # Frontend will poll job status separately
        created_at=s.created_at.isoformat(),
        updated_at=s.updated_at.isoformat(),
    )


def _ensure_project_access(db: Session, project_id: int, user_id: int) -> Project:
    project = db.query(Project).filter(Project.id == project_id, Project.user_id == user_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.get("/{project_id}/scans", response_model=list[ScanResponse])
async def list_scans(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all scans in a project."""
    _ensure_project_access(db, project_id, current_user.id)
    scans = db.query(Scan).filter(Scan.project_id == project_id).order_by(Scan.updated_at.desc()).all()
    return [_scan_to_response(s) for s in scans]


@router.post("/{project_id}/scans", response_model=ScanResponse)
async def create_scan(
    project_id: int,
    body: ScanCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new scan (without job yet - job is linked when video is uploaded)."""
    project = _ensure_project_access(db, project_id, current_user.id)
    scan = Scan(
        project_id=project.id,
        name=body.name or "",
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)
    return _scan_to_response(scan)


@router.get("/{project_id}/scans/{scan_id}", response_model=ScanResponse)
async def get_scan(
    project_id: int,
    scan_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a scan by ID."""
    _ensure_project_access(db, project_id, current_user.id)
    scan = db.query(Scan).filter(Scan.id == scan_id, Scan.project_id == project_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    return _scan_to_response(scan)


@router.put("/{project_id}/scans/{scan_id}", response_model=ScanResponse)
async def update_scan(
    project_id: int,
    scan_id: int,
    body: ScanUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update a scan."""
    _ensure_project_access(db, project_id, current_user.id)
    scan = db.query(Scan).filter(Scan.id == scan_id, Scan.project_id == project_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    if body.name is not None:
        scan.name = body.name
    db.commit()
    db.refresh(scan)
    return _scan_to_response(scan)


@router.delete("/{project_id}/scans/{scan_id}")
async def delete_scan(
    project_id: int,
    scan_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a scan."""
    _ensure_project_access(db, project_id, current_user.id)
    scan = db.query(Scan).filter(Scan.id == scan_id, Scan.project_id == project_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    db.delete(scan)
    db.commit()
    return {"ok": True}
