# Deep Analysis of Seeded Neo4j Data — Scientific Research Domain

This document analyzes exactly what `data/fixtures.json` + `data/ontology.yaml` (domain = **scientific-research**, inherits `_base.yaml`) seed into Neo4j, calls out the **data quality issues** that affect any question you can ask, and then proposes **decision-grade questions** that the graph can actually answer end-to-end (Cypher included).

---

## 1. What the Seed Actually Contains

### 1.1 Node inventory (counts from `fixtures.json`)

| Label | Pole type | Count | Key properties |
|---|---|---|---|
| `Person` (base) | PERSON | 5 | name, email, role |
| `Organization` (base) | ORGANIZATION | 5 | name, industry |
| `Location` (base) | LOCATION | 5 | address, lat/lon |
| `Event` (base) | EVENT | 5 | date, description |
| `Object` (base) | OBJECT | 5 | name, description |
| `Researcher` (domain) | OBJECT/ACADEMIC | 5 | researcher_id, h_index, title, specialization |
| `Paper` (domain) | OBJECT/PUBLICATION | 5 | doi, journal, citation_count, paper_type |
| `Dataset` (domain) | OBJECT/DATA_RESOURCE | 5 | size_gb, format, license |
| `Experiment` (domain) | EVENT/RESEARCH_ACTIVITY | 5 | status, start_date, end_date |
| `Grant` (domain) | OBJECT/FUNDING | 5 | amount, currency, status, funding_agency |
| `Institution` (domain) | OBJECT/ACADEMIC_ORG | 5 | institution_type, country, ranking |

Total: **55 nodes** across 11 labels (5 base POLE+O + 6 domain).

### 1.2 Relationship inventory

Base relationships (Person/Org/Location/Event world):
- `WORKS_FOR` (Person→Organization) — 8 edges, multi-org employees (Sarah Chen, Maria Rodriguez, David Park all belong to 2 orgs).
- `LOCATED_AT` (Organization→Location) — 8 edges; orgs span multiple cities.
- `PARTICIPATED_IN` (Person→Event) — 8 edges.

Domain relationships (research world):
- `AUTHORED` (Researcher→Paper) — 7 edges (multi-author papers: GNN-Drug, CRISPR).
- `CITED` (Paper→Paper) — 6 edges, **includes a cycle**: GNN→CRISPR→Quantum→mRNA→DarkMatter→GNN.
- `FUNDED_BY` (Experiment→Grant) — 8 edges (most experiments funded by 2 grants).
- `REPLICATED` (Experiment→Experiment) — 8 edges, **bidirectional pairs** (Temp↔Prompt, Context↔RAG, Context↔Temp).
- `USED_DATASET` (Paper→Dataset) — 7 edges.
- `AFFILIATED_WITH` (Researcher→Institution) — 5 edges (1 institution per researcher).
- `CONDUCTED` (Researcher→Experiment) — 6 edges (Raj Patel conducts 2).
- `PRODUCED_DATASET` (Experiment→Dataset) — 7 edges.

Total: **78 relationships** across 11 types.

### 1.3 Documents and decision traces

- **20 documents** seeded across 5 templates (grant_proposal, peer_review, lab_notebook, experiment_log, publication_draft). All have boilerplate `# … Summary / Details / Recommendations …` content with template variables resolved by string substitution only.
- **10 decision traces** (research_direction, dataset_selection, collaboration_assessment, grant_proposal_strategy, reproducibility_assessment, peer_review_synthesis, literature_gap_analysis, data_management_plan, impact_assessment, plus the duplicated ones). Each has 3–4 `{thought, action, observation}` steps plus an `outcome`.

### 1.4 Two disconnected sub-graphs

Critically, the base entities and the domain entities **do not share any edges** in the seed:

```
[Person]──WORKS_FOR──[Organization]──LOCATED_AT──[Location]
   └────PARTICIPATED_IN────[Event]

[Researcher]──AUTHORED──[Paper]──CITED──[Paper]
   ├──AFFILIATED_WITH──[Institution]
   └──CONDUCTED──[Experiment]──FUNDED_BY──[Grant]
                    ├──REPLICATED──[Experiment]
                    ├──PRODUCED_DATASET──[Dataset]
                    └──(Paper)──USED_DATASET──[Dataset]
```

There is **no edge** linking `Researcher`↔`Person`, or `Institution`↔`Organization`, even though Sarah Chen the `Person` and `Dr. Sarah Chen (Genomics)` the `Researcher` clearly should be the same entity. Same for `Object` nodes — they are orphans.

---

## 2. Data Quality Issues (affect every downstream question)

These come from the generator (`backend/scripts/generate_data.py`) using template substitution and randomization without semantic constraints.

1. **`Paper.title` is wrong.** It contains the *researcher's role* (`"Senior Analyst"`, `"Project Manager"`, …) instead of the actual paper title. The real title is stored in `Paper.name`. Any "search by title" tool will fail.
2. **`Grant.title` is also the role**, not the grant title. `Grant.name` holds the descriptive label.
3. **`doi`, `orcid`, `abstract`, `journal`, `access_url`** are literally the string `"<name> - Doi"`, `"<name> - Abstract"`, etc. — not real identifiers. Uniqueness constraints pass, but value is zero.
4. **`Researcher.specialization` is mis-matched** to the name: "Dr. Sarah Chen (Genomics)" has specialization `Cardiology`; "Prof. James Okafor (Physics)" has `Oncology`; etc. Any specialization-driven recommendation is meaningless.
5. **`h_index` values are absurd** (e.g., 8830, 4986). Real h-index caps in the low hundreds.
6. **Grant date ranges are inverted** for most grants (`end_date < start_date`, e.g., NIH R01 starts 2026-02-28, ends 2024-01-01). Status enum (`submitted`, `awarded`, `active`, `completed`) is inconsistent with dates.
7. **Experiment date ranges** are also inverted in 3 of 5 cases (RAG Pipeline ends before it starts; Context Window ends before it starts).
8. **Grant currencies are mixed** (USD, EUR, GBP, JPY, CAD) but `Grant.amount` is unconverted — `194227.78 JPY` ≈ $1,300, not $194k. Any "total funding" sum across grants is wrong unless normalized.
9. **`Institution.institution_type` contradicts the name**: "Max Planck Institute" is typed `hospital`; "Oxford Nanopore Research" is typed `industry_lab` but receives the `DOE ARPA-E` grant via a researcher; "Stanford Bio-X" is typed `research_institute`.
10. **CITED cycle**: the citation graph has a directed cycle (5 papers form a ring). Real citation graphs are DAGs ordered by publication date. Several `CITED` edges go from older→newer papers (e.g., a 2024 paper citing a 2025 paper).
11. **REPLICATED is symmetric in the data** (both directions stored). The ontology declares it directional; this complicates "X replicates Y" queries — you must use the undirected form.
12. **`Dataset` names are non-scientific** ("Municipal Spending 2020-2025", "Campaign Finance Records", "Public School Performance Metrics") — they are civic-data names attached to bio/physics/ML experiments. They came from a generic fixture pool.
13. **`Experiment` names are ML-ops oriented** ("RAG Pipeline Comparison", "Fine-tuning Run FT-042", "Prompt Engineering A/B Test") not scientific-research oriented (no biology, physics, chemistry experiments).
14. **No `Person`↔`Researcher` link, no `Organization`↔`Institution` link.** The 5 `Object` nodes are completely orphaned (zero edges).
15. **Documents are generic placeholder text** ("Key findings and observations … are documented below.") — there is no real prose to do RAG/extraction over. The extractor (`backend/app/extractor.py`) will find nothing.
16. **Decision traces contain non-sequitur observations** ("Top result: Pacific Northwest Industries with 4 connected entities" while assessing a paper). The traces are synthetically filled, not produced by a real agent run over the graph.

> **Implication for decision questions:** Avoid questions that depend on titles, abstracts, currency-normalized totals, citation-temporal logic, or specialization matching. Favor questions on **structure** (degrees, paths, components, multi-hop joins) and on **categorical attributes** that the generator did populate consistently (`status`, `paper_type`, `format`, `license`, `institution_type`, `country`).

---

## 3. Decision-Grade Questions the Graph Can Answer

Each question below is paired with the executable Cypher and which decision-trace template (from `ontology.yaml`) it maps to. These are designed for the chat agent / decision-trace panel.

### 3.1 Funding & Portfolio Decisions

**Q1. Which active grants are funding experiments that are not yet completed, and how concentrated is each grant's experimental portfolio?**
Maps to: `grant_proposal_strategy`, portfolio risk.
```cypher
MATCH (g:Grant)<-[:FUNDED_BY]-(e:Experiment)
RETURN g.name              AS grant,
       g.funding_agency    AS agency,
       g.status            AS grant_status,
       g.amount            AS amount,
       g.currency          AS currency,
       count(e)            AS experiments_funded,
       collect(e.status)   AS experiment_statuses
ORDER BY experiments_funded DESC;
```
**Decision it supports:** Should we renew this grant? Is it producing output, or are all its experiments `failed` / `abandoned`?

**Q2. Which experiments are at risk because their only funding source is in a non-active status?**
```cypher
MATCH (e:Experiment)-[:FUNDED_BY]->(g:Grant)
WITH e, collect(g) AS grants
WHERE none(x IN grants WHERE x.status IN ['active','awarded'])
RETURN e.name AS at_risk_experiment,
       e.status AS exp_status,
       [g IN grants | g.name + ' (' + g.status + ')'] AS funding_sources;
```
**Decision:** Reallocate funding or pause the experiment.

**Q3. What is the total committed funding per funding agency, normalized only within USD-denominated grants (to avoid currency mixing)?**
```cypher
MATCH (g:Grant {currency:'USD'})<-[:FUNDED_BY]-(e:Experiment)
RETURN g.funding_agency AS agency,
       sum(g.amount)    AS total_usd,
       count(DISTINCT g) AS grants,
       count(DISTINCT e) AS experiments
ORDER BY total_usd DESC;
```

### 3.2 Reproducibility & Experiment Decisions

**Q4. Which experiments have been replicated by an independent researcher (different `CONDUCTED` source)?**
Maps to: `reproducibility_assessment`.
```cypher
MATCH (e1:Experiment)-[:REPLICATED]-(e2:Experiment),
      (r1:Researcher)-[:CONDUCTED]->(e1),
      (r2:Researcher)-[:CONDUCTED]->(e2)
WHERE r1 <> r2 AND id(e1) < id(e2)
RETURN e1.name AS experiment_a, r1.name AS lead_a,
       e2.name AS experiment_b, r2.name AS lead_b;
```
**Decision:** Trust the finding (independently replicated) vs. flag for further verification.

**Q5. Which experiments form a replication chain of length ≥ 2 (independent multi-hop replications)?**
```cypher
MATCH path = (e:Experiment)-[:REPLICATED*2..3]-(other:Experiment)
WHERE e <> other
RETURN e.name AS root,
       [n IN nodes(path) | n.name] AS chain,
       length(path) AS hops
ORDER BY hops DESC
LIMIT 10;
```

**Q6. Which dataset is the most "validated" — used by the largest number of distinct papers AND produced by the largest number of distinct experiments?**
Maps to: `dataset_selection`, `data_management_plan`.
```cypher
MATCH (d:Dataset)
OPTIONAL MATCH (p:Paper)-[:USED_DATASET]->(d)
OPTIONAL MATCH (e:Experiment)-[:PRODUCED_DATASET]->(d)
WITH d, count(DISTINCT p) AS users, count(DISTINCT e) AS producers
RETURN d.name, d.license, d.format, d.size_gb,
       users, producers, (users + producers) AS reuse_score
ORDER BY reuse_score DESC;
```
**Decision:** Pick a dataset with high reuse + permissive license (`cc_by`, `cc0`, `mit`) for a new experiment.

### 3.3 Collaboration & Impact Decisions

**Q7. Which researchers share at least one co-authored paper, and how many papers do they co-author?** (Co-author graph.)
Maps to: `collaboration_assessment`.
```cypher
MATCH (r1:Researcher)-[:AUTHORED]->(p:Paper)<-[:AUTHORED]-(r2:Researcher)
WHERE id(r1) < id(r2)
RETURN r1.name AS researcher_a,
       r2.name AS researcher_b,
       count(DISTINCT p) AS shared_papers,
       collect(DISTINCT p.name) AS papers;
```

**Q8. Which researchers cross institutions through co-authorship (potential cross-institutional collaborations)?**
```cypher
MATCH (r1:Researcher)-[:AUTHORED]->(p:Paper)<-[:AUTHORED]-(r2:Researcher),
      (r1)-[:AFFILIATED_WITH]->(i1:Institution),
      (r2)-[:AFFILIATED_WITH]->(i2:Institution)
WHERE i1 <> i2 AND id(r1) < id(r2)
RETURN r1.name, i1.name, r2.name, i2.name, p.name AS shared_paper;
```
**Decision:** Strengthen an institutional partnership, target a joint grant proposal.

**Q9. Rank researchers by a structural "impact" score derived only from graph topology (avoids fake h-index/citation_count values).**
Maps to: `impact_assessment`.
```cypher
MATCH (r:Researcher)
OPTIONAL MATCH (r)-[:AUTHORED]->(p:Paper)
OPTIONAL MATCH (r)-[:CONDUCTED]->(e:Experiment)-[:FUNDED_BY]->(g:Grant)
OPTIONAL MATCH (r)-[:CONDUCTED]->(e2:Experiment)-[:PRODUCED_DATASET]->(d:Dataset)
RETURN r.name,
       count(DISTINCT p) AS papers,
       count(DISTINCT e) AS experiments,
       count(DISTINCT g) AS grants_touched,
       count(DISTINCT d) AS datasets_produced,
       (count(DISTINCT p) + count(DISTINCT e) + count(DISTINCT g) + count(DISTINCT d)) AS structural_impact
ORDER BY structural_impact DESC;
```

### 3.4 Citation & Literature Decisions

**Q10. Detect citation cycles (data-quality flag and a real-world signal of "citation cartels").**
Maps to: `literature_gap_analysis`.
```cypher
MATCH path = (p:Paper)-[:CITED*2..5]->(p)
RETURN [n IN nodes(path) | n.name] AS cycle, length(path) AS len
LIMIT 10;
```
**Decision:** Flag citation rings before relying on citation-count metrics.

**Q11. Find "bridge" papers — papers cited by papers from different journals (cross-journal influence).**
```cypher
MATCH (citing:Paper)-[:CITED]->(p:Paper)
WITH p, collect(DISTINCT citing.journal) AS journals
WHERE size(journals) >= 2
RETURN p.name, journals, size(journals) AS journal_breadth
ORDER BY journal_breadth DESC;
```

**Q12. Which papers used a dataset that was also produced by another experiment in the system? (provenance chain Paper→Dataset←Experiment)**
```cypher
MATCH (p:Paper)-[:USED_DATASET]->(d:Dataset)<-[:PRODUCED_DATASET]-(e:Experiment),
      (r:Researcher)-[:CONDUCTED]->(e)
RETURN p.name AS paper_using_data,
       d.name AS dataset,
       e.name AS producing_experiment,
       r.name AS data_producer;
```
**Decision:** When citing results, you can now trace back to the originating experiment and its lead.

### 3.5 Operational / Risk Decisions

**Q13. Which researchers are single-points-of-failure** — conducting an experiment for which they are the only conductor AND that experiment funds critical work?
```cypml
MATCH (r:Researcher)-[:CONDUCTED]->(e:Experiment)
WITH e, collect(r) AS conductors
WHERE size(conductors) = 1
WITH e, head(conductors) AS sole_owner
RETURN sole_owner.name AS researcher,
       collect(e.name) AS solo_experiments,
       count(e) AS bus_factor_load
ORDER BY bus_factor_load DESC;
```

**Q14. Which experiments have inconsistent dates (data integrity check that turns into a workflow alert)?**
```cypher
MATCH (e:Experiment)
WHERE e.end_date < e.start_date
RETURN e.name, e.status, e.start_date, e.end_date,
       duration.inDays(e.start_date, e.end_date).days AS day_delta;
```
**Decision:** Force a project-manager review before counting this experiment in any KPI.

**Q15. Institution coverage map — which countries are represented and what is the funding/researcher footprint per country?**
```cypher
MATCH (r:Researcher)-[:AFFILIATED_WITH]->(i:Institution)
OPTIONAL MATCH (r)-[:CONDUCTED]->(e:Experiment)-[:FUNDED_BY]->(g:Grant)
RETURN i.country,
       count(DISTINCT i) AS institutions,
       count(DISTINCT r) AS researchers,
       count(DISTINCT g) AS grants,
       collect(DISTINCT g.funding_agency) AS agencies;
```

### 3.6 Cross-graph (POLE+O ↔ domain) Decisions — currently NOT answerable

These are the questions a user will *naturally* ask but the seed cannot resolve until the entity-resolution gap is fixed:

- **Q-X1.** "Does Sarah Chen the employee = Dr. Sarah Chen (Genomics) the researcher?"
- **Q-X2.** "Which Organizations are also Institutions in our research graph?"
- **Q-X3.** "Did any researcher participate in an Event?"

**Recommended fix:** add a post-seed Cypher pass that creates `SAME_AS` (or `:Person:Researcher` multi-label) edges where `Person.name` is a substring of `Researcher.name`, and similar for `Organization`↔`Institution` via fuzzy name match. Example:

```cypher
MATCH (p:Person), (r:Researcher)
WHERE r.name CONTAINS p.name
MERGE (p)-[:SAME_AS]->(r);
```

Add this to `cypher/schema.cypher` so every seeded DB gets the bridge.

---

## 4. Recommended Next Steps

1. **Fix the obvious data bugs** in `backend/scripts/generate_data.py`:
   - Swap `Paper.title` and `Paper.name` (or make them equal).
   - Match `Researcher.specialization` to the parenthetical hint in the name.
   - Cap `h_index` at a realistic max (e.g., 150).
   - Ensure `end_date > start_date` for `Experiment` and `Grant`.
   - Normalize all `Grant.amount` to USD or store both `amount_native` and `amount_usd`.
   - Make `CITED` respect publication date order (citer.date > cited.date).
   - Replace generic dataset names with domain-appropriate ones (genomics / physics / chemistry).

2. **Bridge the two sub-graphs** with `SAME_AS` (or shared labels) so the agent can reason across POLE+O and domain layers.

3. **Use Q1–Q15 above as the official "demo questions"** for the chat panel — they are the ones that actually exercise the relationships the seed creates correctly.

4. **Re-generate `decision_traces`** at runtime from a real agent loop (Cypher tool calls feeding observations) instead of pre-baked strings; the current observations are nonsensical and undermine the Decision Trace UI.
