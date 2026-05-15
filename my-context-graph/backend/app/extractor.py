"""LLM-only node + edge extraction via Groq (`openai/gpt-oss-120b`).

Replaces the previous spaCy / GLiNER pipeline. Returns a strict JSON shape:

    {
      "entities": [
        {"name": str, "type": str, "confidence": float, "source_text": str}
      ],
      "edges": [
        {"source": str, "target": str, "type": str, "confidence": float}
      ]
    }

The model is asked to honour the POLE+O ontology (Person, Organization, Location,
Event, Object) plus the project-specific labels (Agent, Conversation, Memory,
ToolCall, Session). Items below ``MIN_CONFIDENCE`` are dropped.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)

ALLOWED_ENTITY_TYPES = [
    "Person",
    "Organization",
    "Location",
    "Event",
    "Object",
    "Agent",
    "Conversation",
    "Memory",
    "ToolCall",
    "Session",
]

# Common relation types — anything else is stored as :RELATED_TO {type: "..."}
ALLOWED_RELATION_TYPES = [
    "WORKS_AT",
    "LOCATED_IN",
    "PART_OF",
    "MEMBER_OF",
    "OWNS",
    "USES",
    "MENTIONS",
    "RELATED_TO",
    "PARTICIPATED_IN",
    "KNOWS",
    "CREATED",
    "ATTENDED",
]

MIN_CONFIDENCE = 0.5

EXTRACTION_SYSTEM_PROMPT = f"""You are a knowledge-graph extractor. Given a text, extract:

1. Entities (people, organizations, places, events, objects, etc.).
2. Directed relationships between those entities.

Respond with VALID JSON ONLY (no prose, no markdown fences) in this exact shape:

{{
  "entities": [
    {{"name": "<canonical name>", "type": "<one of: {", ".join(ALLOWED_ENTITY_TYPES)}>", "confidence": 0.0-1.0, "source_text": "<short snippet>"}}
  ],
  "edges": [
    {{"source": "<entity name>", "target": "<entity name>", "type": "<UPPER_SNAKE_CASE>", "confidence": 0.0-1.0}}
  ]
}}

Rules:
- Use canonical capitalised names ("Alice", "Acme Corp", "Berlin").
- type MUST be one of the listed entity types. If unsure, use "Object".
- Edge `source` and `target` MUST exactly match an entity `name` you extracted.
- Prefer these relation types when applicable: {", ".join(ALLOWED_RELATION_TYPES)}.
- If none fits, invent an UPPER_SNAKE_CASE type (it will be stored as a RELATED_TO with a type property).
- Set confidence below 0.5 only if you are guessing.
- If the text has no extractable knowledge, return {{"entities": [], "edges": []}}.
"""


_client = None


def _get_client():
    """Lazily build the Groq async client. Returns None when no API key is set."""
    global _client
    if _client is not None:
        return _client
    if not settings.groq_api_key:
        return None
    try:
        from groq import AsyncGroq

        _client = AsyncGroq(api_key=settings.groq_api_key)
        return _client
    except ImportError:
        logger.warning("groq package not installed — extraction disabled")
        return None


def _validate(payload: dict[str, Any]) -> dict[str, Any]:
    """Filter / coerce the model output to the expected shape."""
    entities_out: list[dict] = []
    seen_names: set[str] = set()
    for raw in payload.get("entities", []) or []:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name", "")).strip()
        etype = str(raw.get("type", "Object")).strip() or "Object"
        try:
            conf = float(raw.get("confidence", 0.0))
        except (TypeError, ValueError):
            conf = 0.0
        if not name or conf < MIN_CONFIDENCE:
            continue
        if etype not in ALLOWED_ENTITY_TYPES:
            etype = "Object"
        if name in seen_names:
            continue
        seen_names.add(name)
        entities_out.append(
            {
                "name": name,
                "type": etype,
                "confidence": conf,
                "source_text": str(raw.get("source_text", ""))[:500],
            }
        )

    edges_out: list[dict] = []
    for raw in payload.get("edges", []) or []:
        if not isinstance(raw, dict):
            continue
        src = str(raw.get("source", "")).strip()
        tgt = str(raw.get("target", "")).strip()
        rtype = str(raw.get("type", "")).strip().upper().replace(" ", "_")
        try:
            conf = float(raw.get("confidence", 0.0))
        except (TypeError, ValueError):
            conf = 0.0
        if not src or not tgt or not rtype or conf < MIN_CONFIDENCE:
            continue
        if src not in seen_names or tgt not in seen_names:
            continue
        edges_out.append(
            {"source": src, "target": tgt, "type": rtype, "confidence": conf}
        )

    return {"entities": entities_out, "edges": edges_out}


async def extract(text: str, *, context: str = "") -> dict[str, list[dict]]:
    """Run LLM extraction over ``text`` and return validated entities + edges.

    Always returns ``{"entities": [...], "edges": [...]}`` — never raises.
    """
    empty = {"entities": [], "edges": []}
    if not settings.extraction_enabled or not text or not text.strip():
        return empty
    client = _get_client()
    if client is None:
        return empty

    user_prompt = text if not context else f"Context:\n{context}\n\nText to extract from:\n{text}"

    messages = [
        {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    for attempt in range(2):
        try:
            resp = await client.chat.completions.create(
                model=settings.groq_extraction_model,
                messages=messages,
                temperature=0,
                response_format={"type": "json_object"},
                max_tokens=1024,
            )
            content = resp.choices[0].message.content or "{}"
            payload = json.loads(content)
            return _validate(payload)
        except json.JSONDecodeError as e:
            logger.warning("Extractor JSON parse failed (attempt %d): %s", attempt + 1, e)
            messages.append(
                {
                    "role": "user",
                    "content": "Your previous response was not valid JSON. Respond with VALID JSON ONLY matching the schema.",
                }
            )
            continue
        except Exception as e:
            logger.warning("Extractor call failed: %s", e)
            return empty
    return empty
