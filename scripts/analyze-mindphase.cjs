const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
let ts = null;
try {
  ts = require("typescript");
} catch {
  ts = null;
}

const rootDir = path.resolve(__dirname, "..");
const defaultCacheSource = path.join(rootDir, ".cache", "mindphase-source");
const tempSource = path.join(process.env.TEMP || process.env.TMP || rootDir, "mindphase-analysis-main");
const outputPath = path.join(rootDir, "generated", "mindphase-codebase-graph.json");
const staticOutputPath = path.join(rootDir, "static", "generated", "mindphase-codebase-graph.json");
const repoFullName = process.env.MINDPHASE_REPOSITORY || "jeakyungc/MindPhase";
const repoUrl = process.env.MINDPHASE_REPOSITORY_URL || `https://github.com/${repoFullName}.git`;
const ref = process.env.MINDPHASE_REF || "main";

const sourceRoot = resolveSourceRoot();
const commitSha = git(["rev-parse", "HEAD"], sourceRoot, "unknown");
const sourceFiles = collectSourceFiles(sourceRoot);
const fileRecords = [];
const fileIdByPath = new Map();
const symbols = [];
const imports = [];
const edges = [];
const symbolByFileAndName = new Map();
const exportedNamesByFile = new Map();
const eventSymbolByName = new Map();
const commandNameMap = new Map();
const moduleSymbolByFileId = new Map();
const externalModuleSymbolBySpecifier = new Map();
const svelteVirtualSourceByFileName = new Map();
const svelteVirtualFileByRepoPath = new Map();
const svelteRepoPathByVirtualFile = new Map();

for (const absolutePath of sourceFiles) {
  const repoPath = slash(path.relative(sourceRoot, absolutePath));
  const text = fs.readFileSync(absolutePath, "utf8");
  const lines = text.split(/\r?\n/);
  const treePathSegments = repoPath.split("/");
  const fileId = `file:${repoPath}`;
  fileIdByPath.set(repoPath, fileId);
  fileRecords.push({
    id: fileId,
    repoPath,
    displayName: treePathSegments[treePathSegments.length - 1],
    treePathSegments,
    localPath: absolutePath,
    language: languageFor(repoPath),
    lineCount: lines.length,
    lines,
    githubUrl: githubUrl(repoPath, 1),
  });
  addModuleSymbol(fileId, repoPath, lines.length);
}

for (const absolutePath of sourceFiles) {
  analyzeFile(absolutePath);
}

loadCommandNames();
resolveImportTargets();
addImportEdges();
resolveCallEdges();
resolveTypeScriptCallEdges();
resolveRustQualifiedCallEdges();
resolveIpcCommandEdges();
resolveEdgeStats();

const graph = {
  metadata: {
    generatedAt: new Date().toISOString(),
    sourceRoot,
    repository: repoFullName,
    ref,
    commitSha,
    analyzer: {
      name: "mindphase-learning-static-analyzer",
      version: 2,
      note:
        "Line ranges are derived from source text. TypeScript call edges use compiler API definition lookup when available, then fall back to name/import resolution. Frontend and Rust method symbols include qualifiedName/containerName metadata. IPC command edges resolve commandNames.* to Rust #[tauri::command] functions when present.",
      typescriptCompilerApi: Boolean(ts),
    },
  },
  files: fileRecords,
  tree: buildFileTree(fileRecords),
  symbols,
  imports,
  edges,
  stats: {
    files: fileRecords.length,
    symbols: symbols.length,
    imports: imports.length,
    edges: edges.length,
    edgeKinds: edgeKindCounts(edges),
    edgeConfidence: edgeConfidenceCounts(edges),
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.mkdirSync(path.dirname(staticOutputPath), { recursive: true });
const serializedGraph = `${JSON.stringify(graph, null, 2)}\n`;
fs.writeFileSync(outputPath, serializedGraph, "utf8");
fs.writeFileSync(staticOutputPath, serializedGraph, "utf8");
console.log(`[analyze] wrote ${path.relative(rootDir, outputPath)} from ${sourceRoot}`);
console.log(`[analyze] wrote ${path.relative(rootDir, staticOutputPath)} for static serving`);
console.log(
  `[analyze] ${graph.stats.files} files, ${graph.stats.symbols} symbols, ${graph.stats.imports} imports, ${graph.stats.edges} edges`,
);

function resolveSourceRoot() {
  const candidates = [
    process.env.MINDPHASE_SOURCE,
    tempSource,
    defaultCacheSource,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (hasMindPhaseSources(resolved)) return resolved;
  }

  fs.mkdirSync(path.dirname(defaultCacheSource), { recursive: true });
  if (!fs.existsSync(defaultCacheSource)) {
    execFileSync("git", ["clone", "--depth", "1", "--branch", ref, repoUrl, defaultCacheSource], {
      stdio: "inherit",
    });
  } else {
    git(["fetch", "--depth", "1", "origin", ref], defaultCacheSource, "");
    git(["checkout", "FETCH_HEAD"], defaultCacheSource, "");
  }

  if (!hasMindPhaseSources(defaultCacheSource)) {
    throw new Error(`Unable to locate MindPhase sources at ${defaultCacheSource}`);
  }
  return defaultCacheSource;
}

function hasMindPhaseSources(candidate) {
  return (
    candidate &&
    fs.existsSync(path.join(candidate, "src")) &&
    fs.existsSync(path.join(candidate, "src-tauri", "src"))
  );
}

function collectSourceFiles(baseDir) {
  const roots = [path.join(baseDir, "src"), path.join(baseDir, "src-tauri", "src")];
  const extensions = new Set([".ts", ".svelte", ".js", ".mjs", ".rs"]);
  const files = [];

  for (const root of roots) walk(root);
  return files.sort((a, b) => slash(path.relative(baseDir, a)).localeCompare(slash(path.relative(baseDir, b))));

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "target", ".git", ".svelte-kit"].includes(entry.name)) continue;
        walk(absolute);
      } else if (extensions.has(path.extname(entry.name))) {
        files.push(absolute);
      }
    }
  }
}

function analyzeFile(absolutePath) {
  const repoPath = slash(path.relative(sourceRoot, absolutePath));
  const fileId = fileIdByPath.get(repoPath);
  const text = fs.readFileSync(absolutePath, "utf8");
  const lines = text.split(/\r?\n/);
  const language = languageFor(repoPath);

  if (language === "rust") {
    analyzeRustFile(fileId, repoPath, lines);
  } else {
    analyzeFrontendFile(fileId, repoPath, lines);
  }
}

function analyzeFrontendFile(fileId, repoPath, lines) {
  const importedBindings = new Map();
  const importRegex =
    /^\s*import(?:\s+type)?(?:\s+([\s\S]*?)\s+from\s+)?["']([^"']+)["'];?\s*$/;

  lines.forEach((line, index) => {
    const match = line.match(importRegex);
    if (!match) return;
    const specifier = match[2];
    const lineNumber = index + 1;
    const record = {
      id: `import:${imports.length + 1}`,
      fromFile: fileId,
      fromPath: repoPath,
      specifier,
      importedNames: importedNamesFromClause(match[1]),
      range: range(repoPath, lineNumber, lineNumber),
      confidence: "exact",
    };
    imports.push(record);
    for (const name of record.importedNames) importedBindings.set(name, specifier);
  });

  const exportedNames = new Set();
  const containerRanges = [];
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const signatureMatch =
      line.match(/^(\s*)(export\s+)?(async\s+)?function\s+([A-Za-z_$][\w$]*)\b/) ||
      line.match(/^(\s*)(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/) ||
      line.match(/^(\s*)(export\s+)?class\s+([A-Za-z_$][\w$]*)\b/);
    if (signatureMatch) {
      const name = signatureMatch[4] || signatureMatch[3];
      const exported = Boolean(signatureMatch[2]);
      const kind = line.includes("class ") ? "class" : "function";
      const endLine = findBlockEnd(lines, index);
      if (exported) exportedNames.add(name);
      addSymbol({
        kind,
        name,
        signature: trimSignature(line),
        language: languageFor(repoPath),
        fileId,
        repoPath,
        startLine: lineNumber,
        endLine,
        exported,
      });
      if (kind === "class") {
        containerRanges.push({ kind, name, startIndex: index, endIndex: endLine - 1, exported });
      }
      return;
    }

    const objectMatch = line.match(/^(\s*)(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*\{/);
    if (!objectMatch) return;
    const name = objectMatch[3];
    const exported = Boolean(objectMatch[2]);
    const endLine = findBlockEnd(lines, index);
    if (exported) exportedNames.add(name);
    addSymbol({
      kind: "object",
      name,
      signature: trimSignature(line),
      language: languageFor(repoPath),
      fileId,
      repoPath,
      startLine: lineNumber,
      endLine,
      exported,
    });
    containerRanges.push({ kind: "object", name, startIndex: index, endIndex: endLine - 1, exported });
  });

  for (const container of containerRanges) {
    analyzeFrontendContainerMethods(fileId, repoPath, lines, container);
  }

  exportedNamesByFile.set(fileId, exportedNames);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const owner = nearestSymbol(fileId, lineNumber);

    for (const commandMatch of line.matchAll(/commandNames\.([A-Za-z_$][\w$]*)/g)) {
      if (owner) {
        edges.push({
          id: `edge:${edges.length + 1}`,
          kind: "ipc-command",
          from: owner.id,
          to: null,
          unresolvedName: commandMatch[1],
          commandProperty: commandMatch[1],
          commandName: null,
          range: range(repoPath, lineNumber, lineNumber),
          confidence: "unresolved",
          label: `commandNames.${commandMatch[1]}`,
        });
      }
    }

    for (const eventMatch of line.matchAll(/\b(?:listen|emit)\s*\(\s*["']([^"']+)["']/g)) {
      if (owner) addEventEdge(owner, eventMatch[1], repoPath, lineNumber, "event");
    }

    const callRegex = /\b([A-Za-z_$][\w$]*)\s*\(/g;
    let match;
    while ((match = callRegex.exec(line))) {
      const callee = match[1];
      if (["if", "for", "while", "switch", "catch", "function", "return"].includes(callee)) continue;
      if (isFrontendDeclarationName(line, callee, match.index)) continue;
      if (!owner) continue;
      edges.push({
        id: `edge:${edges.length + 1}`,
        kind: "call",
        from: owner.id,
        to: null,
        unresolvedName: callee,
        importSpecifier: importedBindings.get(callee) || null,
        range: range(repoPath, lineNumber, lineNumber),
        calleeColumn: match.index + 1,
        confidence: "unresolved",
        label: callee,
      });
    }
  });
}

function analyzeFrontendContainerMethods(fileId, repoPath, lines, container) {
  for (let index = container.startIndex + 1; index < container.endIndex; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    if (/^(if|for|while|switch|catch|function|return|else)\b/.test(trimmed)) continue;

    const methodMatch = frontendMethodMatch(trimmed, container.kind);
    if (!methodMatch) continue;
    const name = methodMatch.name;
    if (!name || name === "constructor") continue;
    addSymbol({
      kind: "method",
      name,
      signature: trimSignature(line),
      language: languageFor(repoPath),
      fileId,
      repoPath,
      startLine: index + 1,
      endLine: findBlockEnd(lines, index),
      exported: container.exported,
      containerName: container.name,
      qualifiedName: `${container.name}.${name}`,
    });
  }
}

function frontendMethodMatch(trimmed, containerKind) {
  const prefix = String.raw`(?:(?:public|private|protected|static|readonly|override|abstract|async|get|set)\s+)*`;
  const identifier = String.raw`([A-Za-z_$][\w$]*)`;
  let match = trimmed.match(new RegExp(`^${prefix}${identifier}\\s*(?:<[^>]+>)?\\s*\\([^)]*\\)\\s*(?::[^=;{]+)?\\s*\\{?`));
  if (match) return { name: match[1] };

  if (containerKind === "object") {
    match = trimmed.match(new RegExp(`^${identifier}\\s*:\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>`));
    if (match) return { name: match[1] };
    match = trimmed.match(new RegExp(`^${identifier}\\s*:\\s*(?:async\\s*)?function\\b`));
    if (match) return { name: match[1] };
  }
  return null;
}

function isFrontendDeclarationName(line, name, index) {
  const before = line.slice(0, index + name.length);
  const declarationPatterns = [
    new RegExp(`\\bfunction\\s+${escapeRegExp(name)}\\s*$`),
    new RegExp(`\\bclass\\s+${escapeRegExp(name)}\\s*$`),
    new RegExp(`\\b(?:const|let|var)\\s+${escapeRegExp(name)}\\s*=\\s*(?:async\\s*)?$`),
  ];
  return declarationPatterns.some((pattern) => pattern.test(before));
}

function addModuleSymbol(fileId, repoPath, lineCount) {
  const id = `symbol:${symbols.length + 1}`;
  const symbol = {
    id,
    kind: "module",
    name: repoPath,
    signature: repoPath,
    language: languageFor(repoPath),
    fileId,
    repoPath,
    range: range(repoPath, 1, Math.max(1, lineCount)),
    exported: true,
  };
  symbols.push(symbol);
  moduleSymbolByFileId.set(fileId, symbol);
}

function analyzeRustFile(fileId, repoPath, lines) {
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const useMatch = line.match(/^\s*use\s+([^;]+);/);
    if (useMatch) {
      imports.push({
        id: `import:${imports.length + 1}`,
        fromFile: fileId,
        fromPath: repoPath,
        specifier: useMatch[1].trim(),
        importedNames: rustUseNames(useMatch[1]),
        range: range(repoPath, lineNumber, lineNumber),
        confidence: "exact",
      });
    }

    const fnMatch = line.match(/^\s*(pub\s+)?(async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (fnMatch) {
      const previous = previousMeaningfulLine(lines, index);
      const tauriCommand = previous.includes("#[tauri::command]");
      const containerName = rustImplContainerAt(lines, index);
      addSymbol({
        kind: containerName ? "method" : tauriCommand ? "tauri-command" : "function",
        name: fnMatch[3],
        signature: trimSignature(line),
        language: "rust",
        fileId,
        repoPath,
        startLine: lineNumber,
        endLine: findBlockEnd(lines, index),
        exported: Boolean(fnMatch[1]),
        containerName,
        qualifiedName: containerName ? `${containerName}::${fnMatch[3]}` : null,
      });
    }
  });

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const owner = nearestSymbol(fileId, lineNumber);
    const trimmedLine = line.trim();

    for (const eventMatch of line.matchAll(/\bemit_to\s*\([^,]+,\s*["']([^"']+)["']/g)) {
      if (owner) addEventEdge(owner, eventMatch[1], repoPath, lineNumber, "event");
    }

    if (trimmedLine.startsWith("#[")) return;
    const callRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:::\s*)?\(/g;
    let match;
    while ((match = callRegex.exec(line))) {
      const callee = match[1];
      if (["if", "for", "while", "match", "loop", "Ok", "Err", "Some", "None"].includes(callee)) continue;
      if (!owner) continue;
      const rustCall = rustCallContext(line, match.index, callee);
      if (rustCall.genericBound) continue;
      edges.push({
        id: `edge:${edges.length + 1}`,
        kind: "call",
        from: owner.id,
        to: null,
        unresolvedName: callee,
        importSpecifier: null,
        rustPath: rustCall.path,
        rustMethodCall: rustCall.method,
        range: range(repoPath, lineNumber, lineNumber),
        confidence: rustCall.method ? "external-method" : "unresolved",
        label: callee,
      });
    }
  });
}

function rustCallContext(line, index, callee) {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(line[cursor])) cursor -= 1;
  if (line[cursor] === ".") return { method: true, path: null };
  const before = line.slice(0, index);
  if (/^\s*where\b/.test(before) || /(^|[^:]):\s*$/.test(before)) {
    return { method: false, path: null, genericBound: true };
  }
  const prefix = before;
  const pathMatch = prefix.match(/([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*)::\s*$/);
  return {
    method: false,
    path: pathMatch ? `${pathMatch[1]}::${callee}` : null,
  };
}

function rustImplContainerAt(lines, targetIndex) {
  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const implMatch = line.match(/^\s*impl(?:\s*<[^>]+>)?\s+([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)?)/);
    if (!implMatch) continue;
    const endLine = findBlockEnd(lines, index);
    if (targetIndex + 1 <= endLine) return implMatch[1].split("::").pop();
  }
  return null;
}

function loadCommandNames() {
  const commandNamesPath = path.join(sourceRoot, "src", "lib", "shared", "ipc", "command-names.ts");
  if (!fs.existsSync(commandNamesPath)) return;
  const repoPath = "src/lib/shared/ipc/command-names.ts";
  const text = fs.readFileSync(commandNamesPath, "utf8");
  for (const match of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*["']([^"']+)["']/g)) {
    commandNameMap.set(match[1], match[2]);
  }
}

function resolveIpcCommandEdges() {
  const rustCommandByName = new Map();
  for (const symbol of symbols) {
    if (symbol.kind === "tauri-command") rustCommandByName.set(symbol.name, symbol);
  }

  for (const edge of edges) {
    if (edge.kind !== "ipc-command") continue;
    const commandName = commandNameMap.get(edge.commandProperty);
    edge.commandName = commandName || null;
    if (!commandName) continue;
    const target = rustCommandByName.get(commandName);
    if (target) {
      edge.to = target.id;
      edge.confidence = "exact";
      edge.label = commandName;
    } else {
      edge.unresolvedName = commandName;
      edge.confidence = "unresolved";
      edge.label = commandName;
    }
  }
}

function addEventEdge(owner, eventName, repoPath, lineNumber, kind) {
  const eventSymbol = eventSymbolFor(eventName, repoPath, lineNumber);
  edges.push({
    id: `edge:${edges.length + 1}`,
    kind,
    from: owner.id,
    to: eventSymbol.id,
    unresolvedName: null,
    eventName,
    range: range(repoPath, lineNumber, lineNumber),
    confidence: "exact",
    label: eventName,
  });
}

function eventSymbolFor(eventName, repoPath, lineNumber) {
  if (eventSymbolByName.has(eventName)) return eventSymbolByName.get(eventName);
  const id = `symbol:${symbols.length + 1}`;
  const symbol = {
    id,
    kind: "event",
    name: eventName,
    signature: eventName,
    language: "event",
    fileId: fileIdByPath.get(repoPath),
    repoPath,
    range: range(repoPath, lineNumber, lineNumber),
    exported: true,
  };
  symbols.push(symbol);
  eventSymbolByName.set(eventName, symbol);
  return symbol;
}

function addSymbol(input) {
  const id = `symbol:${symbols.length + 1}`;
  const symbol = {
    id,
    kind: input.kind,
    name: input.name,
    signature: input.signature,
    language: input.language,
    fileId: input.fileId,
    repoPath: input.repoPath,
    range: range(input.repoPath, input.startLine, input.endLine),
    exported: input.exported,
  };
  if (input.containerName) symbol.containerName = input.containerName;
  if (input.qualifiedName) symbol.qualifiedName = input.qualifiedName;
  symbols.push(symbol);
  symbolByFileAndName.set(`${input.fileId}:${input.name}`, symbol);
  if (input.qualifiedName) symbolByFileAndName.set(`${input.fileId}:${input.qualifiedName}`, symbol);
}

function resolveImportTargets() {
  for (const record of imports) {
    const targetPath = resolveImportPath(record.fromPath, record.specifier);
    if (!targetPath) continue;
    record.toFile = fileIdByPath.get(targetPath) || null;
  }
}

function addImportEdges() {
  for (const record of imports) {
    const fromModule = moduleSymbolByFileId.get(record.fromFile);
    if (!fromModule) continue;
    const targetModule = record.toFile
      ? moduleSymbolByFileId.get(record.toFile)
      : externalModuleSymbol(record.specifier, record.range);
    if (!targetModule) continue;
    edges.push({
      id: `edge:${edges.length + 1}`,
      kind: "import",
      from: fromModule.id,
      to: targetModule.id,
      unresolvedName: null,
      specifier: record.specifier,
      importedNames: record.importedNames,
      range: record.range,
      confidence: record.toFile ? "exact" : "external",
      label: record.specifier,
    });
  }
}

function externalModuleSymbol(specifier, sourceRange) {
  if (!specifier || specifier.startsWith(".") || specifier.startsWith("$lib/")) return null;
  if (externalModuleSymbolBySpecifier.has(specifier)) return externalModuleSymbolBySpecifier.get(specifier);
  const id = `symbol:${symbols.length + 1}`;
  const symbol = {
    id,
    kind: "external-module",
    name: specifier,
    signature: specifier,
    language: "external",
    fileId: null,
    repoPath: "",
    range: sourceRange,
    exported: true,
  };
  symbols.push(symbol);
  externalModuleSymbolBySpecifier.set(specifier, symbol);
  return symbol;
}

function resolveCallEdges() {
  const byName = new Map();
  for (const symbol of symbols) {
    const list = byName.get(symbol.name) || [];
    list.push(symbol);
    byName.set(symbol.name, list);
  }

  const importsByFileAndName = new Map();
  for (const record of imports) {
    if (!record.toFile) continue;
    for (const name of record.importedNames) {
      importsByFileAndName.set(`${record.fromFile}:${name}`, record.toFile);
    }
  }

  for (const edge of edges) {
    if (edge.rustMethodCall) continue;
    const source = symbols.find((symbol) => symbol.id === edge.from);
    if (!source) continue;
    const local = symbolByFileAndName.get(`${source.fileId}:${edge.unresolvedName}`);
    if (local) {
      edge.to = local.id;
      edge.confidence = "exact";
      continue;
    }

    const importedFile = importsByFileAndName.get(`${source.fileId}:${edge.unresolvedName}`);
    if (importedFile) {
      const imported = symbolByFileAndName.get(`${importedFile}:${edge.unresolvedName}`);
      if (imported) {
        edge.to = imported.id;
        edge.confidence = "exact";
        continue;
      }
    }

    const matches = byName.get(edge.unresolvedName) || [];
    if (matches.length === 1) {
      edge.to = matches[0].id;
      edge.confidence = "inferred";
    }
  }
}

function resolveTypeScriptCallEdges() {
  if (!ts) return;
  prepareSvelteVirtualSources();
  const tsFiles = sourceFiles.filter((filePath) => {
    const repoPath = slash(path.relative(sourceRoot, filePath));
    return repoPath.startsWith("src/") && [".ts", ".js", ".mjs"].includes(path.extname(repoPath));
  });
  const rootNames = [...tsFiles, ...svelteVirtualSourceByFileName.keys()];
  if (!rootNames.length) return;

  const compilerOptions = {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    baseUrl: sourceRoot,
    paths: {
      "$lib/*": ["src/lib/*"],
    },
  };
  const host = ts.createCompilerHost(compilerOptions, true);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (fileName) => svelteVirtualSourceByFileName.has(normalizeAbsolutePath(fileName)) || originalFileExists(fileName);
  host.readFile = (fileName) => svelteVirtualSourceByFileName.get(normalizeAbsolutePath(fileName)) || originalReadFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const normalized = normalizeAbsolutePath(fileName);
    const virtualSource = svelteVirtualSourceByFileName.get(normalized);
    if (virtualSource != null) {
      return ts.createSourceFile(fileName, virtualSource, languageVersion, true, ts.ScriptKind.TS);
    }
    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
  const program = ts.createProgram(rootNames, compilerOptions, host);
  const checker = program.getTypeChecker();
  const symbolByDeclaration = buildSymbolDeclarationIndex();

  for (const edge of edges) {
    if (edge.kind !== "call" || !edge.calleeColumn) continue;
    const sourceSymbol = symbols.find((symbol) => symbol.id === edge.from);
    if (!sourceSymbol || !["typescript", "javascript", "svelte"].includes(sourceSymbol.language)) continue;
    const absolute = sourceSymbol.language === "svelte"
      ? svelteVirtualFileByRepoPath.get(sourceSymbol.repoPath)
      : path.join(sourceRoot, sourceSymbol.repoPath);
    if (!absolute) continue;
    const sourceFile = program.getSourceFile(absolute);
    if (!sourceFile) continue;
    const position = sourceFile.getPositionOfLineAndCharacter(
      Math.max(0, edge.range.startLine - 1),
      Math.max(0, edge.calleeColumn - 1),
    );
    const node = deepestNodeAt(sourceFile, position);
    if (!node) continue;
    let symbol = checker.getSymbolAtLocation(node);
    if (!symbol) continue;
    if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
      symbol = checker.getAliasedSymbol(symbol);
    }
    const declaration = symbol.valueDeclaration || symbol.declarations?.[0];
    if (!declaration) continue;
    const resolved = symbolForTsDeclaration(declaration, symbolByDeclaration);
    if (!resolved) continue;
    edge.to = resolved.id;
    edge.confidence = "ts-definition";
    edge.label = edge.label || resolved.name;
  }
}

function resolveRustQualifiedCallEdges() {
  const rustFunctionByFileAndName = new Map();
  for (const symbol of symbols) {
    if (symbol.language !== "rust") continue;
    if (!["function", "tauri-command"].includes(symbol.kind)) continue;
    const list = rustFunctionByFileAndName.get(`${symbol.repoPath}:${symbol.name}`) || [];
    list.push(symbol);
    rustFunctionByFileAndName.set(`${symbol.repoPath}:${symbol.name}`, list);
  }

  for (const edge of edges) {
    if (edge.kind !== "call" || !edge.rustPath || edge.rustMethodCall) continue;
    const source = symbols.find((symbol) => symbol.id === edge.from);
    if (!source || source.language !== "rust") continue;
    const target = resolveRustPathToSymbol(edge.rustPath, rustFunctionByFileAndName);
    if (!target) {
      edge.to = null;
      edge.confidence = "external-qualified";
      continue;
    }
    edge.to = target.id;
    edge.confidence = "rust-qualified";
    edge.label = edge.rustPath;
  }
}

function resolveRustPathToSymbol(rustPath, rustFunctionByFileAndName) {
  const normalizedPath = rustPath.replace(/^crate::/, "");
  const parts = normalizedPath.split("::").filter(Boolean);
  if (parts.length < 2) return null;
  const functionName = parts[parts.length - 1];
  const moduleParts = parts.slice(0, -1);

  for (let count = moduleParts.length; count >= 1; count -= 1) {
    const base = slash(path.join("src-tauri", "src", ...moduleParts.slice(0, count)));
    const candidates = [
      `${base}.rs`,
      `${base}/mod.rs`,
    ];
    for (const candidate of candidates) {
      const matches = rustFunctionByFileAndName.get(`${candidate}:${functionName}`);
      if (matches?.length) return matches[0];
    }
  }
  return null;
}

function buildSymbolDeclarationIndex() {
  const index = new Map();
  for (const symbol of symbols) {
    if (!["typescript", "javascript", "svelte"].includes(symbol.language)) continue;
    index.set(`${symbol.repoPath}:${symbol.range.startLine}:${symbol.name}`, symbol);
  }
  return index;
}

function symbolForTsDeclaration(declaration, index) {
  const sourceFile = declaration.getSourceFile();
  if (!sourceFile?.fileName) return null;
  const normalized = normalizeAbsolutePath(sourceFile.fileName);
  const repoPath = svelteRepoPathByVirtualFile.get(normalized) || slash(path.relative(sourceRoot, sourceFile.fileName));
  if (!repoPath || repoPath.startsWith("..")) return null;
  const line = sourceFile.getLineAndCharacterOfPosition(declaration.getStart(sourceFile)).line + 1;
  const name = declaration.name?.getText(sourceFile);
  if (name) {
    const direct = index.get(`${repoPath}:${line}:${name}`);
    if (direct) return direct;
  }
  const sameLine = symbols.find((symbol) =>
    symbol.repoPath === repoPath &&
    symbol.range.startLine === line &&
    ["function", "class"].includes(symbol.kind)
  );
  if (sameLine) return sameLine;
  return symbols.find((symbol) =>
    symbol.repoPath === repoPath &&
    symbol.range.startLine <= line &&
    line <= symbol.range.endLine &&
    ["function", "class"].includes(symbol.kind)
  ) || null;
}

function prepareSvelteVirtualSources() {
  if (svelteVirtualSourceByFileName.size) return;
  for (const absolutePath of sourceFiles) {
    const repoPath = slash(path.relative(sourceRoot, absolutePath));
    if (!repoPath.endsWith(".svelte")) continue;
    const source = fs.readFileSync(absolutePath, "utf8");
    const virtual = svelteScriptVirtualSource(source);
    if (!virtual.trim()) continue;
    const virtualFile = normalizeAbsolutePath(path.join(sourceRoot, `${repoPath}.ts`));
    svelteVirtualSourceByFileName.set(virtualFile, virtual);
    svelteVirtualFileByRepoPath.set(repoPath, virtualFile);
    svelteRepoPathByVirtualFile.set(virtualFile, repoPath);
  }
}

function svelteScriptVirtualSource(source) {
  const chars = [...source].map((char) => (char === "\n" || char === "\r" ? char : " "));
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(source))) {
    const contentStart = match.index + match[0].indexOf(">") + 1;
    const contentEnd = contentStart + match[1].length;
    for (let i = contentStart; i < contentEnd; i += 1) {
      chars[i] = source[i];
    }
  }
  return chars.join("");
}

function deepestNodeAt(node, position) {
  let found = null;
  function visit(current) {
    if (position < current.getFullStart() || position >= current.getEnd()) return;
    found = current;
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

function nearestSymbol(fileId, lineNumber) {
  let candidate = null;
  for (const symbol of symbols) {
    if (symbol.fileId !== fileId) continue;
    if (symbol.range.startLine <= lineNumber && lineNumber <= symbol.range.endLine) {
      if (!candidate || symbol.range.startLine >= candidate.range.startLine) candidate = symbol;
    }
  }
  return candidate;
}

function importedNamesFromClause(clause) {
  if (!clause) return [];
  const names = new Set();
  const trimmed = clause.trim();
  const defaultMatch = trimmed.match(/^([A-Za-z_$][\w$]*)\s*(?:,|$)/);
  if (defaultMatch) names.add(defaultMatch[1]);
  const namedMatch = trimmed.match(/\{([^}]+)\}/);
  if (namedMatch) {
    for (const part of namedMatch[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  const namespaceMatch = trimmed.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (namespaceMatch) names.add(namespaceMatch[1]);
  return [...names];
}

function rustUseNames(specifier) {
  const names = new Set();
  const group = specifier.match(/\{([^}]+)\}/);
  if (group) {
    for (const part of group[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) names.add(name);
    }
  } else {
    const last = specifier.trim().split("::").pop();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(last)) names.add(last);
  }
  return [...names];
}

function resolveImportPath(fromPath, specifier) {
  if (fromPath.startsWith("src-tauri/") && specifier.startsWith("crate::")) {
    return resolveRustCrateImport(specifier);
  }
  if (!specifier.startsWith(".") && !specifier.startsWith("$lib/")) return null;
  let base;
  if (specifier.startsWith("$lib/")) {
    base = path.join("src", "lib", specifier.slice("$lib/".length));
  } else {
    base = slash(path.normalize(path.join(path.dirname(fromPath), specifier)));
  }

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.svelte`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.rs`,
    `${base}/index.ts`,
    `${base}/mod.rs`,
  ].map(slash);

  return candidates.find((candidate) => fileIdByPath.has(candidate)) || null;
}

function resolveRustCrateImport(specifier) {
  let modulePath = specifier.trim();
  if (modulePath.startsWith("crate::{")) return null;
  modulePath = modulePath.replace(/^crate::/, "");
  modulePath = modulePath.replace(/::\{.*$/, "");
  modulePath = modulePath.replace(/\{.*$/, "");
  modulePath = modulePath.split(/\s+as\s+/)[0].trim();
  const parts = modulePath.split("::").filter(Boolean);
  while (parts.length) {
    const base = slash(path.join("src-tauri", "src", ...parts));
    const candidates = [
      `${base}.rs`,
      `${base}/mod.rs`,
    ];
    const found = candidates.find((candidate) => fileIdByPath.has(candidate));
    if (found) return found;
    parts.pop();
  }
  return null;
}

function findBlockEnd(lines, startIndex) {
  let depth = 0;
  let sawBrace = false;
  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i];
    for (const char of line) {
      if (char === "{") {
        depth += 1;
        sawBrace = true;
      } else if (char === "}") {
        depth -= 1;
      }
    }
    if (sawBrace && depth <= 0) return i + 1;
  }
  return startIndex + 1;
}

function previousMeaningfulLine(lines, startIndex) {
  for (let i = startIndex - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (line) return line;
  }
  return "";
}

function resolveEdgeStats() {
  for (const edge of edges) {
    if (edge.to) continue;
    if (["external-method", "external-qualified", "external"].includes(edge.confidence)) continue;
    if (edge.confidence !== "unresolved") edge.confidence = "unresolved";
  }
}

function edgeKindCounts(edgeList) {
  return edgeList.reduce((counts, edge) => {
    counts[edge.kind] = (counts[edge.kind] || 0) + 1;
    return counts;
  }, {});
}

function edgeConfidenceCounts(edgeList) {
  return edgeList.reduce((counts, edge) => {
    const confidence = edge.confidence || "unknown";
    counts[confidence] = (counts[confidence] || 0) + 1;
    return counts;
  }, {});
}

function buildFileTree(files) {
  const root = { id: "dir:", name: "MindPhase", path: "", kind: "directory", children: [] };
  const directories = new Map([["", root]]);

  for (const file of files) {
    let parent = root;
    let currentPath = "";
    const segments = file.treePathSegments || file.repoPath.split("/");
    for (let index = 0; index < segments.length - 1; index += 1) {
      currentPath = currentPath ? `${currentPath}/${segments[index]}` : segments[index];
      let directory = directories.get(currentPath);
      if (!directory) {
        directory = {
          id: `dir:${currentPath}`,
          name: segments[index],
          path: currentPath,
          kind: "directory",
          children: [],
        };
        directories.set(currentPath, directory);
        parent.children.push(directory);
      }
      parent = directory;
    }
    parent.children.push({
      id: file.id,
      name: file.displayName || segments[segments.length - 1],
      path: file.repoPath,
      kind: "file",
      fileId: file.id,
      language: file.language,
      lineCount: file.lineCount,
    });
  }

  sortTree(root);
  return root;
}

function sortTree(node) {
  if (!node.children) return;
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) sortTree(child);
}

function range(repoPath, startLine, endLine) {
  return {
    repoPath,
    startLine,
    startColumn: 1,
    endLine,
    endColumn: 1,
    githubUrl: githubUrl(repoPath, startLine, endLine),
    localPath: path.join(sourceRoot, repoPath),
  };
}

function githubUrl(repoPath, startLine, endLine = startLine) {
  const anchor = endLine && endLine !== startLine ? `#L${startLine}-L${endLine}` : `#L${startLine}`;
  return `https://github.com/${repoFullName}/blob/${commitSha || ref}/${repoPath}${anchor}`;
}

function languageFor(repoPath) {
  const extension = path.extname(repoPath);
  if (extension === ".rs") return "rust";
  if (extension === ".svelte") return "svelte";
  if (extension === ".mjs" || extension === ".js") return "javascript";
  return "typescript";
}

function trimSignature(line) {
  return line.trim().replace(/\s+/g, " ").slice(0, 240);
}

function slash(value) {
  return value.replace(/\\/g, "/");
}

function normalizeAbsolutePath(value) {
  return path.resolve(value).toLowerCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function git(args, cwd, fallback) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return fallback;
  }
}
