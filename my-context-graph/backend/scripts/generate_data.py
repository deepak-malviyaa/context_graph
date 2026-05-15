"""Generate sample data for Agent Memory context graph."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from app.config import settings
from app.context_graph_client import connect_neo4j, close_neo4j, execute_cypher
from app import extractor


DATA_DIR = Path(__file__).parent.parent.parent / "data"


async def apply_schema():
    """Apply the Cypher schema constraints and indexes."""
    schema_path = Path(__file__).parent.parent.parent / "cypher" / "schema.cypher"
    if schema_path.exists():
        schema = schema_path.read_text()
        for statement in schema.split(";"):
            stmt = statement.strip()
            if stmt and not stmt.startswith("//"):
                try:
                    await execute_cypher(stmt)
                    print(f"  Applied: {stmt[:60]}...")
                except Exception as e:
                    print(f"  Warning: {e}")


def _batch(items: list, size: int = 500) -> list[list]:
    """Split a list into batches."""
    return [items[i:i + size] for i in range(0, len(items), size)]


def _safe_props(item: dict) -> dict:
    """Coerce property values to Neo4j-safe types."""
    safe = {}
    for k, v in item.items():
        if isinstance(v, bool):
            safe[k] = v
        elif isinstance(v, (int, float, str)):
            safe[k] = v
        elif v is None:
            safe[k] = ""
        else:
            safe[k] = str(v)
    return safe


async def load_fixture_data(data: dict):
    """Load entities and relationships from fixture data."""
    entities = data.get("entities", {})
    for label, items in entities.items():
        if not items:
            continue
        enriched = [{**_safe_props(item), "domain": settings.domain_id} for item in items]
        all_keys = set()
        for item in enriched:
            all_keys.update(item.keys())
        set_clause = ", ".join(f"n.{k} = item.{k}" for k in all_keys)
        cypher = f"UNWIND $batch AS item MERGE (n:{label} {{name: item.name, domain: item.domain}}) ON CREATE SET {set_clause} ON MATCH SET {set_clause}"
        for batch in _batch(enriched):
            try:
                await execute_cypher(cypher, {"batch": batch})
            except Exception as e:
                print(f"  Warning creating {label}: {e}")
        print(f"  Created {len(items)} {label} nodes")

    # Create relationships in batches grouped by type+labels
    relationships = data.get("relationships", [])
    rel_groups: dict[tuple, list] = {}
    for rel in relationships:
        key = (rel["type"], rel["source_label"], rel["target_label"])
        rel_groups.setdefault(key, []).append(rel)

    for (rel_type, src_label, tgt_label), rels in rel_groups.items():
        cypher = f"""
        UNWIND $batch AS rel
        MATCH (a:{src_label} {{name: rel.source_name}})
        MATCH (b:{tgt_label} {{name: rel.target_name}})
        MERGE (a)-[r:{rel_type}]->(b)
        """
        batch_data = [{"source_name": r["source_name"], "target_name": r["target_name"]} for r in rels]
        for batch in _batch(batch_data):
            try:
                await execute_cypher(cypher, {"batch": batch})
            except Exception as e:
                print(f"  Warning creating {rel_type} relationships: {e}")
    print(f"  Created {len(relationships)} relationships")


async def load_documents(data: dict):
    """Load documents and link them to mentioned entities."""
    documents = data.get("documents", [])
    if not documents:
        print("  No documents to load")
        return

    doc_batch = [
        {
            "title": doc.get("title", ""),
            "content": doc.get("content", ""),
            "template_id": doc.get("template_id", ""),
            "template_name": doc.get("template_name", ""),
            "domain": settings.domain_id,
        }
        for doc in documents
    ]
    cypher = """
    UNWIND $batch AS doc
    MERGE (d:Document {title: doc.title})
    SET d.content = doc.content,
        d.template_id = doc.template_id,
        d.template_name = doc.template_name,
        d.domain = doc.domain
    """
    for batch in _batch(doc_batch, 100):
        try:
            await execute_cypher(cypher, {"batch": batch})
        except Exception as e:
            print(f"  Warning creating documents: {e}")

    print(f"  Created {len(documents)} Document nodes")

    # Link documents to mentioned entities via LLM extraction
    await _llm_link_documents(documents)


async def _llm_link_documents(documents: list[dict]) -> None:
    """Run LLM extraction over each document and create MENTIONS + entity edges."""
    if not documents:
        return
    if not settings.extraction_enabled or not settings.groq_api_key:
        print("  LLM extraction disabled (no GROQ_API_KEY) — skipping document linking")
        return

    domain = settings.domain_id
    total_mentions = 0
    total_edges = 0
    chunk_size = 1500

    for doc in documents:
        title = doc.get("title", "")
        content = doc.get("content", "") or ""
        if not title or not content.strip():
            continue
        chunks = [content[i : i + chunk_size] for i in range(0, len(content), chunk_size)] or [""]
        for chunk in chunks:
            try:
                result = await extractor.extract(chunk)
            except Exception as e:
                print(f"  Warning extracting from '{title}': {e}")
                continue

            for ent in result.get("entities", []):
                label = ent["type"] if ent["type"] in extractor.ALLOWED_ENTITY_TYPES else "Object"
                try:
                    await execute_cypher(
                        f"MERGE (e:Entity:{label} {{name: $name, domain: $domain}}) "
                        "ON CREATE SET e.entity_type = $type, e.confidence = $confidence, "
                        "e.source_text = $source_text, e.created_at = timestamp() "
                        "ON MATCH SET e.confidence = CASE WHEN $confidence > coalesce(e.confidence, 0) "
                        "THEN $confidence ELSE e.confidence END",
                        {
                            "name": ent["name"],
                            "domain": domain,
                            "type": label,
                            "confidence": ent["confidence"],
                            "source_text": ent["source_text"],
                        },
                    )
                    await execute_cypher(
                        "MATCH (d:Document {title: $title}) "
                        "MATCH (e:Entity {name: $name, domain: $domain}) "
                        "MERGE (d)-[:MENTIONS]->(e)",
                        {"title": title, "name": ent["name"], "domain": domain},
                    )
                    total_mentions += 1
                except Exception as e:
                    print(f"  Warning merging entity '{ent['name']}': {e}")

            for edge in result.get("edges", []):
                rtype = edge["type"]
                try:
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
                    total_edges += 1
                except Exception as e:
                    print(f"  Warning merging edge {edge['source']}->{edge['target']}: {e}")

            # Stay under Groq free tier 8000 TPM
            await asyncio.sleep(8)
        print(f"  Extracted from '{title}'")

    print(f"  Created {total_mentions} MENTIONS and {total_edges} entity edges")


async def load_decision_traces(data: dict):
    """Load decision traces with their reasoning steps."""
    traces = data.get("traces", [])
    if not traces:
        print("  No decision traces to load")
        return

    for trace in traces:
        # Create trace node
        try:
            await execute_cypher(
                "MERGE (t:DecisionTrace {id: $id}) SET t.task = $task, t.outcome = $outcome, t.domain = $domain",
                {
                    "id": trace.get("id", ""),
                    "task": trace.get("task", ""),
                    "outcome": trace.get("outcome", ""),
                    "domain": settings.domain_id,
                },
            )
        except Exception as e:
            print(f"  Warning creating trace: {e}")
            continue

        # Create steps and link to trace
        for i, step in enumerate(trace.get("steps", [])):
            try:
                await execute_cypher(
                    """
                    MATCH (t:DecisionTrace {id: $trace_id})
                    MERGE (s:TraceStep {trace_id: $trace_id, step_number: $step_number})
                    SET s.thought = $thought, s.action = $action, s.observation = $observation
                    MERGE (t)-[:HAS_STEP]->(s)
                    """,
                    {
                        "trace_id": trace.get("id", ""),
                        "step_number": i + 1,
                        "thought": step.get("thought", ""),
                        "action": step.get("action", ""),
                        "observation": step.get("observation", ""),
                    },
                )
            except Exception as e:
                print(f"  Warning creating trace step: {e}")

    print(f"  Created {len(traces)} DecisionTrace nodes with steps")

async def main():
    parser = argparse.ArgumentParser(description="Seed Agent Memory context graph")
    parser.add_argument(
        "--no-llm-extract",
        action="store_true",
        help="Skip LLM-based entity extraction over documents",
    )
    args = parser.parse_args()
    if args.no_llm_extract:
        settings.extraction_enabled = False

    print("Seeding Agent Memory context graph...")
    await connect_neo4j()


    # Load fixture data
    fixture_path = DATA_DIR / "fixtures.json"
    if not fixture_path.exists():
        print("No fixture data found. Create data/fixtures.json to seed data.")
        await close_neo4j()
        return

    data = json.loads(fixture_path.read_text())

    print("\n[1/4] Applying schema...")
    await apply_schema()

    print("\n[2/4] Loading entities and relationships...")

    await load_fixture_data(data)

    print("\n[3/4] Loading documents...")

    await load_documents(data)

    print("\n[4/4] Loading decision traces...")

    await load_decision_traces(data)

    await close_neo4j()
    print("\nDone! Your Agent Memory context graph is ready.")


if __name__ == "__main__":
    asyncio.run(main())
