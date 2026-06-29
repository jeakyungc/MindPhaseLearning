# MindPhase Learning

Static Svelte 5 codebase visualizer for `jeakyungc/MindPhase`. It analyzes `src` and `src-tauri/src`, writes a source graph to JSON, and renders flow boards that include cross-flow step nodes, function/import edges, source line links, and searchable symbol neighborhoods.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

The default dev server runs the SvelteKit app. The legacy single-file page is still available through `npm run dev:legacy` while the Svelte version is being validated.

## Analyze A Specific Checkout

By default, the analyzer uses an existing cached checkout or clones `jeakyungc/MindPhase` from `main`. To analyze a local checkout:

```bash
$env:MINDPHASE_SOURCE="C:\path\to\MindPhase"
npm run analyze
```

Useful environment variables:

- `MINDPHASE_SOURCE`: local MindPhase checkout containing `src` and `src-tauri/src`
- `MINDPHASE_REF`: Git ref used when cloning the repository
- `MINDPHASE_REPOSITORY`: owner/name, defaults to `jeakyungc/MindPhase`
- `MINDPHASE_REPOSITORY_URL`: clone URL override
- `PORT`: legacy dev server port, defaults to `5173`

## Verify

```bash
npm run analyze
npm run validate
npm run check
npm run build
```

Validation checks that generated files, symbols, imports, and edges have consistent IDs, exact source line ranges, GitHub line URLs, and local path metadata. `npm run check` runs Svelte diagnostics, and `npm run build` writes the static site to `build/`.

## GitHub Pages

This app is configured for GitHub Project Pages at `/MindPhaseLearning/`.

1. Create or connect a GitHub repository named `MindPhaseLearning`.
2. Push the `main` branch.
3. In GitHub, set Pages source to GitHub Actions.
4. The workflow in `.github/workflows/pages.yml` runs validation, builds the SvelteKit static site, and deploys `build/`.

The generated code graph is committed under `static/generated/mindphase-codebase-graph.json` so Pages deploys do not need to clone and analyze MindPhase on every build.

## What The Visualizer Shows

- Flow board context nodes for incoming flow openers, the selected flow steps, and outgoing handoff targets
- Clicking an incoming or outgoing step node changes the selected flow, active step, side detail panel, execution log, URL query params, and sidebar active state together
- Cross-flow edges rendered inside `class="flow-board"` instead of only in the details panel
- Active step function edges with exact source line links when available
- Code symbol search across modules, functions, classes, Rust functions, Tauri commands, and external modules
- Symbol neighborhood boards for selected code symbols, including import/call/IPC/event edges and confidence labels

## Analyzer Notes

TypeScript, JavaScript, and Svelte call edges use the TypeScript compiler API when available. Svelte `<script>` blocks are mapped through virtual TypeScript files while preserving original source line numbers. Rust analysis currently combines source text ranges, `use` path resolution, Tauri command detection, IPC command matching, and qualified Rust path resolution; unresolved and external calls are retained with confidence labels instead of being discarded.
