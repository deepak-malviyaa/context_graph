"""Scientific Research Context Graph — FastAPI Application."""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.context_graph_client import connect_neo4j, close_neo4j, is_connected
from app.routes import router

logger = logging.getLogger(__name__)

# Silence the Neo4j driver's cosmetic "defunct connection / forcibly closed by
# the remote host" warnings. These are emitted by the driver's IO layer when
# Aura's load balancer evicts an idle pooled socket; our managed transactions
# transparently retry on a fresh connection, so the application is unaffected.
# Hiding them keeps the console clean without masking real errors (those are
# raised as exceptions by execute_cypher's outer retry loop).
logging.getLogger("neo4j.io").setLevel(logging.ERROR)
logging.getLogger("neo4j.pool").setLevel(logging.ERROR)

# Neo4j connection state
_neo4j_available = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle."""
    global _neo4j_available
    try:
        await connect_neo4j()
        _neo4j_available = True
        logger.info("Neo4j connected successfully")
    except Exception as e:
        _neo4j_available = False
        logger.warning("Neo4j unavailable — starting in degraded mode: %s", e)

    # Create vector indexes if supported (Neo4j 5.13+)
    if _neo4j_available:
        try:
            from app.vector_client import create_vector_index
            await create_vector_index()
        except Exception as e:
            logger.warning("Vector index creation failed (non-fatal): %s", e)

    yield
    if _neo4j_available:
        await close_neo4j()


def get_neo4j_status() -> bool:
    """Check if Neo4j is available."""
    return _neo4j_available

app = FastAPI(
    title="Scientific Research Context Graph",
    description="Research collaboration, publication tracking, grant management, and experiment analysis",
    version="0.1.0",
    lifespan=lifespan,
)


CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    f"http://localhost:{settings.frontend_port}",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.get("/health")
async def health():
    """Health check endpoint with Neo4j connectivity status."""
    neo4j_ok = is_connected()
    return {
        "status": "ok" if neo4j_ok else "degraded",
        "neo4j": neo4j_ok,
        "domain": "scientific-research",
        "version": "0.1.0",
    }
