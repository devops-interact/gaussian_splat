"""
SQLAlchemy models for User, Project, Scan, Job
"""
import json
from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Float, Text
from sqlalchemy.orm import relationship
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    is_demo = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    projects = relationship("Project", back_populates="user", cascade="all, delete-orphan")


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(String(1000), default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="projects")
    scans = relationship("Scan", back_populates="project", cascade="all, delete-orphan")


class Scan(Base):
    __tablename__ = "scans"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    job_id = Column(String(36), nullable=True)  # References Job in jobs.json
    name = Column(String(255), default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("Project", back_populates="scans")


class JobRecord(Base):
    __tablename__ = "jobs"

    job_id = Column(String(36), primary_key=True)
    status = Column(String(32), nullable=False)
    video_filename = Column(String(512), nullable=False)
    quality_preset = Column(String(16), default="quality")
    progress = Column(Float, default=0.0)
    error_message = Column(Text, nullable=True)
    model_filename = Column(String(512), nullable=True)
    model_url = Column(String(512), nullable=True)
    model_url_obj = Column(String(512), nullable=True)
    estimated_minutes = Column(Integer, nullable=True)
    processing_time_seconds = Column(Float, nullable=True)
    meshy_task_id = Column(String(64), nullable=True)
    validation_json = Column(Text, nullable=True)
    model_metadata_json = Column(Text, nullable=True)
    keyframes_json = Column(Text, nullable=True)
    scene_manifest_json = Column(Text, nullable=True)
    current_zone = Column(Integer, nullable=True)
    total_zones = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def set_validation(self, data) -> None:
        self.validation_json = json.dumps(data) if data else None

    def get_validation(self):
        return json.loads(self.validation_json) if self.validation_json else None

    def set_model_metadata(self, data) -> None:
        self.model_metadata_json = json.dumps(data) if data else None

    def get_model_metadata(self):
        return json.loads(self.model_metadata_json) if self.model_metadata_json else None

    def set_keyframes(self, data) -> None:
        self.keyframes_json = json.dumps(data) if data else None

    def get_keyframes(self):
        return json.loads(self.keyframes_json) if self.keyframes_json else None

    def set_scene_manifest(self, data) -> None:
        self.scene_manifest_json = json.dumps(data) if data else None

    def get_scene_manifest(self):
        return json.loads(self.scene_manifest_json) if self.scene_manifest_json else None
