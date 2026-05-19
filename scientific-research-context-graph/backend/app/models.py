"""Domain models for Scientific Research — auto-generated from ontology."""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field

class Person(BaseModel):
    """Entity model for Person."""

    name: str = ...
    email: str | None = None
    role: str | None = None
    description: str | None = None

class Organization(BaseModel):
    """Entity model for Organization."""

    name: str = ...
    description: str | None = None
    industry: str | None = None

class Location(BaseModel):
    """Entity model for Location."""

    name: str = ...
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None

class Event(BaseModel):
    """Entity model for Event."""

    name: str = ...
    date: datetime | None = None
    description: str | None = None

class Object(BaseModel):
    """Entity model for Object."""

    name: str = ...
    description: str | None = None

class ResearcherTitleEnum(str, Enum):
    PROFESSOR = "professor"
    ASSOCIATE_PROFESSOR = "associate_professor"
    ASSISTANT_PROFESSOR = "assistant_professor"
    POSTDOC = "postdoc"
    PHD_STUDENT = "phd_student"
    RESEARCH_SCIENTIST = "research_scientist"

class Researcher(BaseModel):
    """Entity model for Researcher."""

    researcher_id: str = ...
    name: str = ...
    orcid: str | None = None
    title: ResearcherTitleEnum | None = None
    h_index: int | None = None
    specialization: str | None = None
    email: str | None = None

class PaperPaperTypeEnum(str, Enum):
    JOURNAL_ARTICLE = "journal_article"
    CONFERENCE_PAPER = "conference_paper"
    PREPRINT = "preprint"
    REVIEW = "review"
    META_ANALYSIS = "meta_analysis"

class Paper(BaseModel):
    """Entity model for Paper."""

    doi: str = ...
    title: str = ...
    abstract: str | None = None
    journal: str | None = None
    publication_date: date | None = None
    citation_count: int | None = None
    paper_type: PaperPaperTypeEnum | None = None

class DatasetFormatEnum(str, Enum):
    CSV = "csv"
    JSON = "json"
    HDF5 = "hdf5"
    NETCDF = "netcdf"
    PARQUET = "parquet"
    SQL = "sql"
    CUSTOM = "custom"

class DatasetLicenseEnum(str, Enum):
    CC_BY = "cc_by"
    CC_BY_SA = "cc_by_sa"
    CC0 = "cc0"
    MIT = "mit"
    GPL = "gpl"
    PROPRIETARY = "proprietary"
    RESTRICTED = "restricted"

class Dataset(BaseModel):
    """Entity model for Dataset."""

    dataset_id: str = ...
    name: str = ...
    description: str | None = None
    format: DatasetFormatEnum | None = None
    size_gb: float | None = None
    license: DatasetLicenseEnum | None = None
    access_url: str | None = None

class ExperimentStatusEnum(str, Enum):
    PLANNED = "planned"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    ABANDONED = "abandoned"

class Experiment(BaseModel):
    """Entity model for Experiment."""

    experiment_id: str = ...
    name: str = ...
    methodology: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: ExperimentStatusEnum | None = None
    result_summary: str | None = None

class GrantStatusEnum(str, Enum):
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    AWARDED = "awarded"
    ACTIVE = "active"
    COMPLETED = "completed"
    REJECTED = "rejected"

class Grant(BaseModel):
    """Entity model for Grant."""

    grant_id: str = ...
    title: str = ...
    funding_agency: str = ...
    amount: float | None = None
    currency: str | None = "USD"
    start_date: date | None = None
    end_date: date | None = None
    status: GrantStatusEnum | None = None

class InstitutionInstitutionTypeEnum(str, Enum):
    UNIVERSITY = "university"
    RESEARCH_INSTITUTE = "research_institute"
    NATIONAL_LAB = "national_lab"
    HOSPITAL = "hospital"
    INDUSTRY_LAB = "industry_lab"

class Institution(BaseModel):
    """Entity model for Institution."""

    institution_id: str = ...
    name: str = ...
    institution_type: InstitutionInstitutionTypeEnum | None = None
    country: str | None = None
    ranking: int | None = None
    department: str | None = None

