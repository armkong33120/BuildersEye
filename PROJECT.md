# Project: BuildersEye Showcase Landing Website

## Architecture
Multi-page static frontend built with Vite, HTML5, CSS3 (modular CSS variables, dark glassmorphism, responsive breakpoints), vanilla JavaScript, and interactive inline SVGs.
- `index.html`: Showcase landing website entry point.
- `app.html`: Original 3D Org-Graph RAG application entry point.
- `vite.config.js`: Multi-page build configuration targeting `dist/`.
- `src/`: Shared styles, scripts, SVG assets, and components.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Multi-Page Vite Setup | Rename `/index.html` to `/app.html`, create new `/index.html`, configure `vite.config.js` for multi-entry build | M1 | R1 |
| 2 | Hero Section | Branding, tagline, CTA buttons, 3D visual preview link | M2 | R2 §3.1 |
| 3 | What Is It Section | 3 core concepts (RAG over Org-Graph, 3D Viz, RBAC) + target audience table | M2 | R2 §3.1 |
| 4 | Live Demo / Features Section | Showcase 3D graph, chat, node flashing, RBAC policy enforcement | M2 | R2 §3.1 |
| 5 | System Flow Diagram (4.2) | Interactive inline SVG illustrating user query to LLM response flow & brain selector | M2 | R2 §4.2 |
| 6 | Tech Stack Section | Detailed breakdown of Frontend, Backend, AI/LLM, Auth, Data, Deploy | M2 | R2 §4.4 |
| 7 | Roadmap & Flywheel (4.3) | Compounding value table & interactive inline SVG for Self-Improvement Flywheel | M2 | R2 §4.1/4.3 |
| 8 | Try It / Test Accounts Panel | Live test account credentials (CEO, HR, Manager, Employee) linking to `/app.html?preview=1` | M2 | R2 §5 |
| 9 | Footer Section | Links, credits, demo notes | M2 | R2 §3.1 |
| 10 | Custom Interactive Web Tour Guide | Custom CSS/JS walkthrough overlaying Mock UI frame (3-5 steps, zero external libraries) | M3 | R3 |
| 11 | Final Build & Forensic Audit | `npm run build` verification producing `dist/index.html` and `dist/app.html`, audit integrity check | M4 | Audit |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Multi-Page Vite Configuration | `app.html`, `index.html`, `vite.config.js` | none | DONE |
| M2 | Premium Showcase Website & Inline SVGs | 8 sections, CSS design system, responsive layout, inline SVGs for 4.2 & 4.3 | M1 | DONE |
| M3 | Custom Interactive Web Tour Guide | Custom JS/CSS walkthrough overlaying Mock UI | M2 | DONE |
| M4 | Final Build Verification & Audit | `npm run build` dist check & Forensic Integrity Audit | M1, M2, M3 | DONE |

## Code Layout
- `/index.html`: Main landing page entry.
- `/app.html`: 3D application entry (renamed from original `index.html`).
- `/vite.config.js`: Vite build configuration supporting multi-page input (`index` and `app`).
- `/src/styles/`: Modular CSS files (design system variables, layout, components, tour guide).
- `/src/js/`: Modular JavaScript scripts (interactive SVGs, tour guide controller, mock UI handler).
