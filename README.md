# BuildersEye

**Enterprise RAG System over HR Organization Graph** — a production-oriented Applied AI project that demonstrates Retrieval-Augmented Generation (RAG) with role-based access control, visible retrieval tracing, and a 3D organizational identity graph.

> Built with: Vite/Vanilla JS Frontend (Vercel) + Node/Express Backend (Azure Container Apps) + Neon Postgres + DeepSeek LLM

## What This Project Demonstrates

- ✅ **Full RAG Pipeline**: Keyword search, vector search (384d embeddings), SQL analytics, and LLM generation
- ✅ **Role-Based Access Control (RBAC)**: CEO/HR/Manager/Employee with scope-based data access enforcement
- ✅ **Visible Retrieval Surface**: 3D org graph + neural network pipeline inspector showing exactly what the AI inspects
- ✅ **19-Node Trace Pipeline**: Real-time node-level visibility into every step
- ✅ **Production Authentication**: JWT access/refresh tokens, rate limiting, Neon-backed sessions
- ✅ **Evaluation Framework**: 65-question golden dataset, reproducible RAG evaluation
- ✅ **Security Hardened**: Server-side authorization, threat model documented, production-safe defaults

## Architecture Overview

```
User (Vercel) ──→ Azure Container Apps (:5199)
  ├── /api/auth/*         JWT login/refresh/logout
  ├── /api/chat           RAG pipeline (19 trace nodes)
  ├── /api/debug/*        Pipeline inspector + latency stats
  └── /api/preview/*      Test credentials (auth-gated)
         │
         ▼
  Neon Postgres (employees, vectors, auth_sessions, onedrive_tokens)
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full system diagram and request lifecycle.

## Quick Start

```bash
# Install
npm install && cd server && npm install

# Backend (port 5199)
npm run dev:backend

# Frontend (port 5174) — separate terminal
npm run dev

# Or both
npm run dev:all
```

## Running Tests

```bash
npm test                    # All deterministic tests (backend must be running)
npm run test:api            # RBAC matrix test
npm run test:e2e            # Playwright E2E test
npm run eval:rag            # RAG evaluation (direct mode, no backend needed)
npm run verify:security     # Security static analysis
```

## RAG Evaluation

65 golden questions across 8 categories. Dual mode (direct/HTTP). Includes regression test for SQL misclassification.

```bash
npm run eval:rag                    # Direct mode
npm run eval:rag -- --http          # HTTP mode
npm run eval:rag -- --filter=q026   # Single regression test
```

See [eval/EVALUATION.md](./eval/EVALUATION.md) for full methodology.

## Security

See [SECURITY.md](./SECURITY.md) for threat model, mitigations, and deployment checklist.

Key features: JWT with server-side refresh token hashing, RBAC, rate limiting, read-only SQL enforcement, production-safe defaults.

## Known Limitations

- Repository is currently **public** (should be made private due to HR demo data)
- Frontend timeout is 15s (streaming is planned future work)
- Vector index is memory-heavy; disabled on low-RAM via `VECTOR_INDEX_DISABLED=true`
- Debug page admin gate has a client-side component (backend endpoints are properly secured)
- `emp001` / `hr-manager` not in actual seed data

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vite, Vanilla JS, Three.js (3D) |
| Backend | Node.js, Express |
| Database | Neon Postgres + pgvector |
| LLM | DeepSeek (deepseek-v4-flash) |
| Auth | JWT, bcrypt, refresh tokens |
| Embeddings | e5-small (384d, local) |
| SQL Engine | AlaSQL (in-memory) |
| Deploy | Vercel (frontend) + Azure Container Apps (backend) |
| Testing | Playwright (E2E), custom API test suite |

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — System design, module boundaries, request lifecycle
- [SECURITY.md](./SECURITY.md) — Threat model, mitigations, deployment checklist
- [eval/EVALUATION.md](./eval/EVALUATION.md) — RAG evaluation methodology
- [AI_CONTEXT.md](./AI_CONTEXT.md) — Project context for AI collaborators
- [PROJECT.md](./PROJECT.md) — Feature inventory and milestones

## Project Status

Active Applied AI / RAG Engineering portfolio project. Complete RAG pipeline with RBAC, evaluation framework, security hardening, and test coverage.
