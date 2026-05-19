"""Scientific Research AI Agent — LangGraph implementation."""

from __future__ import annotations

import json

from langchain_groq import ChatGroq
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent

from app.config import settings
from app.context_graph_client import execute_cypher, get_schema
from app.memory import store_message, get_context, resolve_session_id


SYSTEM_PROMPT = """You are an AI research intelligence assistant with access to a comprehensive
knowledge graph of scientific publications, researchers, datasets, experiments,
and grants. You help researchers, lab managers, and research administrators
navigate the academic landscape, track research output, and manage
collaborative projects.

Your capabilities include:
- Searching publications, researchers, and their citation networks
- Tracking experiment progress and results
- Analyzing grant funding and research output
- Discovering collaboration opportunities and expertise overlap
- Tracing dataset provenance and usage across studies

Always provide accurate, data-driven responses. When making recommendations,
cite specific publications, metrics, and research data from the knowledge graph.


IMPORTANT: You MUST use the available tools to query the knowledge graph before answering any question about the data. Never guess or make up information — always use tools to look up actual data from the graph.

CRITICAL: Call tools DIRECTLY without any introductory text. Do NOT say "I'll search for..." or "Let me look up..." before calling a tool — just call the tool immediately. Only generate text AFTER you have received the tool results and are ready to provide your final answer."""

# ---------------------------------------------------------------------------
# Agent tools — domain-specific for Scientific Research
# ---------------------------------------------------------------------------

@tool
async def search_researcher(query: str) -> str:
    """Search for researchers by name, specialization, or institution"""
    cypher = """MATCH (r:Researcher)
    WHERE toLower(r.name) CONTAINS toLower($query)
       OR toLower(coalesce(r.specialization, '')) CONTAINS toLower($query)
    OPTIONAL MATCH (r)-[:AFFILIATED_WITH]->(i:Institution)
    OPTIONAL MATCH (r)-[:AUTHORED]->(p:Paper)
    RETURN r, i.name AS institution, count(p) AS paper_count
    ORDER BY r.h_index DESC
    LIMIT 20
"""
    params = {
        "query": query,
    }
    result = await execute_cypher(cypher, params, tool_name="search_researcher")
    return json.dumps(result, default=str)

@tool
async def citation_network(query: str) -> str:
    """Explore citation relationships for a paper"""
    cypher = """MATCH (p:Paper)
    WHERE toLower(p.title) CONTAINS toLower($query) OR p.doi = $query
    OPTIONAL MATCH (p)-[:CITED]->(cited:Paper)
    OPTIONAL MATCH (citing:Paper)-[:CITED]->(p)
    RETURN p, collect(DISTINCT cited.title) AS references,
           collect(DISTINCT citing.title) AS cited_by,
           p.citation_count
    LIMIT 10
"""
    params = {
        "query": query,
    }
    result = await execute_cypher(cypher, params, tool_name="citation_network")
    return json.dumps(result, default=str)

@tool
async def dataset_usage(query: str) -> str:
    """Find which papers and experiments have used a specific dataset"""
    cypher = """MATCH (d:Dataset)
    WHERE toLower(d.name) CONTAINS toLower($query)
       OR d.dataset_id = $query
    OPTIONAL MATCH (p:Paper)-[:USED_DATASET]->(d)
    OPTIONAL MATCH (e:Experiment)-[:PRODUCED_DATASET]->(d)
    RETURN d, collect(DISTINCT p.title) AS papers_using,
           collect(DISTINCT e.name) AS producing_experiments
"""
    params = {
        "query": query,
    }
    result = await execute_cypher(cypher, params, tool_name="dataset_usage")
    return json.dumps(result, default=str)

@tool
async def grant_analysis(query: str) -> str:
    """Analyze grant funding status and associated research output"""
    cypher = """MATCH (g:Grant)
    WHERE toLower(g.title) CONTAINS toLower($query)
       OR toLower(g.funding_agency) CONTAINS toLower($query)
       OR g.status = $query
    OPTIONAL MATCH (e:Experiment)-[:FUNDED_BY]->(g)
    OPTIONAL MATCH (r:Researcher)-[:CONDUCTED]->(e)
    RETURN g, collect(DISTINCT e.name) AS experiments,
           collect(DISTINCT r.name) AS researchers
    ORDER BY g.amount DESC
    LIMIT 20
"""
    params = {
        "query": query,
    }
    result = await execute_cypher(cypher, params, tool_name="grant_analysis")
    return json.dumps(result, default=str)

@tool
async def experiment_results(query: str) -> str:
    """Query experiment details and outcomes"""
    cypher = """MATCH (e:Experiment)
    WHERE toLower(e.name) CONTAINS toLower($query)
       OR e.experiment_id = $query
    OPTIONAL MATCH (r:Researcher)-[:CONDUCTED]->(e)
    OPTIONAL MATCH (e)-[:FUNDED_BY]->(g:Grant)
    OPTIONAL MATCH (e)-[:PRODUCED_DATASET]->(d:Dataset)
    RETURN e, collect(DISTINCT r.name) AS researchers,
           collect(DISTINCT g.title) AS grants,
           collect(DISTINCT d.name) AS datasets_produced
"""
    params = {
        "query": query,
    }
    result = await execute_cypher(cypher, params, tool_name="experiment_results")
    return json.dumps(result, default=str)

@tool
async def list_researchers(limit: str) -> str:
    """List researcher records with optional limit"""
    cypher = """MATCH (n:Researcher)
    RETURN n
    ORDER BY n.name
    LIMIT toInteger($limit)
"""
    params = {
        "limit": limit,
    }
    result = await execute_cypher(cypher, params, tool_name="list_researchers")
    return json.dumps(result, default=str)

@tool
async def get_researcher_by_id(id: str) -> str:
    """Get a specific researcher by ID with all connections"""
    cypher = """MATCH (n:Researcher {researcher_id: $id})
    OPTIONAL MATCH (n)-[r]-(related)
    RETURN n, type(r) AS relationship, labels(related) AS related_labels, related.name AS related_name
    LIMIT 50
"""
    params = {
        "id": id,
    }
    result = await execute_cypher(cypher, params, tool_name="get_researcher_by_id")
    return json.dumps(result, default=str)



@tool
async def run_cypher(query: str, parameters: str = "{}") -> str:
    """Execute a read-only Cypher query against the knowledge graph."""
    try:
        params = json.loads(parameters) if parameters else {}
    except json.JSONDecodeError:
        return json.dumps({"error": "Invalid JSON parameters"})
    params.setdefault("domain", settings.domain_id)
    try:
        result = await execute_cypher(query, params, tool_name="run_cypher")
        return json.dumps(result, default=str)
    except Exception as e:
        return json.dumps({"error": f"Cypher query failed: {e}"})


@tool
async def get_graph_schema() -> str:
    """Get the knowledge graph schema (node labels and relationship types)."""
    result = await get_schema()
    return json.dumps(result, default=str)

TOOLS = [
    search_researcher,
    citation_network,
    dataset_usage,
    grant_analysis,
    experiment_results,
    list_researchers,
    get_researcher_by_id,
    run_cypher,
    get_graph_schema,
]


if not settings.groq_model:
    raise RuntimeError(
        "GROQ_MODEL is not set. Define GROQ_MODEL in your .env "
        "(e.g. GROQ_MODEL=openai/gpt-oss-120b)."
    )
if not settings.groq_api_key:
    raise RuntimeError("GROQ_API_KEY is not set in your .env.")

# Note: do NOT pass base_url unless the user explicitly set a non-default Groq
# endpoint. langchain-groq already targets https://api.groq.com/openai/v1, so
# forwarding that same value causes the path to be appended twice and Groq
# returns "Unknown request URL: /openai/v1/openai/v1/chat/completions".
_DEFAULT_GROQ_URL = "https://api.groq.com/openai/v1"
_groq_kwargs: dict = {
    "model": settings.groq_model,
    "api_key": settings.groq_api_key,
    "temperature": 0,
}
if settings.groq_url and settings.groq_url.rstrip("/") != _DEFAULT_GROQ_URL:
    _groq_kwargs["base_url"] = settings.groq_url

model = ChatGroq(**_groq_kwargs)

graph = create_react_agent(model, TOOLS, prompt=SYSTEM_PROMPT)


# ---------------------------------------------------------------------------
# Message handler
# ---------------------------------------------------------------------------


async def handle_message(message: str, session_id: str | None = None) -> dict:
    """Handle an incoming chat message."""
    session_id = resolve_session_id(session_id)

    # Retrieve conversation history and store the new user message
    await store_message(session_id, "user", message)
    context = await get_context(session_id, query=message)
    history = context.get("messages", [])

    # Build messages list with conversation history
    from langchain_core.messages import HumanMessage, AIMessage
    history_messages = []
    for msg in history:
        if msg["role"] == "user":
            history_messages.append(HumanMessage(content=msg["content"]))
        elif msg["role"] == "assistant":
            history_messages.append(AIMessage(content=msg["content"]))

    result = await graph.ainvoke(
        {"messages": history_messages + [HumanMessage(content=message)]},
        config={"configurable": {"thread_id": session_id}},
    )

    # Extract the last AI message
    ai_messages = [m for m in result["messages"] if hasattr(m, "content") and m.type == "ai"]
    response_text = ai_messages[-1].content if ai_messages else ""
    if not response_text.strip():
        response_text = "I searched the knowledge graph but couldn't find relevant results for your query. Could you try rephrasing your question?"

    assistant_result = await store_message(session_id, "assistant", response_text)

    return {
        "response": response_text,
        "session_id": session_id,
        "graph_data": None,
        "entities_extracted": (assistant_result or {}).get("entities", []),
        "preferences_detected": (assistant_result or {}).get("preferences", []),
    }


async def handle_message_stream(message: str, session_id: str | None = None) -> dict:
    """Handle a chat message with streaming text deltas via the collector event queue."""
    from app.context_graph_client import get_collector

    session_id = resolve_session_id(session_id)

    collector = get_collector()
    await store_message(session_id, "user", message)
    context = await get_context(session_id, query=message)
    history = context.get("messages", [])

    from langchain_core.messages import HumanMessage, AIMessage
    history_messages = []
    for msg in history:
        if msg["role"] == "user":
            history_messages.append(HumanMessage(content=msg["content"]))
        elif msg["role"] == "assistant":
            history_messages.append(AIMessage(content=msg["content"]))

    response_text = ""
    async for event in graph.astream_events(
        {"messages": history_messages + [HumanMessage(content=message)]},
        config={"configurable": {"thread_id": session_id}},
        version="v2",
    ):
        kind = event.get("event", "")
        if kind == "on_chat_model_stream":
            chunk = event.get("data", {}).get("chunk")
            if chunk and hasattr(chunk, "content"):
                text = ""
                if isinstance(chunk.content, str):
                    text = chunk.content
                elif isinstance(chunk.content, list):
                    text = "".join(
                        block.get("text", "") if isinstance(block, dict) else getattr(block, "text", "")
                        for block in chunk.content
                        if (isinstance(block, dict) and block.get("type") == "text")
                        or (hasattr(block, "type") and getattr(block, "type", None) == "text")
                    )
                if text:
                    collector.emit_text_delta(text)
                    response_text += text

    if not response_text.strip():
        response_text = "I searched the knowledge graph but couldn't find relevant results for your query. Could you try rephrasing your question?"

    assistant_result = await store_message(session_id, "assistant", response_text)
    if assistant_result:
        collector.emit_entities_extracted(assistant_result.get("entities", []))
        collector.emit_preferences_detected(assistant_result.get("preferences", []))
    collector.emit_done(response_text, session_id)

    return {
        "response": response_text,
        "session_id": session_id,
        "graph_data": None,
    }
