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
  let timer = null;
  let diagramWrap;
  let edgeLayer;
  let logBody;

  const flowById = (id) => FLOWS.find((flow) => flow.id === id) ?? null;
  const flowIndexById = (id) => FLOWS.findIndex((flow) => flow.id === id);
  const laneById = (id) => LANES.find((lane) => lane.id === id) ?? LANES[0];
  const relationKind = (relation) => RELATION_KINDS[relation.kind] ?? RELATION_KINDS.call;
  const stepById = (flowId, stepId) => flowById(flowId)?.steps.find((step) => step.id === stepId) ?? null;
  const boardNodeKey = (role, flowId, stepId) => `${role}:${flowId}::${stepId}`;

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

  onMount(() => {
    loadUrlSelection();
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

  function buildBoardProjection(flow) {
    const crossEdges = crossFunctionEdgesForFlow(flow.id);
    const rows = [];
    const nodes = [];
    const seen = new Set();

    function addNode(flowId, stepId, role, edge = null) {
      const step = stepById(flowId, stepId);
      const nodeFlow = flowById(flowId);
      if (!step || !nodeFlow) return;
      const key = boardNodeKey(role, flowId, stepId);
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({ flowId, stepId, role, edge });
      const laneIndex = Math.max(0, LANES.findIndex((lane) => lane.id === step.lane));
      nodes.push({ key, role, flowId, stepId, flow: nodeFlow, step, laneIndex, row: rows.length });
    }

    crossEdges.filter((edge) => edge.toFlow === flow.id).forEach((edge) => addNode(edge.fromFlow, edge.fromStep, 'incoming', edge));
    flow.steps.forEach((step) => addNode(flow.id, step.id, 'current'));
    crossEdges.filter((edge) => edge.fromFlow === flow.id).forEach((edge) => addNode(edge.toFlow, edge.toStep, 'outgoing', edge));

    return { nodes, edges: crossEdges, rowCount: Math.max(rows.length, flow.steps.length) };
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

  function selectFlowStep(flowId, stepId = '') {
    const flow = flowById(flowId);
    if (!flow) return;
    stopTimer();
    selectedSymbolId = '';
    selectedFlowId = flow.id;
    selectedStepId = stepId && stepById(flow.id, stepId) ? stepId : flow.steps[0]?.id;
    filter = '';
    sidebarOpen = false;
    updateUrlSelection();
  }

  function selectFlow(index) {
    const flow = FLOWS[Math.max(0, Math.min(FLOWS.length - 1, index))];
    if (flow) selectFlowStep(flow.id);
  }

  function setStepByIndex(index) {
    const step = currentFlow.steps[Math.max(0, Math.min(currentFlow.steps.length - 1, index))];
    if (!step) return;
    selectedStepId = step.id;
    selectedSymbolId = '';
    updateUrlSelection();
    if (playing) restartTimer();
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
    if (!codebaseSymbolById(symbolId)) return;
    stopTimer();
    playing = false;
    selectedSymbolId = symbolId;
    sidebarOpen = false;
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
    if (flowId && flowById(flowId)) {
      selectedFlowId = flowId;
      selectedStepId = stepId && stepById(flowId, stepId) ? stepId : flowById(flowId).steps[0]?.id;
    }
  }

  function updateUrlSelection() {
    const url = new URL(window.location.href);
    url.searchParams.set('flow', selectedFlowId);
    if (selectedStepId) url.searchParams.set('step', selectedStepId);
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
      const incoming = edge.toFlow === currentFlow.id;
      const fromKey = incoming ? boardNodeKey('incoming', edge.fromFlow, edge.fromStep) : boardNodeKey('current', edge.fromFlow, edge.fromStep);
      const toKey = incoming ? boardNodeKey('current', edge.toFlow, edge.toStep) : boardNodeKey('outgoing', edge.toFlow, edge.toStep);
      const fromNode = diagramWrap.querySelector(`[data-node-key="${CSS.escape(fromKey)}"]`);
      const toNode = diagramWrap.querySelector(`[data-node-key="${CSS.escape(toKey)}"]`);
      if (!fromNode || !toNode) return '';
      const startRect = fromNode.getBoundingClientRect();
      const endRect = toNode.getBoundingClientRect();
      const start = { x: startRect.right - wrapRect.left, y: startRect.top + startRect.height / 2 - wrapRect.top };
      const end = { x: endRect.left - wrapRect.left, y: endRect.top + endRect.height / 2 - wrapRect.top };
      const trunkX = start.x + Math.max(42, Math.abs(end.x - start.x) * 0.44);
      const d = `M ${start.x} ${start.y} C ${trunkX} ${start.y}, ${trunkX} ${end.y}, ${end.x} ${end.y}`;
      const direction = incoming ? 'incoming' : 'outgoing';
      const activeStep = incoming ? edge.toStep : edge.fromStep;
      const active = activeStep === currentStep?.id ? ' active' : '';
      return `<path class="edge cross-edge ${direction}${active}" data-edge-id="${escapeHtml(edge.id)}" d="${d}" />`;
    }).join('');
    edgeLayer.innerHTML = defs + paths;
  }

  function codebaseSymbolById(symbolId) {
    return codebaseGraph?.symbols?.find((symbol) => symbol.id === symbolId) ?? null;
  }

  function codebaseFileById(fileId) {
    return codebaseGraph?.files?.find((file) => file.id === fileId) ?? null;
  }

  function graphSymbolsForStep(step) {
    if (!codebaseGraph?.symbols?.length || !step) return [];
    const callName = String(step.call || step.code || '').match(/[A-Za-z_$][\w$]*/)?.[0];
    if (!callName) return [];
    return codebaseGraph.symbols
      .filter((symbol) => symbol.name === callName || symbol.signature?.includes(callName))
      .slice(0, 4);
  }

  function sourceReference(step) {
    const symbol = graphSymbolsForStep(step)[0];
    return {
      label: step?.source ?? '',
      url: symbol?.range?.githubUrl ?? null
    };
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
                        <span class="flow-link-title">{flowById(targetFlowId)?.title ?? targetFlowId}</span>
                        <span class="flow-link-route">{flowById(relation.fromFlow)?.title ?? relation.fromFlow} -&gt; {flowById(relation.toFlow)?.title ?? relation.toFlow}</span>
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
                        <span class="flow-link-title">{flowById(targetFlowId)?.title ?? targetFlowId}</span>
                        <span class="flow-link-route">{flowById(relation.fromFlow)?.title ?? relation.fromFlow} -&gt; {flowById(relation.toFlow)?.title ?? relation.toFlow}</span>
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

        <div class="board-scroll">
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
            <div class="diagram-grid" style:grid-template-rows={`repeat(${boardProjection.rowCount}, minmax(94px, auto))`}>
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
                  style={`grid-column:${node.laneIndex + 1};grid-row:${node.row}`}
                  onclick={() => node.role === 'current' ? setStepByIndex(node.step.index) : selectFlowStep(node.flowId, node.stepId)}
                >
                  <div class="node-topline">
                    <span class="node-seq" title={node.role === 'current' ? 'Current flow step' : `${directionLabel(node.role)} context step`} aria-label={node.role === 'current' ? 'Current flow step' : `${directionLabel(node.role)} context step`}>
                      {#if node.role === 'current'}
                        {stepNumberLabel(node.flowId, node.stepId)}
                      {:else}
                        {@render DirectionIcon(node.role)}
                      {/if}
                    </span>
                    {@render FlowStepReference(node.flowId, node.stepId, 'compact')}
                  </div>
                  <code class="node-code">{node.step.code}</code>
                </button>
              {/each}
            </div>
          </div>
        </div>
      </article>

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
                <code class="source-path">
                  {#if currentSourceRef.url}
                    <a href={currentSourceRef.url} target="_blank" rel="noreferrer">{currentSourceRef.label}</a>
                  {:else}
                    {currentSourceRef.label}
                  {/if}
                </code>
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
                      {@render FlowStepReference(target.flowId, target.stepId, 'detail')}
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
      <path d="M5 7h8a6 6 0 0 1 6 6v4" />
      <path d="m13 13 6 6 6-6" transform="translate(-6 -2)" />
    {:else}
      <path d="M5 17v-4a6 6 0 0 1 6-6h8" />
      <path d="m13 5 6 6-6 6" />
    {/if}
  </svg>
{/snippet}

{#snippet FlowStepReference(flowId, stepId, variant)}
  {@const flow = flowById(flowId)}
  {@const step = stepById(flowId, stepId)}
  {#if flow && step}
    <span class:compact={variant === 'compact'} class:detail={variant === 'detail'} class:small={variant === 'small'} class="flow-step-ref">
      <span class="flow-step-pill flow-pill">
        <span class="flow-step-number">{flowNumberLabel(flowId)}</span>
        <span>{flow.title}</span>
      </span>
      <span class="flow-step-separator">/</span>
      <span class="flow-step-pill step-pill">
        <span class="flow-step-number">{stepNumberLabel(flowId, stepId)}</span>
        <span>{step.title}</span>
      </span>
    </span>
  {:else}
    <span class="flow-step-ref missing">{stepLabel(flowId, stepId)}</span>
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
              {@render FlowStepReference(edge.fromFlow, edge.fromStep, 'small')}
              <span class="code-arrow">-&gt;</span>
              {@render FlowStepReference(edge.toFlow, edge.toStep, 'small')}
            </span>
          </button>
        {/each}
      {:else}
        <div class="flow-link-empty">No cross-flow function edges.</div>
      {/if}
    </div>
  </div>
{/snippet}

