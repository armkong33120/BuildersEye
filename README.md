# BuildersEye

BuildersEye is an experimental frontend for exploring how enterprise RAG systems can make identity, reporting lines, and workspace ownership visible before an answer is generated.

The current prototype renders a 3D organizational identity sphere where people, departments, reporting relationships, and OneDrive ownership are represented as interactive graph objects. The goal is not only to visualize an org chart, but to help non-AI users understand what an AI system is inspecting, why a context was selected, and where governance rules should intervene.

## Research Direction

Most RAG interfaces hide the retrieval process behind a chat box. This project explores the opposite direction: a visible retrieval surface where organizational context, permission boundaries, reporting paths, and workspace ownership can be inspected as part of the answer workflow.

The working hypothesis is:

> If users can see which identities, departments, reporting lines, and workspace contexts are being scanned, they will trust enterprise AI answers more and catch unsafe or irrelevant retrieval earlier.

## Target Outcome

The imagined end state is a frontend where an employee can ask a question and the system visually shows:

- which department or identity cluster is being scanned
- which reporting paths are relevant to the query
- which Mail, OneDrive, SharePoint, or Teams sources are candidates for retrieval
- which governance rule is checked before the LLM responds
- whether the answer is allowed, blocked, redacted, or needs escalation

The UI should make the AI process readable without requiring the user to understand vector databases, embeddings, prompt routing, or access-control internals.

## Current Prototype

The current demo includes:

- 3D identity graph with 150 demo employees
- 6-level organizational atmosphere model
- department-colored nodes
- reporting lines with bidirectional animated communication flow
- collapsible control panels for a full-screen graph view
- RAG-style chat panel with demo chat history
- department keyword scan animation
- node labels using readable role/team labels instead of internal employee IDs
- visibility controls for label levels
- OneDrive ownership metrics as demo workspace context

## Research Questions

1. Can a 3D graph help business users understand what an enterprise RAG system is looking at?
2. Does visible retrieval reduce confusion when an AI answer references organizational data?
3. Can governance checks be presented as part of the normal chat workflow instead of hidden backend logic?
4. How much graph animation is useful before it becomes visual noise?
5. Can identity, reporting lines, and workspace ownership become a practical control surface for AI governance?

## Scope

In scope:

- frontend visualization for identity-aware RAG
- organizational hierarchy and department filtering
- visible retrieval and scan states
- demo policy-check workflow before answer generation
- Mail, OneDrive, SharePoint, and Teams as future enterprise context sources
- UX patterns for non-AI engineers and business users

Out of scope for the current prototype:

- production authentication
- real Microsoft Graph API integration
- real vector database retrieval
- real LLM policy enforcement
- real employee data
- backend audit logging
- production access-control enforcement

## Success Criteria

This prototype will be considered useful if it can demonstrate:

- a user can visually identify which part of the organization is relevant to a query
- a department query can trigger a clear scan/highlight animation
- graph controls can reduce visual clutter without hiding important context
- labels are readable enough to understand who or what a node represents
- the chat panel feels connected to the graph instead of being a separate widget
- the interface can explain an AI decision path at a high level

## Evaluation Plan

Planned evaluation methods:

- usability walkthrough with non-AI users
- compare plain chat vs graph-assisted chat for context understanding
- measure whether users can identify relevant department, manager chain, and workspace owner
- observe which controls are used to reduce visual clutter
- test whether visual scan states make RAG behavior feel more transparent

Possible metrics:

- time to identify relevant department
- time to locate a responsible manager or owner
- number of misunderstood nodes or labels
- perceived trust in the answer
- perceived clarity of the retrieval process
- frame-rate stability during graph animation

## Roadmap

### Phase 1: Visual Prototype

- Build 3D identity sphere
- Add 6 organizational layers
- Add department filters and label controls
- Add bidirectional reporting-line activity
- Add RAG chat surface

### Phase 2: Retrieval Simulation

- Simulate query-to-department matching
- Animate graph scan paths
- Show selected context candidates
- Add source preview cards
- Add policy-check status before response

### Phase 3: Governance UX

- Add answer states: allowed, redacted, blocked, escalated
- Add rule explanation panel
- Add user role and permission simulation
- Add audit timeline view

### Phase 4: Real Integration

- Connect Microsoft Graph demo tenant
- Add real Mail, OneDrive, SharePoint, and Teams metadata
- Connect vector database retrieval
- Connect LLM answer generation
- Add backend audit trail

### Phase 5: Production Hardening

- Replace demo data with permission-scoped data
- Add authentication
- Add server-side policy enforcement
- Add performance budget and graph virtualization
- Add compliance and security review

## Tech Stack

- Vite
- JavaScript ES modules
- Three.js
- CSS2DRenderer
- OrbitControls
- Lucide icons
- Playwright-based visual verification
- Python data generation script

## Development

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Preview production build:

```bash
npm run preview
```

## Data Notice

All identities, emails, departments, reporting lines, and workspace ownership records in this repository are demo data. They are intended for interface design and research exploration only.

## Project Status

This is an early frontend research prototype. The current version focuses on making the mental model of enterprise RAG visible before implementing production-grade retrieval, policy enforcement, or Microsoft Graph integration.
