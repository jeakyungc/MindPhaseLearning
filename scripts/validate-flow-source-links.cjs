const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const rootDir = path.resolve(__dirname, "..");
const graphPath = path.join(rootDir, "generated", "mindphase-codebase-graph.json");
const flowDataPath = path.join(rootDir, "src", "lib", "flow-data.js");

function fail(message) {
  console.error(`[validate:links] ${message}`);
  process.exitCode = 1;
}

function readGraph() {
  try {
    return JSON.parse(fs.readFileSync(graphPath, "utf8"));
  } catch (error) {
    console.error(`[validate:links] unable to read ${graphPath}: ${error.message}`);
    process.exit(1);
  }
}

function callReferenceTokens(step) {
  const text = String(step?.call || step?.code || "");
  const identifiers = [...text.matchAll(/[A-Za-z_$][\w$]*/g)].map((match) => match[0]);
  const qualified = [...text.matchAll(/[A-Za-z_$][\w$]*(?:(?:\.|::)[A-Za-z_$][\w$]*)+/g)]
    .map((match) => match[0]);
  const last = qualified.length
    ? qualified[qualified.length - 1].split(/\.|::/).at(-1)
    : identifiers.at(-1);
  return {
    identifiers,
    identifierSet: new Set(identifiers),
    qualified,
    qualifiedSet: new Set(qualified),
    last,
  };
}

function stepSymbolScore(symbol, tokens) {
  if (symbol.kind === "module") return 0;
  if (!tokens.identifiers.length && !tokens.qualified.length) return 0;
  if (symbol.qualifiedName && tokens.qualifiedSet.has(symbol.qualifiedName)) return 160;
  if (symbol.qualifiedName && tokens.qualifiedSet.has(symbol.qualifiedName.replace(/::/g, "."))) return 155;
  if (tokens.last && symbol.name === tokens.last) return 140;
  if (tokens.identifierSet.has(symbol.name)) return 120;
  if (symbol.containerName && tokens.identifierSet.has(symbol.containerName)) return 80;
  if (tokens.identifiers.some((token) => String(symbol.signature || "").includes(token))) return 35;
  return 0;
}

function resolveSourceReference(graph, step) {
  const files = Array.isArray(graph.files) ? graph.files : [];
  const symbols = Array.isArray(graph.symbols) ? graph.symbols : [];
  const file = files.find((record) => record.repoPath === step.source) || null;
  const tokens = callReferenceTokens(step);
  const symbol = symbols
    .filter((candidate) => candidate.repoPath === step.source)
    .map((candidate) => ({ symbol: candidate, score: stepSymbolScore(candidate, tokens) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || (a.symbol.range?.startLine ?? 0) - (b.symbol.range?.startLine ?? 0))
    .map((result) => result.symbol)[0] || null;

  return {
    file,
    symbol,
    range: symbol?.range || (file ? { repoPath: file.repoPath, startLine: 1, endLine: 1 } : null),
    repoPath: symbol?.repoPath || file?.repoPath || step.source,
  };
}

async function main() {
  const graph = readGraph();
  const { FLOWS } = await import(pathToFileURL(flowDataPath).href);
  let total = 0;
  let linked = 0;
  let symbolLinked = 0;
  let fileFallback = 0;

  for (const flow of FLOWS) {
    for (const step of flow.steps) {
      total += 1;
      const ref = resolveSourceReference(graph, step);
      const owner = `${flow.id}/${step.id || step.index}`;
      if (!ref.file) fail(`${owner} source path is missing from graph files: ${step.source}`);
      if (ref.repoPath !== step.source) fail(`${owner} resolved to ${ref.repoPath}, expected ${step.source}`);
      if (!ref.range) fail(`${owner} source path has no local line range: ${step.source}`);
      if (ref.range) linked += 1;
      if (ref.symbol) symbolLinked += 1;
      else if (ref.file) fileFallback += 1;
    }
  }

  if (!process.exitCode) {
    console.log(
      `[validate:links] ok: ${linked}/${total} flow steps linked (${symbolLinked} symbol, ${fileFallback} file fallback)`,
    );
  }
}

main().catch((error) => {
  console.error(`[validate:links] ${error.stack || error.message}`);
  process.exit(1);
});
