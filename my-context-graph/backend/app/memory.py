"""Memory integration — powered by neo4j-agent-memory v0.1.0.

Provides MemoryIntegration for conversation memory with automatic
entity extraction and preference detection.
"""

from __future__ import annotations

import logging
import uuid

from app.config import settings
from app import extractor
from app.context_graph_client import execute_cypher

logger = logging.getLogger(__name__)

_memory = None  # MemoryIntegration | None


async def connect_memory() -> None:
    """Initialize MemoryIntegration. No-ops if package unavailable."""
    global _memory
    try:
        from neo4j_agent_memory import MemoryIntegration, SessionStrategy

        strategy_map = {
            "per_conversation": SessionStrategy.PER_CONVERSATION,
            "per_day": SessionStrategy.PER_DAY,
            "persistent": SessionStrategy.PERSISTENT,
        }
        _memory = MemoryIntegration(
            neo4j_uri=settings.neo4j_uri,
            neo4j_password=settings.neo4j_password,
            neo4j_user=settings.neo4j_username,
            neo4j_database=settings.neo4j_database,
            session_strategy=strategy_map.get(
                settings.session_strategy, SessionStrategy.PER_CONVERSATION
            ),
            auto_extract=False,
            auto_preferences=False,
        )
        await _memory.connect()
        logger.info(
            "MemoryIntegration connected (strategy=%s, extract=%s, preferences=%s)",
            settings.session_strategy,
            False,
            False,
        )
    except ImportError:
        logger.info("neo4j-agent-memory not installed — memory disabled")
        _memory = None
    except Exception as e:
        logger.warning("MemoryIntegration init failed: %s", e)
        _memory = None


async def close_memory() -> None:
    """Shut down MemoryIntegration gracefully."""
    global _memory
    if _memory is not None:
        try:
            await _memory.close()
        except Exception:
            pass
        _memory = None


def get_memory():
    """Get the MemoryIntegration instance (may be None)."""
    return _memory


async def store_message(
    session_id: str, role: str, content: str
) -> dict | None:
    """Store a message and return extraction results (entities, edges).

    Returns None if memory is unavailable. Extraction is performed by the
    Groq-backed :mod:`app.extractor`, not by the underlying library.
    """
    if _memory is None:
        return None
    try:
        await _memory.store_message(role, content, session_id=session_id)
    except Exception as e:
        logger.warning("Failed to store message: %s", e)
        return None

    extraction = await extractor.extract(content)
    try:
        await _persist_extraction(session_id, extraction)
    except Exception as e:
        logger.warning("Failed to persist extraction: %s", e)
    return {
        "entities": extraction.get("entities", []),
        "edges": extraction.get("edges", []),
        "preferences": [],
    }


async def _persist_extraction(session_id: str, extraction: dict) -> None:
    """Persist LLM-extracted entities + edges into Neo4j."""
    entities = extraction.get("entities", [])
    edges = extraction.get("edges", [])
    domain = settings.domain_id

    for ent in entities:
        label = ent["type"]
        if label not in extractor.ALLOWED_ENTITY_TYPES:
            label = "Object"
        cypher = (
            f"MERGE (e:Entity:{label} {{name: $name, domain: $domain}}) "
            "ON CREATE SET e.entity_type = $type, e.confidence = $confidence, "
            "e.source_text = $source_text, e.created_at = timestamp() "
            "ON MATCH SET e.confidence = CASE WHEN $confidence > coalesce(e.confidence, 0) "
            "THEN $confidence ELSE e.confidence END"
        )
        await execute_cypher(
            cypher,
            {
                "name": ent["name"],
                "domain": domain,
                "type": label,
                "confidence": ent["confidence"],
                "source_text": ent["source_text"],
            },
        )
        # Link extraction to the conversation/session
        await execute_cypher(
            "MERGE (c:Conversation {session_id: $session_id}) "
            "ON CREATE SET c.domain = $domain, c.started_at = timestamp() "
            "WITH c MATCH (e:Entity {name: $name, domain: $domain}) "
            "MERGE (c)-[:EXTRACTED]->(e)",
            {"session_id": session_id, "domain": domain, "name": ent["name"]},
        )

    for edge in edges:
        rtype = edge["type"]
        if rtype in extractor.ALLOWED_RELATION_TYPES:
            cypher = (
                "MATCH (a:Entity {name: $src, domain: $domain}) "
                "MATCH (b:Entity {name: $tgt, domain: $domain}) "
                f"MERGE (a)-[r:{rtype}]->(b) "
                "ON CREATE SET r.confidence = $confidence"
            )
        else:
            cypher = (
                "MATCH (a:Entity {name: $src, domain: $domain}) "
                "MATCH (b:Entity {name: $tgt, domain: $domain}) "
                "MERGE (a)-[r:RELATED_TO {type: $rtype}]->(b) "
                "ON CREATE SET r.confidence = $confidence"
            )
        await execute_cypher(
            cypher,
            {
                "src": edge["source"],
                "tgt": edge["target"],
                "domain": domain,
                "rtype": rtype,
                "confidence": edge["confidence"],
            },
        )


async def get_context(
    session_id: str, query: str | None = None, max_items: int = 10
) -> dict:
    """Get rich context for a session.

    Returns a dict with keys: messages, entities, preferences, traces.
    Falls back to empty lists if memory is unavailable.
    """
    empty = {"messages": [], "entities": [], "preferences": [], "traces": []}
    if _memory is None:
        return empty
    try:
        return await _memory.get_context(
            session_id=session_id, query=query, max_items=max_items
        )
    except Exception as e:
        logger.warning("Failed to get context: %s", e)
        return empty


def resolve_session_id(hint: str | None = None) -> str:
    """Resolve session ID based on configured strategy."""
    if _memory is None:
        return hint or str(uuid.uuid4())
    return _memory.resolve_session_id(hint=hint)
