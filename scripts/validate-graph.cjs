const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const graphPath = path.join(rootDir, "generated", "mindphase-codebase-graph.json");

function fail(message) {
  console.error(`[validate] ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readGraph() {
  try {
    return JSON.parse(fs.readFileSync(graphPath, "utf8"));
  } catch (error) {
    console.error(`[validate] unable to read ${graphPath}: ${error.message}`);
    process.exit(1);
  }
}

function validateRange(owner, range, fileByRepoPath) {
  assert(range && typeof range === "object", `${owner} is missing range`);
  if (!range) return;

  const file = fileByRepoPath.get(range.repoPath);
  assert(file, `${owner} range repoPath does not exist: ${range.repoPath}`);
  assert(Number.isInteger(range.startLine) && range.startLine >= 1, `${owner} has invalid startLine`);
  assert(Number.isInteger(range.endLine) && range.endLine >= range.startLine, `${owner} has invalid endLine`);
  if (file) {
    assert(range.endLine <= file.lineCount, `${owner} range exceeds file line count`);
  }
  assert(typeof range.githubUrl === "string" && range.githubUrl.includes("#L"), `${owner} is missing GitHub line URL`);
  assert(typeof range.localPath === "string" && range.localPath.length > 0, `${owner} is missing localPath`);
}

const graph = readGraph();
const files = Array.isArray(graph.files) ? graph.files : [];
const symbols = Array.isArray(graph.symbols) ? graph.symbols : [];
const imports = Array.isArray(graph.imports) ? graph.imports : [];
const edges = Array.isArray(graph.edges) ? graph.edges : [];

const fileById = new Map(files.map((file) => [file.id, file]));
const fileByRepoPath = new Map(files.map((file) => [file.repoPath, file]));
const symbolById = new Map(symbols.map((symbol) => [symbol.id, symbol]));

assert(graph.metadata && graph.metadata.commitSha, "metadata.commitSha is missing");
assert(graph.metadata && graph.metadata.sourceRoot, "metadata.sourceRoot is missing");
assert(files.length > 0, "graph contains no files");
assert(symbols.length > 0, "graph contains no symbols");
assert(edges.length > 0, "graph contains no edges");

for (const file of files) {
  assert(file.id && file.id.startsWith("file:"), `file has invalid id: ${file.id}`);
  assert(file.repoPath && !path.isAbsolute(file.repoPath), `${file.id} has invalid repoPath`);
  assert(Number.isInteger(file.lineCount) && file.lineCount >= 1, `${file.id} has invalid lineCount`);
  assert(typeof file.githubUrl === "string" && file.githubUrl.includes("#L1"), `${file.id} is missing GitHub URL`);
  assert(typeof file.localPath === "string" && file.localPath.length > 0, `${file.id} is missing localPath`);
}

for (const symbol of symbols) {
  if (symbol.kind === "external-module") {
    assert(!symbol.fileId, `${symbol.id} external module should not reference a source file`);
    continue;
  }
  assert(fileById.has(symbol.fileId), `${symbol.id} references missing file ${symbol.fileId}`);
  validateRange(symbol.id, symbol.range, fileByRepoPath);
}

for (const record of imports) {
  assert(fileById.has(record.fromFile), `${record.id} references missing fromFile ${record.fromFile}`);
  if (record.toFile) assert(fileById.has(record.toFile), `${record.id} references missing toFile ${record.toFile}`);
  validateRange(record.id, record.range, fileByRepoPath);
}

for (const edge of edges) {
  assert(symbolById.has(edge.from), `${edge.id} references missing from symbol ${edge.from}`);
  if (edge.to) assert(symbolById.has(edge.to), `${edge.id} references missing to symbol ${edge.to}`);
  validateRange(edge.id, edge.range, fileByRepoPath);
  assert(edge.kind, `${edge.id} is missing kind`);
  assert(edge.confidence, `${edge.id} is missing confidence`);
}

if (!process.exitCode) {
  console.log(
    `[validate] ok: ${files.length} files, ${symbols.length} symbols, ${imports.length} imports, ${edges.length} edges`,
  );
}
