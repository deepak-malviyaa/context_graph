import asyncio
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.getcwd(), "backend"))

from app.context_graph_client import connect_neo4j, close_neo4j, execute_cypher
from app.config import settings

async def main():
    try:
        # Forcing database name to match common Aura free tier name if 'neo4j' fails
        # However, it's better to just try letting the server decide the default database
        # by passing None or empty string if we were calling the driver directly.
        # Since we use execute_cypher, let's see if we can modify settings before connect.
        settings.neo4j_database = "" # Let the server select the default database
        
        await connect_neo4j()
        query = "MATCH (d:Document) RETURN count(d) AS total, count(CASE WHEN d.domain IS NULL THEN 1 END) AS no_domain, collect(DISTINCT d.domain)[0..5] AS sample_domains"
        r = await execute_cypher(query)
        print(f"Result: {r}")
        print(f"Settings domain_id: {settings.domain_id}")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        await close_neo4j()

if __name__ == '__main__':
    asyncio.run(main())
