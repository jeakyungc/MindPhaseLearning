<script>
  import { onMount, tick } from 'svelte';
  import { base } from '$app/paths';
  import {
    FLOWS,
    FUNCTION_EDGES,
    GROUP_RELATIONS,
    LANES,
    RELATION_KINDS,
    normalizeList
  } from '$lib/flow-data.js';

  let selectedFlowId = $state(FLOWS[0]?.id ?? '');
  let selectedStepId = $state(FLOWS[0]?.steps[0]?.id ?? '');
  let selectedSymbolId = $state('');
  let filter = $state('');
  let showFlowRelations = $state(true);
  let playing = $state(false);
  let speedMs = $state(1500);
  let loopAll = $state(true);
  let sidebarOpen = $state(false);
  let codebaseGraph = $state(null);
  let selectedFilePath = $state('');
  let selectedRange = $state(null);
  let expandedTreeDirs = $state(new Set(['src', 'src/lib', 'src-tauri', 'src-tauri/src']));
  let stepRangePins = $state({});
  let showPinList = $state(false);
  let pinEligibleStepKey = $state('');
  let timer = null;
  let lastSyncedSourceKey = '';
  let diagramWrap;
  let edgeLayer;
  let logBody;
  let codeScroller;

  const flowById = (id) => FLOWS.find((flow) => flow.id === id) ?? null;
  const flowIndexById = (id) => FLOWS.findIndex((flow) => flow.id === id);
  const laneById = (id) => LANES.find((lane) => lane.id === id) ?? LANES[0];
  const relationKind = (relation) => RELATION_KINDS[relation.kind] ?? RELATION_KINDS.call;
  const stepById = (flowId, stepId) => flowById(flowId)?.steps.find((step) => step.id === stepId) ?? null;
  const boardNodeKey = (role, flowId, stepId) => `${role}:${flowId}::${stepId}`;
  const PIN_STORAGE_KEY = 'mindphaseLearning.stepRangePins.v1';

  let currentFlow = $derived(flowById(selectedFlowId) ?? FLOWS[0]);
  let selectedStepIndex = $derived(Math.max(0, currentFlow.steps.findIndex((step) => step.id === selectedStepId)));
  let currentStep = $derived(currentFlow.steps[selectedStepIndex] ?? currentFlow.steps[0]);
  let currentLane = $derived(laneById(currentStep?.lane));
  let progress = $derived(currentFlow.steps.length ? ((selectedStepIndex + 1) / currentFlow.steps.length) * 100 : 0);
  let currentRelations = $derived(relationsForFlow(currentFlow.id));
  let incomingRelations = $derived(currentRelations.filter((relation) => relation.toFlow === currentFlow.id));
  let outgoingRelations = $derived(currentRelations.filter((relation) => relation.fromFlow === currentFlow.id));
  let currentFunctionRelations = $derived(crossFunctionEdgesForFlow(currentFlow.id));
  let functionIncoming = $derived(currentFunctionRelations.filter((edge) => edge.toFlow === currentFlow.id));
  let functionOutgoing = $derived(currentFunctionRelations.filter((edge) => edge.fromFlow === currentFlow.id));
  let boardProjection = $derived(buildBoardProjection(currentFlow));
  let stepFunctionDetails = $derived(currentStep ? functionEdgesForStep(currentFlow.id, currentStep.id) : { incoming: [], outgoing: [] });
  let currentSourceRef = $derived(sourceReference(currentStep));
  let filteredGroups = $derived(buildFilteredGroups(filter));
  let symbolResults = $derived(symbolSearchResults(filter));
  let selectedSymbol = $derived(selectedSymbolId ? codebaseSymbolById(selectedSymbolId) : null);
  let analyzerChips = $derived(analyzerMetaChips());
  let fileTreeRows = $derived(visibleFileTreeRows(codebaseGraph?.tree));
  let selectedFile = $derived(codebaseFileByRepoPath(selectedFilePath) ?? codebaseGraph?.files?.[0] ?? null);
  let selectedFileLines = $derived(selectedFile?.lines ?? []);
  let pinnableRanges = $derived(collectPinnableStepRanges());
  let pinnedRanges = $derived(Object.values(stepRangePins).filter((pin) => isKnownPinnableRange(pin)));
  let pinSummary = $derived({ pinned: pinnedRanges.length, total: pinnableRanges.length });
  let currentStepPinKey = $derived(currentStep ? `${currentFlow.id}::${currentStep.id}` : '');
  let currentPinRange = $derived(
    currentStep && pinEligibleStepKey === currentStepPinKey ? pinnableRangeForStep(currentFlow.id, currentStep.id) : null
  );
  let currentPinId = $derived(currentPinRange ? pinIdForRange(currentPinRange) : '');
  let isCurrentRangePinned = $derived(Boolean(currentPinId && stepRangePins[currentPinId]));
  let pinList = $derived(
    pinnedRanges
      .slice()
      .sort((a, b) => b.pinnedAt.localeCompare(a.pinnedAt) || a.repoPath.localeCompare(b.repoPath))
  );

  onMount(() => {
    loadUrlSelection();
    loadStepRangePins();
    loadCodebaseGraph();
    const onResize = () => void scheduleDrawEdges();
    const onKeydown = (event) => handleKeydown(event);
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKeydown);
    return () => {
      stopTimer();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKeydown);
    };
  });

  $effect(() => {
    currentFlow.id;
    currentStep?.id;
    selectedSymbolId;
    showFlowRelations;
    void scheduleDrawEdges();
  });

  $effect(() => {
    if (logBody) logBody.scrollTop = logBody.scrollHeight;
  });

  $effect(() => {
    codebaseGraph;
    currentStep?.id;
    selectedSymbolId;
    const ref = selectedSymbol ? sourceReferenceForSymbol(selectedSymbol) : sourceReference(currentStep);
    const syncKey = `${codebaseGraph?.metadata?.generatedAt || 'loading'}:${ref?.repoPath || ''}:${ref?.startLine || ''}:${ref?.endLine || ''}:${selectedSymbolId || currentStep?.id || ''}`;
    if (syncKey && syncKey !== lastSyncedSourceKey) {
      lastSyncedSourceKey = syncKey;
      focusSourceReference(ref, { updateUrl: true });
    }
  });

  $effect(() => {
    selectedFilePath;
    selectedRange?.startLine;
    void scrollActiveSourceLine();
  });

  function relationsForFlow(flowId) {
    return GROUP_RELATIONS.filter((relation) => relation.fromFlow === flowId || relation.toFlow === flowId);
  }

  function functionEdgesForFlow(flowId) {
    return FUNCTION_EDGES.filter((edge) => edge.fromFlow === flowId || edge.toFlow === flowId);
  }

  function crossFunctionEdgesForFlow(flowId) {
    return functionEdgesForFlow(flowId).filter((edge) => edge.fromFlow !== edge.toFlow);
  }

  function functionEdgesForStep(flowId, stepId) {
    return {
      incoming: FUNCTION_EDGES.filter((edge) => edge.toFlow === flowId && edge.toStep === stepId),
      outgoing: FUNCTION_EDGES.filter((edge) => edge.fromFlow === flowId && edge.fromStep === stepId)
    };
  }

  function stepLabel(flowId, stepId) {
    const flow = flowById(flowId);
    const step = stepById(flowId, stepId);
    if (!flow || !step) return stepId;
    return `${flow.title} / ${String(step.index + 1).padStart(2, '0')} ${step.title}`;
  }

  function flowNumberLabel(flowId) {
    const index = flowIndexById(flowId);
    return index >= 0 ? String(index + 1).padStart(2, '0') : '--';
  }

  function stepNumberLabel(flowId, stepId) {
    const step = stepById(flowId, stepId);
    return step ? String(step.index + 1).padStart(2, '0') : '--';
  }

  function directionLabel(direction) {
    return direction === 'incoming' ? 'Incoming' : 'Outgoing';
  }

  function stepReferenceMode(flowId) {
    return flowId === currentFlow.id ? 'step-only' : 'full';
  }

  function buildBoardProjection(flow) {
    const crossEdges = crossFunctionEdgesForFlow(flow.id);
    const sequenceEdges = flow.steps.slice(0, -1).map((step, index) => {
      const nextStep = flow.steps[index + 1];
      return {
        id: `sequence:${flow.id}:${step.id}->${nextStep.id}`,
        kind: 'sequence',
        fromFlow: flow.id,
        fromStep: step.id,
        toFlow: flow.id,
        toStep: nextStep.id
      };
    });
    const slots = [];
    const seen = new Set();

    function addNode(flowId, stepId, role, edge = null) {
      const step = stepById(flowId, stepId);
      const nodeFlow = flowById(flowId);
      if (!step || !nodeFlow) return;
      const key = boardNodeKey(role, flowId, stepId);
      if (seen.has(key)) return;
      seen.add(key);
      const laneIndex = Math.max(0, LANES.findIndex((lane) => lane.id === step.lane));
      slots.push({ key, role, flowId, stepId, flow: nodeFlow, step, laneIndex });
    }

    crossEdges.filter((edge) => edge.toFlow === flow.id).forEach((edge) => addNode(edge.fromFlow, edge.fromStep, 'incoming', edge));
    flow.steps.forEach((step) => addNode(flow.id, step.id, 'current'));
    crossEdges.filter((edge) => edge.fromFlow === flow.id).forEach((edge) => addNode(edge.toFlow, edge.toStep, 'outgoing', edge));

    const columnCount = Math.max(slots.length, 1);
    const nodes = slots.map((node, index) => ({
      ...node,
      column: index + 1,
      row: node.laneIndex + 1
    }));

    return { nodes, edges: [...sequenceEdges, ...crossEdges], rowCount: LANES.length, columnCount };
  }

  function buildFilteredGroups(queryText) {
    const query = queryText.trim().toLowerCase();
    const groups = new Map();
    FLOWS.forEach((flow, index) => {
      const relationText = relationsForFlow(flow.id).flatMap((relation) => [
        relation.from,
        relation.to,
        relation.via,
        relation.description,
        relationKind(relation).label
      ]);
      const functionEdgeText = functionEdgesForFlow(flow.id).flatMap((edge) => [
        edge.fromFunction,
        edge.toFunction,
        edge.payload,
        edge.effect,
        edge.source
      ]);
      const stepText = flow.steps.flatMap((step) => [
        step.id,
        step.title,
        step.code,
        step.call,
        step.source,
        ...step.inputs,
        ...step.outputs
      ]);
      const haystack = [flow.group, flow.title, flow.summary, flow.tags.join(' '), ...relationText, ...functionEdgeText, ...stepText]
        .join(' ')
        .toLowerCase();
      if (query && !haystack.includes(query)) return;
      if (!groups.has(flow.group)) groups.set(flow.group, []);
      groups.get(flow.group).push({ flow, index });
    });
    return [...groups.entries()].map(([group, items]) => ({ group, items }));
  }

  function selectFlowStep(flowId, stepId = '', options = {}) {
    const flow = flowById(flowId);
    if (!flow) return;
    stopTimer();
    selectedSymbolId = '';
    selectedFlowId = flow.id;
    selectedStepId = stepId && stepById(flow.id, stepId) ? stepId : flow.steps[0]?.id;
    pinEligibleStepKey = options.fromStepNode ? `${flow.id}::${selectedStepId}` : '';
    filter = '';
    sidebarOpen = false;
    updateUrlSelection();
  }

  function selectFlow(index) {
    const flow = FLOWS[Math.max(0, Math.min(FLOWS.length - 1, index))];
    if (flow) selectFlowStep(flow.id);
  }

  function setStepByIndex(index, options = {}) {
    const step = currentFlow.steps[Math.max(0, Math.min(currentFlow.steps.length - 1, index))];
    if (!step) return;
    selectedStepId = step.id;
    selectedSymbolId = '';
    pinEligibleStepKey = options.fromStepNode ? `${currentFlow.id}::${step.id}` : '';
    updateUrlSelection();
    if (playing) restartTimer();
  }

  function selectBoardStepNode(node) {
    if (node.role === 'current') {
      setStepByIndex(node.step.index, { fromStepNode: true });
    } else {
      selectFlowStep(node.flowId, node.stepId, { fromStepNode: true });
    }
  }

  function nextStep() {
    if (selectedStepIndex < currentFlow.steps.length - 1) {
      setStepByIndex(selectedStepIndex + 1);
      return;
    }
    if (loopAll) {
      const nextFlow = FLOWS[(flowIndexById(currentFlow.id) + 1) % FLOWS.length];
      selectFlowStep(nextFlow.id);
      if (playing) restartTimer();
    } else {
      pause();
    }
  }

  function prevStep() {
    if (selectedStepIndex > 0) {
      setStepByIndex(selectedStepIndex - 1);
      return;
    }
    if (!loopAll) return;
    const previousIndex = (flowIndexById(currentFlow.id) - 1 + FLOWS.length) % FLOWS.length;
    const previousFlow = FLOWS[previousIndex];
    selectFlowStep(previousFlow.id, previousFlow.steps.at(-1)?.id);
  }

  function play() {
    playing = true;
    startTimer();
  }

  function pause() {
    playing = false;
    stopTimer();
  }

  function togglePlay() {
    playing ? pause() : play();
  }

  function startTimer() {
    stopTimer();
    timer = window.setInterval(nextStep, speedMs);
  }

  function restartTimer() {
    if (playing) startTimer();
  }

  function stopTimer() {
    if (timer) window.clearInterval(timer);
    timer = null;
  }

  function selectSymbolById(symbolId) {
    const symbol = codebaseSymbolById(symbolId);
    if (!symbol) return;
    stopTimer();
    playing = false;
    selectedSymbolId = symbolId;
    sidebarOpen = false;
    focusSourceReference(sourceReferenceForSymbol(symbol), { updateUrl: true });
  }

  function loadStepRangePins() {
    try {
      const raw = window.localStorage.getItem(PIN_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      stepRangePins = normalizeStoredPins(parsed);
    } catch (error) {
      console.warn('[mindphase-learning] unable to load step range pins', error);
      stepRangePins = {};
    }
  }

  function persistStepRangePins(nextPins) {
    stepRangePins = nextPins;
    try {
      window.localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify({ version: 1, pins: nextPins }));
    } catch (error) {
      console.warn('[mindphase-learning] unable to persist step range pins', error);
    }
  }

  function normalizeStoredPins(value) {
    const source = value?.pins && typeof value.pins === 'object' ? value.pins : {};
    const next = {};
    for (const pin of Object.values(source)) {
      const normalized = normalizePinRecord(pin);
      if (!normalized) continue;
      next[pinIdForRange(normalized)] = normalized;
    }
    return next;
  }

  function normalizePinRecord(pin) {
    if (!pin || typeof pin !== 'object') return null;
    const flow = flowById(pin.flowId);
    const step = stepById(pin.flowId, pin.stepId);
    const repoPath = String(pin.repoPath || '');
    const startLine = Number(pin.startLine);
    const endLine = Number(pin.endLine);
    if (!flow || !step || !repoPath || !Number.isInteger(startLine) || !Number.isInteger(endLine)) return null;
    if (startLine < 1 || endLine < startLine) return null;
    return {
      flowId: flow.id,
      stepId: step.id,
      repoPath,
      startLine,
      endLine,
      symbolId: String(pin.symbolId || ''),
      title: String(pin.title || `${flow.title} / ${step.title}`),
      pinnedAt: typeof pin.pinnedAt === 'string' ? pin.pinnedAt : new Date().toISOString()
    };
  }

  function collectPinnableStepRanges() {
    if (!codebaseGraph?.files?.length) return [];
    return FLOWS.flatMap((flow) =>
      flow.steps
        .map((step) => pinnableRangeForStep(flow.id, step.id))
        .filter(Boolean)
    );
  }

  function pinnableRangeForStep(flowId, stepId) {
    const flow = flowById(flowId);
    const step = stepById(flowId, stepId);
    if (!flow || !step) return null;
    const ref = sourceReference(step);
    const file = codebaseFileByRepoPath(ref?.repoPath);
    if (!file) return null;
    const startLine = Math.max(1, Math.min(Number(ref.startLine) || 1, file.lineCount || 1));
    const endLine = Math.max(startLine, Math.min(Number(ref.endLine) || startLine, file.lineCount || startLine));
    return {
      flowId: flow.id,
      stepId: step.id,
      repoPath: file.repoPath,
      startLine,
      endLine,
      symbolId: ref.symbolId || '',
      title: `${flow.title} / ${step.title}`,
      pinnedAt: ''
    };
  }

  function pinIdForRange(range) {
    return `${range.flowId}::${range.stepId}::${range.repoPath}:${range.startLine}-${range.endLine}`;
  }

  function isKnownPinnableRange(pin) {
    return Boolean(pin && pinnableRanges.some((range) => pinIdForRange(range) === pinIdForRange(pin)));
  }

  function toggleCurrentRangePin() {
    if (!currentPinRange) return;
    const pinId = pinIdForRange(currentPinRange);
    const next = { ...stepRangePins };
    if (next[pinId]) {
      delete next[pinId];
    } else {
      next[pinId] = { ...currentPinRange, pinnedAt: new Date().toISOString() };
    }
    persistStepRangePins(next);
  }

  function unpinRange(pin) {
    const pinId = pinIdForRange(pin);
    if (!stepRangePins[pinId]) return;
    const next = { ...stepRangePins };
    delete next[pinId];
    persistStepRangePins(next);
  }

  function jumpToPin(pin) {
    selectFlowStep(pin.flowId, pin.stepId);
    focusSourceReference({ ...pin, exact: true }, { updateUrl: true });
    showPinList = false;
  }

  function coverageForTreeNode(node) {
    if (!node) return { status: 'none', label: 'No pinned step ranges' };
    if (node.kind === 'file') return coverageForFile(node.path);
    return coverageForDirectory(node);
  }

  function coverageForFile(repoPath) {
    const ranges = pinnableRanges.filter((range) => range.repoPath === repoPath);
    if (!ranges.length) return { status: 'none', label: 'No pinnable step ranges' };
    const pinned = ranges.filter((range) => stepRangePins[pinIdForRange(range)]);
    if (!pinned.length) return { status: 'none', label: `${ranges.length} pinnable ranges` };
    const file = codebaseFileByRepoPath(repoPath);
    const fullLineCoverage = Boolean(file?.lineCount && rangesCoverLineSpan(pinned, 1, file.lineCount));
    if (fullLineCoverage) return { status: 'full', label: `All ${file.lineCount} source lines covered by pins` };
    if (pinned.length === ranges.length) return { status: 'all', label: `All ${ranges.length} step ranges pinned` };
    return { status: 'partial', label: `${pinned.length} / ${ranges.length} step ranges pinned` };
  }

  function coverageForDirectory(node) {
    const filePaths = filePathsUnderTreeNode(node);
    const childCoverages = filePaths.map(coverageForFile).filter((coverage) => coverage.status !== 'none');
    if (!childCoverages.length) return { status: 'none', label: 'No pinned step ranges' };
    if (childCoverages.every((coverage) => coverage.status === 'full')) return { status: 'full', label: 'All child source lines covered by pins' };
    if (childCoverages.every((coverage) => coverage.status === 'all' || coverage.status === 'full')) return { status: 'all', label: 'All child step ranges pinned' };
    return { status: 'partial', label: 'Some child step ranges pinned' };
  }

  function filePathsUnderTreeNode(node) {
    if (!node) return [];
    if (node.kind === 'file') return [node.path];
    return (node.children || []).flatMap(filePathsUnderTreeNode);
  }

  function rangesCoverLineSpan(ranges, startLine, endLine) {
    const sorted = ranges
      .map((range) => ({ startLine: Number(range.startLine), endLine: Number(range.endLine) }))
      .filter((range) => Number.isInteger(range.startLine) && Number.isInteger(range.endLine))
      .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
    let coveredUntil = startLine - 1;
    for (const range of sorted) {
      if (range.startLine > coveredUntil + 1) return false;
      coveredUntil = Math.max(coveredUntil, range.endLine);
      if (coveredUntil >= endLine) return true;
    }
    return coveredUntil >= endLine;
  }

  function sourceLinePinInfo(lineNumber) {
    if (!selectedFile?.repoPath) return null;
    const pins = pinnedRanges.filter(
      (pin) => pin.repoPath === selectedFile.repoPath && pin.startLine <= lineNumber && lineNumber <= pin.endLine
    );
    if (!pins.length) return null;
    return {
      count: pins.length,
      title: pins.map((pin) => pin.title).join(', ')
    };
  }

  async function loadCodebaseGraph() {
    try {
      const response = await fetch(`${base}/generated/mindphase-codebase-graph.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      codebaseGraph = await response.json();
    } catch (error) {
      console.warn('[mindphase-learning] unable to load generated graph', error);
    }
  }

  function loadUrlSelection() {
    const params = new URLSearchParams(window.location.search);
    const flowId = params.get('flow');
    const stepId = params.get('step');
    const file = params.get('file');
    const line = Number(params.get('line') || 0);
    if (flowId && flowById(flowId)) {
      selectedFlowId = flowId;
      selectedStepId = stepId && stepById(flowId, stepId) ? stepId : flowById(flowId).steps[0]?.id;
    }
    if (file) {
      selectedFilePath = file;
      selectedRange = Number.isInteger(line) && line > 0 ? { repoPath: file, startLine: line, endLine: line } : null;
      expandDirsForFile(file);
    }
  }

  function updateUrlSelection() {
    const url = new URL(window.location.href);
    url.searchParams.set('flow', selectedFlowId);
    if (selectedStepId) url.searchParams.set('step', selectedStepId);
    if (selectedFilePath) url.searchParams.set('file', selectedFilePath);
    if (selectedRange?.startLine) url.searchParams.set('line', String(selectedRange.startLine));
    window.history.replaceState({}, '', url);
  }

  function handleKeydown(event) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.code === 'Space') {
      event.preventDefault();
      togglePlay();
    } else if (event.key === 'ArrowRight') {
      nextStep();
      restartTimer();
    } else if (event.key === 'ArrowLeft') {
      prevStep();
      restartTimer();
    } else if (event.key === 'Home') {
      setStepByIndex(0);
    } else if (event.key === 'End') {
      setStepByIndex(currentFlow.steps.length - 1);
    }
  }

  async function scheduleDrawEdges() {
    await tick();
    requestAnimationFrame(drawEdges);
  }

  function drawEdges() {
    if (!diagramWrap || !edgeLayer) return;
    const wrapRect = diagramWrap.getBoundingClientRect();
    const defs = `
      <defs>
        <linearGradient id="activeGradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#7f8cff" />
          <stop offset="100%" stop-color="#4bd6c8" />
        </linearGradient>
      </defs>`;
    const paths = boardProjection.edges.map((edge) => {
      const sequence = edge.kind === 'sequence';
      const incoming = !sequence && edge.toFlow === currentFlow.id;
      const fromKey = sequence
        ? boardNodeKey('current', edge.fromFlow, edge.fromStep)
        : incoming
          ? boardNodeKey('incoming', edge.fromFlow, edge.fromStep)
          : boardNodeKey('current', edge.fromFlow, edge.fromStep);
      const toKey = sequence
        ? boardNodeKey('current', edge.toFlow, edge.toStep)
        : incoming
          ? boardNodeKey('current', edge.toFlow, edge.toStep)
          : boardNodeKey('outgoing', edge.toFlow, edge.toStep);
      const fromNode = diagramWrap.querySelector(`[data-node-key="${CSS.escape(fromKey)}"]`);
      const toNode = diagramWrap.querySelector(`[data-node-key="${CSS.escape(toKey)}"]`);
      if (!fromNode || !toNode) return '';
      const startRect = fromNode.getBoundingClientRect();
      const endRect = toNode.getBoundingClientRect();
      const start = { x: startRect.right - wrapRect.left, y: startRect.top + startRect.height / 2 - wrapRect.top };
      const end = { x: endRect.left - wrapRect.left, y: endRect.top + endRect.height / 2 - wrapRect.top };
      const sameRow = Math.abs(start.y - end.y) < 8;
      const trunkX = start.x + (end.x - start.x) * 0.5;
      const d = sameRow
        ? `M ${start.x} ${start.y} L ${end.x} ${end.y}`
        : `M ${start.x} ${start.y} C ${trunkX} ${start.y}, ${trunkX} ${end.y}, ${end.x} ${end.y}`;
      const direction = sequence ? 'sequence' : incoming ? 'incoming' : 'outgoing';
      const active = edge.fromStep === currentStep?.id || edge.toStep === currentStep?.id ? ' active' : '';
      const edgeClass = sequence ? 'step-edge sequence-edge' : `cross-edge ${direction}`;
      return `<path class="edge ${edgeClass}${active}" data-edge-id="${escapeHtml(edge.id)}" d="${d}" />`;
    }).join('');
    edgeLayer.innerHTML = defs + paths;
  }

  function codebaseSymbolById(symbolId) {
    return codebaseGraph?.symbols?.find((symbol) => symbol.id === symbolId) ?? null;
  }

  function codebaseFileById(fileId) {
    return codebaseGraph?.files?.find((file) => file.id === fileId) ?? null;
  }

  function codebaseFileByRepoPath(repoPath) {
    return codebaseGraph?.files?.find((file) => file.repoPath === repoPath) ?? null;
  }

  function graphSymbolsForStep(step) {
    if (!codebaseGraph?.symbols?.length || !step) return [];
    const tokens = callReferenceTokens(step);
    return codebaseGraph.symbols
      .filter((symbol) => symbol.repoPath === step.source)
      .map((symbol) => ({ symbol, score: stepSymbolScore(symbol, tokens) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || (a.symbol.range?.startLine ?? 0) - (b.symbol.range?.startLine ?? 0))
      .slice(0, 4)
      .map((result) => result.symbol);
  }

  function sourceReference(step) {
    const symbol = graphSymbolsForStep(step)[0];
    const file = codebaseFileByRepoPath(step?.source ?? '');
    return {
      label: step?.source ?? '',
      repoPath: symbol?.repoPath ?? file?.repoPath ?? step?.source ?? '',
      startLine: symbol?.range?.startLine ?? 1,
      endLine: symbol?.range?.endLine ?? symbol?.range?.startLine ?? 1,
      exact: Boolean(symbol),
      symbolId: symbol?.id ?? ''
    };
  }

  function sourceReferenceForSymbol(symbol) {
    const file = codebaseFileById(symbol?.fileId);
    return {
      label: symbolLocationLabel(symbol),
      repoPath: file?.repoPath || symbol?.repoPath || '',
      startLine: symbol?.range?.startLine ?? 1,
      endLine: symbol?.range?.endLine ?? symbol?.range?.startLine ?? 1,
      exact: Boolean(symbol?.range),
      symbolId: symbol?.id ?? ''
    };
  }

  function focusSourceReference(ref, options = {}) {
    if (!ref?.repoPath) return;
    if (!codebaseFileByRepoPath(ref.repoPath)) return;
    selectedFilePath = ref.repoPath;
    selectedRange = {
      repoPath: ref.repoPath,
      startLine: Math.max(1, ref.startLine || 1),
      endLine: Math.max(ref.startLine || 1, ref.endLine || ref.startLine || 1),
      exact: ref.exact,
      symbolId: ref.symbolId || ''
    };
    expandDirsForFile(ref.repoPath);
    if (options.updateUrl) updateUrlSelection();
  }

  function selectFile(repoPath) {
    const file = codebaseFileByRepoPath(repoPath);
    if (!file) return;
    selectedFilePath = file.repoPath;
    selectedRange = null;
    expandDirsForFile(file.repoPath);
    updateUrlSelection();
  }

  function toggleTreeDir(path) {
    const next = new Set(expandedTreeDirs);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    expandedTreeDirs = next;
  }

  function expandDirsForFile(repoPath) {
    const segments = String(repoPath || '').split('/');
    const next = new Set(expandedTreeDirs);
    let current = '';
    for (let index = 0; index < segments.length - 1; index += 1) {
      current = current ? `${current}/${segments[index]}` : segments[index];
      next.add(current);
    }
    expandedTreeDirs = next;
  }

  function visibleFileTreeRows(root) {
    if (!root?.children) return [];
    const rows = [];
    function visit(node, depth) {
      if (node.kind !== 'directory') {
        rows.push({ node, depth, expanded: false });
        return;
      }
      if (node.path) rows.push({ node, depth, expanded: expandedTreeDirs.has(node.path) });
      if (!node.path || expandedTreeDirs.has(node.path)) {
        for (const child of node.children || []) visit(child, node.path ? depth + 1 : depth);
      }
    }
    visit(root, 0);
    return rows;
  }

  async function scrollActiveSourceLine() {
    await tick();
    if (!codeScroller || !selectedRange?.startLine) return;
    const line = codeScroller.querySelector(`[data-code-line="${selectedRange.startLine}"]`);
    line?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }

  function sourceLineInRange(lineNumber) {
    return Boolean(
      selectedRange &&
      selectedRange.repoPath === selectedFile?.repoPath &&
      selectedRange.startLine <= lineNumber &&
      lineNumber <= selectedRange.endLine
    );
  }

  function callReferenceTokens(step) {
    const text = String(step?.call || step?.code || '');
    const identifiers = [...text.matchAll(/[A-Za-z_$][\w$]*/g)].map((match) => match[0]);
    const qualified = [...text.matchAll(/[A-Za-z_$][\w$]*(?:(?:\.|::)[A-Za-z_$][\w$]*)+/g)]
      .map((match) => match[0]);
    const last = qualified.length
      ? qualified.at(-1).split(/\.|::/).at(-1)
      : identifiers.at(-1);
    return {
      identifiers,
      identifierSet: new Set(identifiers),
      qualified,
      qualifiedSet: new Set(qualified),
      last
    };
  }

  function stepSymbolScore(symbol, tokens) {
    if (symbol.kind === 'module') return 0;
    if (!tokens.identifiers.length && !tokens.qualified.length) return 0;
    if (symbol.qualifiedName && tokens.qualifiedSet.has(symbol.qualifiedName)) return 160;
    if (symbol.qualifiedName && tokens.qualifiedSet.has(symbol.qualifiedName.replace(/::/g, '.'))) return 155;
    if (tokens.last && symbol.name === tokens.last) return 140;
    if (tokens.identifierSet.has(symbol.name)) return 120;
    if (symbol.containerName && tokens.identifierSet.has(symbol.containerName)) return 80;
    if (tokens.identifiers.some((token) => String(symbol.signature || '').includes(token))) return 35;
    return symbol.kind === 'module' ? 1 : 0;
  }

  function symbolLocationLabel(symbol) {
    const file = codebaseFileById(symbol.fileId);
    const repoPath = file?.repoPath || symbol.repoPath || '';
    const line = symbol.range?.startLine ? `:${symbol.range.startLine}` : '';
    return `${repoPath}${line}`;
  }

  function codebaseEdgesForSymbol(symbolId) {
    if (!codebaseGraph?.edges?.length) return { incoming: [], outgoing: [] };
    return {
      incoming: codebaseGraph.edges.filter((edge) => edge.to === symbolId && edge.from !== symbolId).slice(0, 8),
      outgoing: codebaseGraph.edges.filter((edge) => edge.from === symbolId && edge.to && edge.to !== symbolId).slice(0, 8)
    };
  }

  function symbolSearchResults(queryText) {
    const query = queryText.trim().toLowerCase();
    if (!query || query.length < 2 || !codebaseGraph?.symbols?.length) return [];
    return codebaseGraph.symbols
      .map((symbol) => ({ symbol, score: symbolSearchScore(symbol, query) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || a.symbol.name.localeCompare(b.symbol.name))
      .slice(0, 8)
      .map((result) => result.symbol);
  }

  function symbolSearchScore(symbol, query) {
    const name = String(symbol.name || '').toLowerCase();
    const signature = String(symbol.signature || '').toLowerCase();
    const location = symbolLocationLabel(symbol).toLowerCase();
    if (name === query) return 100;
    if (name.startsWith(query)) return 80;
    if (name.includes(query)) return 60;
    if (signature.includes(query)) return 35;
    if (location.includes(query)) return 20;
    return 0;
  }

  function analyzerMetaChips() {
    if (!codebaseGraph?.metadata) return [];
    const { metadata, stats } = codebaseGraph;
    return [
      metadata.commitSha ? `Commit ${String(metadata.commitSha).slice(0, 8)}` : '',
      stats?.symbols ? `${stats.symbols} symbols` : '',
      stats?.edges ? `${stats.edges} code edges` : ''
    ].filter(Boolean);
  }

  function edgeTarget(edge, direction) {
    return {
      flowId: direction === 'incoming' ? edge.fromFlow : edge.toFlow,
      stepId: direction === 'incoming' ? edge.fromStep : edge.toStep
    };
  }

  function relationTarget(relation, direction) {
    return direction === 'incoming' ? relation.fromFlow : relation.toFlow;
  }

  function sourceRefForEdge(edge, direction) {
    const target = edgeTarget(edge, direction);
    return sourceReference(stepById(target.flowId, target.stepId) || {});
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
</script>

<svelte:head>
  <title>MindPhase Business Logic Lifecycle Visualizer</title>
  <meta
    name="description"
    content="Interactive Svelte 5 map for MindPhase business logic execution flows and code relationships."
  />
</svelte:head>

<div class="app-shell">
  <aside class:open={sidebarOpen} class="sidebar" aria-label="Business flow selection">
    <div class="brand">
      <div class="brand-row">
        <div class="brand-mark">MP</div>
        <div>
          <h1>MindPhase Lifecycle</h1>
          <p>Interactive map for business logic execution flows.</p>
        </div>
      </div>
      <div class="relation-toolbar">
        <div>
          <strong>Flow Links</strong>
          <span>Show direct links for the selected flow</span>
        </div>
        <button
          class:active={showFlowRelations}
          class="relation-toggle"
          type="button"
          onclick={() => (showFlowRelations = !showFlowRelations)}
        >
          {showFlowRelations ? 'ON' : 'OFF'}
        </button>
      </div>
      <div class="relation-legend" aria-label="Flow relation types">
        <span><i class="relation-swatch call"></i>Call</span>
        <span><i class="relation-swatch event"></i>Event</span>
        <span><i class="relation-swatch sync"></i>Sync</span>
        <span><i class="relation-swatch cleanup"></i>Cleanup</span>
      </div>
    </div>

    <div class="search-wrap">
      <input bind:value={filter} type="search" placeholder="Search flows, commands, files" autocomplete="off" />
    </div>

    <div class="flow-list">
      {#if symbolResults.length}
        <section class="symbol-search-section">
          <div class="symbol-search-title">
            <span>Code Symbols</span>
            <span>{symbolResults.length}</span>
          </div>
          {#each symbolResults as symbol (symbol.id)}
            <button class="symbol-search-item" type="button" onclick={() => selectSymbolById(symbol.id)}>
              <strong>{symbol.name}</strong>
              <span>{symbol.kind} / {symbol.language}</span>
              <code>{symbolLocationLabel(symbol)}</code>
            </button>
          {/each}
        </section>
      {/if}

      {#if !filteredGroups.length && !symbolResults.length}
        <div class="empty-state">No matching flows.</div>
      {:else}
        {#each filteredGroups as groupBlock (groupBlock.group)}
          <section class:active-group={groupBlock.group === currentFlow.group} class="group-block" data-group={groupBlock.group}>
            <div class="group-title">
              <span class="group-title-main">
                <span>{groupBlock.group}</span>
                <span class="group-count">{groupBlock.items.length}</span>
              </span>
            </div>
            {#each groupBlock.items as item (item.flow.id)}
              <button
                class:active={item.flow.id === currentFlow.id}
                class="flow-item"
                type="button"
                onclick={() => selectFlow(item.index)}
              >
                <span class="flow-index">{String(item.index + 1).padStart(2, '0')}</span>
                <span class="flow-name">{item.flow.title}</span>
                <span class="flow-meta">
                  <span class="flow-relation-count">{relationsForFlow(item.flow.id).length ? `x${relationsForFlow(item.flow.id).length}` : ''}</span>
                  <span class="flow-step-count">{item.flow.steps.length}</span>
                </span>
              </button>
            {/each}
          </section>
        {/each}
      {/if}
    </div>
  </aside>

  <main class="app-main">
    <header class="topbar">
      <div class="breadcrumb">
        <button class="control-button mobile-menu-button" type="button" aria-label="Open flow list" onclick={() => (sidebarOpen = true)}>
          Menu
        </button>
        <span>{selectedSymbol ? 'Code Symbol' : currentFlow.group}</span>
        <span>/</span>
        <strong>{selectedSymbol ? selectedSymbol.name : currentFlow.title}</strong>
      </div>
      <div class="controls" aria-label="Animation controls">
        <button class="control-button" title="Previous step" type="button" onclick={() => { prevStep(); restartTimer(); }}>
          <span class="label">Prev</span>
        </button>
        <button class="control-button primary" title="Play or pause" type="button" onclick={togglePlay}>
          <span class="label">{playing ? 'Pause' : 'Play'}</span>
        </button>
        <button class="control-button" title="Next step" type="button" onclick={() => { nextStep(); restartTimer(); }}>
          <span class="label">Next</span>
        </button>
        <select class="select-control" bind:value={speedMs} title="Playback speed" onchange={restartTimer}>
          <option value={2200}>0.6x</option>
          <option value={1500}>1x</option>
          <option value={900}>1.6x</option>
          <option value={520}>2.6x</option>
        </select>
        <label class="toggle-control" title="Move to next flow after the final step">
          <input bind:checked={loopAll} type="checkbox" />
          <span>Loop all</span>
        </label>
      </div>
    </header>

    <section class="hero">
      <article class="hero-card">
        <div class="eyebrow">{selectedSymbol ? selectedSymbol.kind : currentFlow.group}</div>
        <h2>{selectedSymbol ? selectedSymbol.name : currentFlow.title}</h2>
        <p class="hero-summary">
          {selectedSymbol ? selectedSymbol.signature : currentFlow.summary}
        </p>
        <div class="hero-meta">
          {#if selectedSymbol}
            <span class="meta-chip">{selectedSymbol.language}</span>
            <span class="meta-chip">{symbolLocationLabel(selectedSymbol)}</span>
          {:else}
            <span class="meta-chip">Trigger - {currentFlow.trigger}</span>
            <span class="meta-chip">Result - {currentFlow.result}</span>
            <span class="meta-chip">{currentFlow.steps.length} steps</span>
            {#if currentRelations.length}
              <span class="meta-chip">Flow links - {currentRelations.length}</span>
            {/if}
            {#each currentFlow.tags.slice(0, 3) as tag}
              <span class="meta-chip">{tag}</span>
            {/each}
            {#each analyzerChips as chip}
              <span class="meta-chip">{chip}</span>
            {/each}
          {/if}
        </div>
      </article>
      <article class="status-card" aria-live="polite">
        <div>
          <div class="status-label">{selectedSymbol ? 'Selected Symbol' : 'Current Step'}</div>
          <div class="current-step-title">{selectedSymbol ? selectedSymbol.name : currentStep.title}</div>
          <div class="current-step-desc">{selectedSymbol ? symbolLocationLabel(selectedSymbol) : currentStep.desc}</div>
        </div>
        <div class="progress-shell">
          <div class="progress-meta">
            <span>{selectedStepIndex + 1} / {currentFlow.steps.length}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div class="progress-track"><div class="progress-bar" style:width={`${progress}%`}></div></div>
        </div>
      </article>
    </section>

    <section class="content-grid">
      <section class="primary-stack">
        <article class="flow-board">
        <div class="board-head">
          <div>
            <h3>Call Relationship Animation</h3>
            <p>Shows ownership lanes, handoffs, and execution order across the selected workflow.</p>
          </div>
          <div class="legend" aria-label="Step state legend">
            <span class="legend-item"><i class="legend-dot done"></i>Done</span>
            <span class="legend-item"><i class="legend-dot active"></i>Active</span>
            <span class="legend-item"><i class="legend-dot pending"></i>Pending</span>
            <span class="legend-item direction-legend">{@render DirectionIcon('incoming')}<span>Incoming</span></span>
            <span class="legend-item direction-legend">{@render DirectionIcon('outgoing')}<span>Outgoing</span></span>
          </div>
        </div>

        {#if showFlowRelations && !selectedSymbol}
          <div class="flow-relation-map" aria-live="polite">
            <div class="flow-relation-layout">
              <section class="flow-relation-column">
                <div class="flow-relation-column-head">
                  <strong>Incoming links</strong>
                  <span class="flow-relation-badge">{incomingRelations.length}</span>
                </div>
                <div class="flow-link-stack">
                  {#if incomingRelations.length}
                    {#each incomingRelations as relation (relation.id)}
                      {@const kind = relationKind(relation)}
                      {@const targetFlowId = relationTarget(relation, 'incoming')}
                      <button class="flow-link-card" type="button" style={`--relation-color:${kind.color}`} onclick={() => selectFlowStep(targetFlowId)}>
                        <span class="flow-link-role" title="Incoming link" aria-label="Incoming link">{@render DirectionIcon('incoming')}</span>
                        {#if targetFlowId !== currentFlow.id}
                          <span class="flow-link-target">{@render FlowReference(targetFlowId, 'small')}</span>
                        {/if}
                        <span class="flow-link-meta"><span>{relation.from} -&gt; {relation.to}</span><span class="flow-link-kind">{kind.label}</span></span>
                        <code class="flow-link-via">via {relation.via}</code>
                        <span class="flow-link-copy">{relation.description}</span>
                      </button>
                    {/each}
                  {:else}
                    <div class="flow-link-empty">No direct links enter this flow.</div>
                  {/if}
                </div>
                {@render FunctionEdgeList(functionIncoming, 'incoming', selectFlowStep)}
              </section>

              <article class="flow-current-card">
                <div class="flow-current-label">Current flow</div>
                <div class="flow-current-title">{currentFlow.title}</div>
                <div class="flow-current-group">{currentFlow.group}</div>
                <div class="flow-current-stats">
                  <span>In {incomingRelations.length}</span>
                  <span>Out {outgoingRelations.length}</span>
                  <span>Total {currentRelations.length}</span>
                  <span>Fn in {functionIncoming.length}</span>
                  <span>Fn out {functionOutgoing.length}</span>
                </div>
              </article>

              <section class="flow-relation-column">
                <div class="flow-relation-column-head">
                  <strong>Outgoing links</strong>
                  <span class="flow-relation-badge">{outgoingRelations.length}</span>
                </div>
                <div class="flow-link-stack">
                  {#if outgoingRelations.length}
                    {#each outgoingRelations as relation (relation.id)}
                      {@const kind = relationKind(relation)}
                      {@const targetFlowId = relationTarget(relation, 'outgoing')}
                      <button class="flow-link-card" type="button" style={`--relation-color:${kind.color}`} onclick={() => selectFlowStep(targetFlowId)}>
                        <span class="flow-link-role" title="Outgoing link" aria-label="Outgoing link">{@render DirectionIcon('outgoing')}</span>
                        {#if targetFlowId !== currentFlow.id}
                          <span class="flow-link-target">{@render FlowReference(targetFlowId, 'small')}</span>
                        {/if}
                        <span class="flow-link-meta"><span>{relation.from} -&gt; {relation.to}</span><span class="flow-link-kind">{kind.label}</span></span>
                        <code class="flow-link-via">via {relation.via}</code>
                        <span class="flow-link-copy">{relation.description}</span>
                      </button>
                    {/each}
                  {:else}
                    <div class="flow-link-empty">No direct links leave this flow.</div>
                  {/if}
                </div>
                {@render FunctionEdgeList(functionOutgoing, 'outgoing', selectFlowStep)}
              </section>
            </div>
          </div>
        {/if}

        <div class="board-scroll flow-layout">
          <div class="lane-heads">
            {#each LANES as lane}
              <div class="lane-head">
                <strong>{lane.label}</strong>
                <span>{lane.sub}</span>
              </div>
            {/each}
          </div>
          <div class="diagram-wrap" bind:this={diagramWrap}>
            <svg class="edge-layer" bind:this={edgeLayer} aria-hidden="true"></svg>
            <div
              class="diagram-grid"
              style:grid-template-columns={`repeat(${boardProjection.columnCount}, max-content)`}
              style:grid-template-rows={`repeat(${boardProjection.rowCount}, var(--board-row-height))`}
            >
              {#each boardProjection.nodes as node (node.key)}
                <button
                  class:context-node={node.role !== 'current'}
                  class:incoming-node={node.role === 'incoming'}
                  class:outgoing-node={node.role === 'outgoing'}
                  class:current-node={node.role === 'current'}
                  class:done={node.role === 'current' && node.step.index < selectedStepIndex}
                  class:active={node.role === 'current' && node.step.id === currentStep.id}
                  class:pending={node.role === 'current' && node.step.index > selectedStepIndex}
                  class="step-node"
                  type="button"
                  data-node-key={node.key}
                  style={`grid-column:${node.column};grid-row:${node.row}`}
                  onclick={() => selectBoardStepNode(node)}
                >
                  <div class="node-topline">
                    <span class="node-seq" title={node.role === 'current' ? 'Current flow step' : `${directionLabel(node.role)} context step`} aria-label={node.role === 'current' ? 'Current flow step' : `${directionLabel(node.role)} context step`}>
                      {#if node.role === 'current'}
                        {stepNumberLabel(node.flowId, node.stepId)}
                      {:else}
                        {@render DirectionIcon(node.role)}
                      {/if}
                    </span>
                    {@render FlowStepReference(node.flowId, node.stepId, 'compact', node.role === 'current' ? 'step-title' : 'full')}
                  </div>
                  <code class="node-code">{node.step.code}</code>
                </button>
              {/each}
            </div>
          </div>
        </div>
        </article>

        <article class="code-browser">
          <div class="panel-head">
            <div>
              <h3>Codebase Source</h3>
              <p>Static source snapshot with file tree, full-file view, and selected line range focus.</p>
            </div>
            <div class="source-head-actions">
              <span class="pin-count-badge" title="Registered pins / total pinnable step ranges">
                {pinSummary.pinned} / {pinSummary.total}
              </span>
              {#if !selectedSymbol}
                <button
                  class:active={isCurrentRangePinned}
                  class="pin-toggle"
                  disabled={!currentPinRange}
                  title={isCurrentRangePinned ? 'Unpin selected step range' : 'Pin selected step range'}
                  type="button"
                  onclick={toggleCurrentRangePin}
                >
                  <span>{isCurrentRangePinned ? 'Unpin' : 'Pin'}</span>
                </button>
              {/if}
              <button
                class:active={showPinList}
                class="pin-toggle"
                title="Show registered pins"
                type="button"
                onclick={() => (showPinList = !showPinList)}
              >
                {showPinList ? 'Hide pins' : 'Show pins'}
              </button>
              {#if selectedRange?.exact}
                <span class="range-badge">L{selectedRange.startLine}-L{selectedRange.endLine}</span>
              {:else if selectedRange}
                <span class="range-badge muted">File fallback</span>
              {/if}
            </div>
          </div>
          <div class="code-browser-layout">
            <div class="file-tree" aria-label="Codebase file tree">
              {#if fileTreeRows.length}
                {#each fileTreeRows as row (row.node.id)}
                  {@const coverage = coverageForTreeNode(row.node)}
                  <button
                    class:active={row.node.kind === 'file' && row.node.path === selectedFile?.repoPath}
                    class:directory={row.node.kind === 'directory'}
                    class:file={row.node.kind === 'file'}
                    class:pinned-partial={coverage.status === 'partial'}
                    class:pinned-all={coverage.status === 'all'}
                    class:pinned-full={coverage.status === 'full'}
                    class="file-tree-row"
                    style={`--depth:${row.depth}`}
                    title={coverage.label}
                    type="button"
                    onclick={() => row.node.kind === 'directory' ? toggleTreeDir(row.node.path) : selectFile(row.node.path)}
                  >
                    <span class="tree-icon">{row.node.kind === 'directory' ? (row.expanded ? '-' : '+') : '·'}</span>
                    <span class="tree-name">{row.node.name}</span>
                    {#if coverage.status !== 'none'}
                      <span class="tree-pin-status" aria-label={coverage.label}>✓</span>
                    {/if}
                    {#if row.node.kind === 'file'}
                      <span class="tree-meta">{row.node.lineCount}</span>
                    {/if}
                  </button>
                {/each}
              {:else}
                <div class="empty-state">Source snapshot is loading.</div>
              {/if}
            </div>
            <div class="source-viewer">
              <div class="source-toolbar">
                <code>{selectedFile?.repoPath || 'No file selected'}</code>
                <span>{selectedFile?.language || ''}{selectedFile ? ` / ${selectedFile.lineCount} lines` : ''}</span>
              </div>
              <div class="source-code" bind:this={codeScroller}>
                {#each selectedFileLines as line, index (index)}
                  {@const pinInfo = sourceLinePinInfo(index + 1)}
                  <div
                    class:active-line={sourceLineInRange(index + 1)}
                    class:pinned-line={Boolean(pinInfo)}
                    class="source-line"
                    data-code-line={index + 1}
                    title={pinInfo ? `Pinned by ${pinInfo.title}` : undefined}
                  >
                    <span class="line-number">{index + 1}</span>
                    <code>{line || ' '}</code>
                  </div>
                {/each}
              </div>
            </div>
          </div>
        </article>
        {#if showPinList}
          <article class="pin-list-panel" aria-label="Registered source range pins">
            <div class="panel-head">
              <div>
                <h3>Registered Pins</h3>
                <p>Pinned step ranges can be inspected, jumped to, or unpinned here.</p>
              </div>
              <span class="pin-count-badge">{pinSummary.pinned} / {pinSummary.total}</span>
            </div>
            <div class="pin-list">
              {#each pinList as pin (pinIdForRange(pin))}
                <div class="pin-list-row">
                  <button class="pin-jump" type="button" onclick={() => jumpToPin(pin)}>
                    <strong>{pin.title}</strong>
                    <code>{pin.repoPath}:L{pin.startLine}-L{pin.endLine}</code>
                  </button>
                  <button class="pin-remove" title="Unpin this range" type="button" onclick={() => unpinRange(pin)}>
                    Unpin
                  </button>
                </div>
              {:else}
                <div class="empty-state">No registered pins.</div>
              {/each}
            </div>
          </article>
        {/if}
      </section>

      <aside class="side-stack">
        <article class="detail-panel">
          <div class="panel-head">
            <div>
              <h3>{selectedSymbol ? 'Symbol Detail' : 'Active Step Detail'}</h3>
              <p>Role, call site, source path, and function I/O for the selected step.</p>
            </div>
          </div>
          <div class="detail-body">
            {#if selectedSymbol}
              {@const symbolEdges = codebaseEdgesForSymbol(selectedSymbol.id)}
              <div class="detail-section">
                <div class="detail-kicker">Kind</div>
                <div class="detail-value">{selectedSymbol.kind}: {selectedSymbol.signature}</div>
              </div>
              <div class="detail-section">
                <div class="detail-kicker">Source Path</div>
                <code class="source-path">{symbolLocationLabel(selectedSymbol)}</code>
              </div>
              <div class="detail-section">
                <div class="detail-kicker">Incoming Edges</div>
                <div class="detail-chip-list">
                  {#each symbolEdges.incoming.map((edge) => edge.label || edge.kind) as label}
                    <span class="detail-chip">{label}</span>
                  {/each}
                </div>
              </div>
              <div class="detail-section">
                <div class="detail-kicker">Outgoing Edges</div>
                <div class="detail-chip-list">
                  {#each symbolEdges.outgoing.map((edge) => edge.label || edge.kind) as label}
                    <span class="detail-chip">{label}</span>
                  {/each}
                </div>
              </div>
            {:else}
              <div class="detail-section">
                <div class="detail-kicker">Role</div>
                <div class="detail-value">{currentLane.label}: {currentStep.desc}</div>
              </div>
              <div class="detail-section">
                <div class="detail-kicker">Call / Event</div>
                <code class="inline-code">{currentStep.call}</code>
              </div>
              <div class="detail-section">
                <div class="detail-kicker">Source Path</div>
                <code class="source-path">{currentSourceRef.label}:L{currentSourceRef.startLine}-L{currentSourceRef.endLine}</code>
              </div>
              <div class="detail-section">
                <div class="detail-kicker">Function Inputs</div>
                <div class="detail-chip-list">
                  {#each normalizeList(currentStep.inputs) as value}
                    <span class="detail-chip">{value}</span>
                  {/each}
                </div>
              </div>
              <div class="detail-section">
                <div class="detail-kicker">Function Outputs</div>
                <div class="detail-chip-list">
                  {#each normalizeList(currentStep.outputs) as value}
                    <span class="detail-chip">{value}</span>
                  {/each}
                </div>
              </div>
              <div class="detail-section">
                <div class="detail-kicker">Function Edges</div>
                <div class="detail-edge-list">
                  {#each [...stepFunctionDetails.incoming.map((edge) => ({ edge, direction: 'incoming' })), ...stepFunctionDetails.outgoing.map((edge) => ({ edge, direction: 'outgoing' }))] as item (item.edge.id + item.direction)}
                    {@const target = edgeTarget(item.edge, item.direction)}
                    {@const ref = sourceRefForEdge(item.edge, item.direction)}
                    <button class="detail-edge-card" type="button" aria-label={`${directionLabel(item.direction)} function edge`} onclick={() => selectFlowStep(target.flowId, target.stepId)}>
                      <span class="detail-edge-head">
                        {@render DirectionIcon(item.direction)}
                        <code class="inline-code">{item.edge.fromFunction}</code>
                        <span class="code-arrow">-&gt;</span>
                        <code class="inline-code">{item.edge.toFunction}</code>
                      </span>
                      <span class="detail-code-row">
                        <code class="inline-code">{item.edge.payload}</code>
                        <span class="flow-step-separator">/</span>
                        <code class="inline-code">{item.edge.effect}</code>
                      </span>
                      {@render FlowStepReference(target.flowId, target.stepId, 'detail', stepReferenceMode(target.flowId))}
                      <span>{ref.label}</span>
                    </button>
                  {:else}
                    <span class="detail-chip">No function edges.</span>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        </article>

        <article class="log-panel">
          <div class="panel-head">
            <div>
              <h3>Execution Log</h3>
              <p>Click any log row to jump to that step.</p>
            </div>
            <button class="control-button" title="Return to first step" type="button" onclick={() => setStepByIndex(0)}>Reset</button>
          </div>
          <div class="log-body" bind:this={logBody}>
            {#each currentFlow.steps as item, index (item.id)}
              <button class:current={index === selectedStepIndex} class="log-entry" type="button" onclick={() => setStepByIndex(index)}>
                <span class="log-time">T+{String(index * 120).padStart(4, '0')}</span>
                <span class="log-lane">{item.lane.toUpperCase()}</span>
                <span>{item.call} -&gt; {item.result}</span>
              </button>
            {/each}
          </div>
        </article>
      </aside>
    </section>

    <footer class="footer-note">
      <span>Keyboard: Space play/pause, arrows move step, Home first, End last.</span>
      <span>Svelte 5 static site with flow links and clickable execution log.</span>
    </footer>
  </main>
</div>

{#snippet DirectionIcon(direction)}
  <svg class:incoming={direction === 'incoming'} class:outgoing={direction === 'outgoing'} class="direction-icon" viewBox="0 0 24 24" aria-hidden="true">
    {#if direction === 'incoming'}
      <path d="M20 7h-8a6 6 0 0 0-6 6v5" />
      <path d="m10 14-4 4-4-4" />
    {:else}
      <path d="M4 17h8a6 6 0 0 0 6-6V6" />
      <path d="m14 10 4-4 4 4" />
    {/if}
  </svg>
{/snippet}

{#snippet FlowReference(flowId, variant)}
  {@const flow = flowById(flowId)}
  {#if flow}
    <span class:compact={variant === 'compact'} class:detail={variant === 'detail'} class:small={variant === 'small'} class="flow-step-ref flowOnly">
      <span class="flow-step-segment flow-segment">
        <span class="flow-step-number">{flowNumberLabel(flowId)}</span>
        <span>{flow.title}</span>
      </span>
    </span>
  {:else}
    <span class="flow-step-ref missing">{flowId}</span>
  {/if}
{/snippet}

{#snippet FlowStepReference(flowId, stepId, variant, mode)}
  {@const flow = flowById(flowId)}
  {@const step = stepById(flowId, stepId)}
  {@const showFlow = mode === 'full' || mode === 'flow-only'}
  {@const showStep = mode !== 'flow-only'}
  {@const showStepNumber = mode !== 'step-title'}
  {#if flow && (showStep ? step : true)}
    <span class:compact={variant === 'compact'} class:detail={variant === 'detail'} class:small={variant === 'small'} class:flowOnly={!showStep} class:stepOnly={!showFlow} class="flow-step-ref">
      {#if showFlow}
        <span class="flow-step-segment flow-segment">
          <span class="flow-step-number">{flowNumberLabel(flowId)}</span>
          <span>{flow.title}</span>
        </span>
      {/if}
      {#if showStep && step}
        <span class="flow-step-segment step-segment">
          {#if showStepNumber}
            <span class="flow-step-number">{stepNumberLabel(flowId, stepId)}</span>
          {/if}
          <span>{step.title}</span>
        </span>
      {/if}
    </span>
  {:else}
    <span class="flow-step-ref missing">{showStep ? stepLabel(flowId, stepId) : flowId}</span>
  {/if}
{/snippet}

{#snippet FunctionEdgeList(edges, direction, onselect)}
  <div class="function-edge-section">
    <div class="function-edge-title" aria-label={`Function ${directionLabel(direction).toLowerCase()} links`}>
      <span class="function-edge-heading">
        {@render DirectionIcon(direction)}
        <span>Function</span>
      </span>
      <span class="flow-relation-badge">{edges.length}</span>
    </div>
    <div class="function-edge-list">
      {#if edges.length}
        {#each edges as edge (edge.id)}
          {@const target = edgeTarget(edge, direction)}
          <button class="function-edge-card" type="button" aria-label={`${directionLabel(direction)} function edge`} onclick={() => onselect(target.flowId, target.stepId)}>
            <span class="function-edge-route">
              <code class="inline-code">{edge.fromFunction}</code>
              <span class="code-arrow">-&gt;</span>
              <code class="inline-code">{edge.toFunction}</code>
            </span>
            <span class="function-edge-meta">
              <code class="inline-code">{edge.payload}</code>
              <span class="flow-step-separator">/</span>
              <code class="inline-code">{edge.effect}</code>
            </span>
            <span class="function-edge-source">
              {@render FlowStepReference(target.flowId, target.stepId, 'small', stepReferenceMode(target.flowId))}
            </span>
          </button>
        {/each}
      {:else}
        <div class="flow-link-empty">No cross-flow function edges.</div>
      {/if}
    </div>
  </div>
{/snippet}

