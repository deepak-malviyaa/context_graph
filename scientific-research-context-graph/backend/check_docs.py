import asyncio
from app.context_graph_client import connect_neo4j, close_neo4j, execute_cypher
from app.config import settings

async def main():
    await connect_neo4j()
    print(f"domain_id: {settings.domain_id!r}")
    print(f"neo4j_database: {settings.neo4j_database!r}")

    r1 = await execute_cypher("MATCH (d:Document) RETURN count(d) AS total")
    print(f"Total Document nodes: {r1}")

    r2 = await execute_cypher("MATCH (d:Document) RETURN DISTINCT d.domain AS domain, count(*) AS n")
    print(f"By domain: {r2}")

    r3 = await execute_cypher(
        "MATCH (d:Document) WHERE d.domain IS NULL OR d.domain = $domain "
        "RETURN d.title AS title LIMIT 5",
        {"domain": settings.domain_id},
    )
    print(f"Visible to API ({len(r3)} sample): {r3}")

    await close_neo4j()

asyncio.run(main())
