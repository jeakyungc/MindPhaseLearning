export const LANES = [
  { id: 'entry', label: 'Trigger / UI', sub: 'User gestures and shell events' },
  { id: 'page', label: 'Page Runtime', sub: 'Controllers, actions, and route runtime' },
  { id: 'feature', label: 'Application', sub: 'Feature facades and domain services' },
  { id: 'ipc', label: 'Service / IPC', sub: 'Clients, DTOs, and command transport' },
  { id: 'rust', label: 'Rust Backend', sub: 'Tauri commands and app state' },
  { id: 'infra', label: 'Infrastructure', sub: 'Database, file system, indexer, renderer' },
];

const FLOW_SPECS = [
  { id: 'tauri-bootstrap', group: 'App Lifecycle', title: 'Rust / Tauri Bootstrap', summary: 'The desktop process registers commands, prepares state, runs migrations, starts indexing, and enters the event loop.', trigger: 'Desktop process starts', result: 'Backend IPC runtime is ready', tags: ['startup', 'tauri', 'backend'], refs: [
    ['entry', 'Process entry', 'run()', 'src-tauri/src/lib.rs'],
    ['rust', 'Register command handler', 'mindphase_command_registry', 'src-tauri/src/app/command_registry.rs'],
    ['rust', 'Build Tauri app', 'run_with_handler', 'src-tauri/src/app/bootstrap.rs'],
    ['infra', 'Initialize database and index', 'reindex_workspace', 'src-tauri/src/app/state.rs'],
    ['rust', 'Start event loop', 'run', 'src-tauri/src/app/bootstrap.rs'],
  ] },
  { id: 'frontend-composition', group: 'App Lifecycle', title: 'Frontend Application Composition', summary: 'The page composition root wires application facades, feature services, clients, and command transport.', trigger: 'Page services are created', result: 'Page runtime receives application service functions', tags: ['composition', 'facade', 'transport'], refs: [
    ['page', 'Create route services', 'createPageRouteServices', 'src/lib/page/page-route-runtime-wiring.ts'],
    ['feature', 'Create app facade', 'createMindPhaseApp', 'src/lib/app/mindphase-app.ts'],
    ['ipc', 'Create command transport', 'TauriCommandTransport', 'src/lib/shared/ipc/TauriCommandTransport.ts'],
    ['feature', 'Wire workspace feature', 'WorkspaceFeature', 'src/lib/features/workspace/WorkspaceFeature.ts'],
    ['feature', 'Return page service API', 'createPageRouteServices', 'src/lib/page/page-route-runtime-wiring.ts'],
  ] },
  { id: 'page-mount', group: 'App Lifecycle', title: 'Page Mount & Durable State Load', summary: 'Mounted route controllers restore durable state and schedule initial workspace and engine loading.', trigger: 'PageRoute component mounts', result: 'Controllers and durable UI state are ready', tags: ['onMount', 'durable state', 'controllers'], refs: [
    ['entry', 'Register mounted lifecycle', 'registerPageMountedLifecycle', 'src/lib/page/page-route-lifecycle.svelte.ts'],
    ['page', 'Create lifecycle runtime', 'createPageLifecyclePageRuntime', 'src/lib/page/page-lifecycle.ts'],
    ['page', 'Run page lifecycle', 'runPageLifecycle', 'src/lib/page/page-lifecycle.ts'],
    ['feature', 'Load theme and zoom', 'load', 'src/lib/page/controllers/app-theme-controller.svelte.ts'],
    ['page', 'Start engine init', 'runPageEngineInit', 'src/lib/page/page-engine-init.ts'],
  ] },
  { id: 'engine-init', group: 'App Lifecycle', title: 'Renderer & Graph Engine Initialization', summary: 'The page creates a render backend, camera, grid renderer, and GraphRuntime before loading graph data.', trigger: 'runPageEngineInit()', result: 'Interactive graph engine is ready', tags: ['renderer', 'graph', 'canvas'], refs: [
    ['page', 'Create renderer', 'createRenderer', 'src/lib/engine/render/BackendFactory.ts'],
    ['page', 'Prepare engine resources', 'runPageEngineInit', 'src/lib/page/page-engine-init.ts'],
    ['feature', 'Create GraphRuntime', 'GraphRuntime', 'src/lib/graph/core/GraphRuntime.ts'],
    ['ipc', 'Request graph snapshot', 'loadSnapshot', 'src/lib/graph/data/DocumentGraphRepository.ts'],
    ['page', 'Bind canvas events', 'registerCanvasEngineEvents', 'src/lib/page/page-engine-init.ts'],
  ] },
  { id: 'render-loop', group: 'App Lifecycle', title: 'Graph Render Loop', summary: 'Render invalidation schedules frames, updates camera and graph runtime state, then draws GPU and DOM overlays.', trigger: 'requestRender(reason)', result: 'Canvas and overlay are refreshed', tags: ['requestAnimationFrame', 'rendering', 'hud'], refs: [
    ['entry', 'Request render', 'requestRender', 'src/lib/page/page-render-scheduler.ts'],
    ['page', 'Deduplicate frame', 'PageRenderScheduler', 'src/lib/page/page-render-scheduler.ts'],
    ['page', 'Render frame', 'renderFrame', 'src/lib/page/page-render-scheduler.ts'],
    ['feature', 'Update graph runtime', 'update', 'src/lib/graph/core/GraphRuntime.ts'],
    ['infra', 'Draw backend frame', 'draw', 'src/lib/graph/core/GraphRuntime.ts'],
  ] },
  { id: 'workspace-registry', group: 'Workspace', title: 'Workspace Registry Switch & Remove', summary: 'Workspace settings list, add, activate, and remove registered workspaces, then refresh dependent views.', trigger: 'Workspace settings action', result: 'Active workspace context is updated', tags: ['workspace', 'registry', 'settings'], refs: [
    ['entry', 'Start registry action', 'workspaceSettingsActions', 'src/lib/page/workspace-settings-actions.ts'],
    ['feature', 'Call workspace registry', 'WorkspaceFeature', 'src/lib/features/workspace/WorkspaceFeature.ts'],
    ['ipc', 'Invoke workspace client', 'WorkspaceClient', 'src/lib/services/workspace-client.ts'],
    ['rust', 'Handle registry command', 'workspace_registry_service', 'src-tauri/src/application/workspace_registry_service.rs'],
    ['page', 'Reload workspace view', 'reloadWorkspaceTreeAndGraph', 'src/lib/page/workspace-settings-actions.ts'],
  ] },
  { id: 'workspace-tree-load', group: 'Workspace', title: 'Workspace Tree Load & Graph Sync', summary: 'The active workspace tree is loaded from the backend and synchronized with graph and editor state.', trigger: 'Workspace tree loader runs', result: 'Tree and graph reflect the active workspace', tags: ['workspace', 'tree', 'graph'], refs: [
    ['page', 'Request workspace tree', 'loadWorkspaceTree', 'src/lib/page/page-route-lifecycle.svelte.ts'],
    ['feature', 'Call workspace facade', 'WorkspaceFeature', 'src/lib/features/workspace/WorkspaceFeature.ts'],
    ['ipc', 'Invoke entries client', 'WorkspaceClient', 'src/lib/services/workspace-client.ts'],
    ['rust', 'Read workspace entries', 'workspace_query_service', 'src-tauri/src/application/workspace_query_service.rs'],
    ['page', 'Apply tree state', 'workspacePanel', 'src/lib/page/workspace-management-runtime.ts'],
  ] },
  { id: 'document-open', group: 'Document & Editor', title: 'Document Open', summary: 'Opening a row or graph node reads document content and creates or activates an editor session.', trigger: 'Workspace item open action', result: 'Selected document is visible in the editor', tags: ['document', 'editor', 'open'], refs: [
    ['entry', 'Receive open action', 'handleWorkspaceRowClick', 'src/lib/page/workspace-interaction-runtime.ts'],
    ['feature', 'Read document service', 'DocumentFeature', 'src/lib/features/documents/DocumentFeature.ts'],
    ['ipc', 'Invoke read command', 'readDocument', 'src/lib/editor/MarkdownDocumentService.ts'],
    ['rust', 'Read document backend', 'read_document', 'src-tauri/src/commands/index_commands.rs'],
    ['page', 'Open editor session', 'openWorkspaceFile', 'src/lib/page/workspace-file-open-actions.ts'],
  ] },
  { id: 'document-save', group: 'Document & Editor', title: 'Editor Draft Save', summary: 'Saving an editor draft validates hashes, writes content, updates editor dirty state, and triggers index refresh.', trigger: 'Save command or dirty-close save', result: 'File contents and editor hash are current', tags: ['save', 'draft', 'reindex'], refs: [
    ['entry', 'Request draft save', 'saveEditorDraft', 'src/lib/page/editor-draft-save-actions.ts'],
    ['page', 'Prepare save payload', 'saveEditorDraft', 'src/lib/page/editor-draft-save-actions.ts'],
    ['feature', 'Call document save', 'DocumentFeature', 'src/lib/features/documents/DocumentFeature.ts'],
    ['ipc', 'Invoke save command', 'saveDocument', 'src/lib/editor/MarkdownDocumentService.ts'],
    ['rust', 'Persist document', 'save_document', 'src-tauri/src/commands/index_commands.rs'],
  ] },
  { id: 'document-media-bytes', group: 'Document & Editor', title: 'Document Bytes & Media Resolve', summary: 'Document media helpers resolve workspace-relative media references and read binary document bytes.', trigger: 'Preview or attachment request', result: 'Binary content or resolved media path is returned', tags: ['bytes', 'media', 'preview'], refs: [
    ['entry', 'Request media content', 'resolveDocumentMedia', 'src/lib/page/page-route-runtime-wiring.ts'],
    ['feature', 'Use document service', 'MarkdownDocumentService', 'src/lib/editor/MarkdownDocumentService.ts'],
    ['ipc', 'Invoke media command', 'resolveDocumentMedia', 'src/lib/editor/MarkdownDocumentService.ts'],
    ['rust', 'Resolve media path', 'document_command_service', 'src-tauri/src/application/document_command_service.rs'],
    ['infra', 'Read file bytes', 'read', 'src-tauri/src/application/document_text_service.rs'],
  ] },
  { id: 'editor-close', group: 'Document & Editor', title: 'Dirty Editor Close', summary: 'Closing an editor resolves dirty state, optional save, session removal, graph selection, and occupancy cleanup.', trigger: 'Close editor action', result: 'Editor session is closed or blocked by save failure', tags: ['close', 'dirty', 'session'], refs: [
    ['entry', 'Request close', 'closeEditor', 'src/lib/page/editor-close-actions.ts'],
    ['page', 'Check dirty editor', 'editorSession', 'src/lib/page/editor-close-actions.ts'],
    ['page', 'Optionally save draft', 'saveEditorDraft', 'src/lib/page/editor-draft-save-actions.ts'],
    ['page', 'Remove editor session', 'closeEditor', 'src/lib/page/editor-close-actions.ts'],
    ['feature', 'Sync graph selection', 'setGraphSelectedNodeId', 'src/lib/page/controllers/graph-scene-controller.svelte.ts'],
  ] },
  { id: 'editor-session', group: 'Document & Editor', title: 'Editor Session Restore & Persist', summary: 'Editor session persistence stores open tabs and restores them after graph engine initialization.', trigger: 'Engine init or session state change', result: 'Open editor layout survives remount', tags: ['session', 'restore', 'persist'], refs: [
    ['page', 'Restore session state', 'restoreEditorSessionState', 'src/lib/page/full-editor-runtime.ts'],
    ['page', 'Open restored document', 'openWorkspaceFile', 'src/lib/page/workspace-file-open-actions.ts'],
    ['page', 'Persist session state', 'persistEditorSessionState', 'src/lib/page/full-editor-runtime-view-session-actions.ts'],
    ['feature', 'Track editor occupancy', 'syncEditorOccupanciesWithRuntime', 'src/lib/page/page-render-scheduler.ts'],
    ['page', 'Update active tab', 'editorSession', 'src/lib/page/full-editor-runtime.ts'],
  ] },
  { id: 'workspace-create-file', group: 'Workspace', title: 'Document Create', summary: 'Creating a document plans a path, invokes backend file creation, reloads tree and graph, and opens the new document.', trigger: 'Create document action', result: 'New document appears in workspace and editor', tags: ['create', 'document', 'workspace'], refs: [
    ['entry', 'Request document creation', 'createWorkspaceDocument', 'src/lib/page/workspace-create-actions.ts'],
    ['page', 'Plan file name', 'createDocumentPlan', 'src/lib/page/workspace-management-runtime.ts'],
    ['feature', 'Call entries facade', 'WorkspaceFeature', 'src/lib/features/workspace/WorkspaceFeature.ts'],
    ['ipc', 'Invoke create command', 'createWorkspaceFile', 'src/lib/services/workspace-client.ts'],
    ['rust', 'Create workspace file', 'create_workspace_file', 'src-tauri/src/commands/index_commands.rs'],
  ] },
  { id: 'workspace-create-folder', group: 'Workspace', title: 'Folder Create & Inline Rename', summary: 'Creating a folder reserves a target path, writes the folder, then activates inline rename state.', trigger: 'Create folder action', result: 'New folder is visible and ready for rename', tags: ['folder', 'create', 'rename'], refs: [
    ['entry', 'Request folder creation', 'createWorkspaceFolder', 'src/lib/page/workspace-create-actions.ts'],
    ['page', 'Plan folder path', 'createFolderPlan', 'src/lib/page/workspace-management-runtime.ts'],
    ['ipc', 'Invoke folder command', 'createWorkspaceFolder', 'src/lib/services/workspace-client.ts'],
    ['rust', 'Create folder backend', 'create_workspace_folder', 'src-tauri/src/commands/index_commands.rs'],
    ['page', 'Focus rename input', 'settleGraphPresentation', 'src/lib/page/workspace-create-actions.ts'],
  ] },
  { id: 'workspace-move-rename', group: 'Workspace', title: 'File Move & Rename', summary: 'Move and rename workflows validate destination paths, call backend mutation, reload views, and reopen moved documents.', trigger: 'Drag drop or inline rename commit', result: 'Tree, graph, and editor point at the new path', tags: ['move', 'rename', 'filesystem'], refs: [
    ['entry', 'Start move or rename', 'finishInternalMoveDrop', 'src/lib/page/workspace-interaction-runtime.ts'],
    ['page', 'Validate move plan', 'renamePlan', 'src/lib/page/workspace-management-runtime.ts'],
    ['ipc', 'Invoke move command', 'moveEntry', 'src/lib/services/workspace-client.ts'],
    ['rust', 'Move workspace entry', 'move_workspace_entry', 'src-tauri/src/commands/index_commands.rs'],
    ['page', 'Reload and reopen', 'reloadWorkspaceTreeAndGraph', 'src/lib/page/workspace-move-actions.ts'],
  ] },
  { id: 'workspace-external-copy', group: 'Workspace', title: 'External File Drag & Drop Copy', summary: 'External dropped files are copied into the target workspace folder and indexed into tree and graph views.', trigger: 'Operating system drag/drop event', result: 'Copied entries appear in workspace', tags: ['drag drop', 'copy', 'external'], refs: [
    ['entry', 'Receive external drop', 'handleWorkspaceExternalDragDrop', 'src/lib/page/workspace-external-copy-actions.ts'],
    ['page', 'Resolve drop target', 'handleWorkspaceExternalDragDrop', 'src/lib/page/workspace-external-copy-actions.ts'],
    ['feature', 'Call copy facade', 'WorkspaceFeature', 'src/lib/features/workspace/WorkspaceFeature.ts'],
    ['ipc', 'Invoke copy command', 'copyExternalEntries', 'src/lib/services/workspace-client.ts'],
    ['rust', 'Copy external entries', 'copy_external_workspace_entries', 'src-tauri/src/commands/index_commands.rs'],
  ] },
  { id: 'workspace-trash', group: 'Workspace', title: 'Workspace Entry Move To Trash', summary: 'Trash actions remove selected files or folders, close affected editors, and refresh workspace projections.', trigger: 'Delete or trash command', result: 'Entry is removed from active workspace view', tags: ['trash', 'delete', 'cleanup'], refs: [
    ['entry', 'Request trash action', 'trashWorkspaceEntry', 'src/lib/page/workspace-trash-actions.ts'],
    ['page', 'Find affected editors', 'editorSession', 'src/lib/page/workspace-trash-actions.ts'],
    ['ipc', 'Invoke trash command', 'trashEntry', 'src/lib/services/workspace-client.ts'],
    ['rust', 'Trash workspace entry', 'trash_workspace_entry', 'src-tauri/src/commands/index_commands.rs'],
    ['page', 'Reload workspace view', 'reloadWorkspaceTreeAndGraph', 'src/lib/page/workspace-trash-actions.ts'],
  ] },
  { id: 'search', group: 'Search & Index', title: 'Document Body Tag Backlink Search', summary: 'Search routes choose document, body, tag, or backlink search and return indexed results to the UI.', trigger: 'Search input or command palette', result: 'Search results are returned for the active workspace', tags: ['search', 'tags', 'backlinks'], refs: [
    ['entry', 'Receive search query', 'WorkspaceSearchPanel', 'src/lib/page/components/WorkspaceSearchPanel.svelte'],
    ['page', 'Build search params', 'SearchParams', 'src/lib/types/search.ts'],
    ['feature', 'Call search client', 'SearchClient', 'src/lib/services/search-client.ts'],
    ['ipc', 'Invoke search command', 'search', 'src/lib/services/search-client.ts'],
    ['rust', 'Run backend search', 'ripgrep_search', 'src-tauri/src/indexer/ripgrep_search.rs'],
  ] },
  { id: 'reindex', group: 'Search & Index', title: 'Workspace Full & Changed Path Reindex', summary: 'Full and changed-path reindexing refreshes search, graph sources, and emits workspace-indexed events.', trigger: 'Startup, manual request, or file watcher event', result: 'Index and graph source data are current', tags: ['index', 'watcher', 'graph'], refs: [
    ['entry', 'Trigger reindex', 'reindexWorkspace', 'src/lib/page/page-route-runtime-wiring.ts'],
    ['ipc', 'Invoke reindex command', 'IndexingClient', 'src/lib/services/indexing-client.ts'],
    ['rust', 'Run index service', 'reindex_workspace', 'src-tauri/src/application/index_service.rs'],
    ['infra', 'Scan files', 'reindex_workspace', 'src-tauri/src/indexer/reindex.rs'],
    ['page', 'Handle indexed event', 'handleWorkspaceIndexed', 'src/lib/page/page-engine-init.ts'],
  ] },
  { id: 'graph-snapshot', group: 'Graph', title: 'Graph Snapshot Load & Reload', summary: 'GraphRuntime loads or reloads backend snapshots and applies them to simulation and overlay state.', trigger: 'Graph init or workspace-indexed event', result: 'Runtime graph nodes and links are current', tags: ['snapshot', 'runtime', 'reload'], refs: [
    ['page', 'Request snapshot reload', 'reloadGraphFromFilesystem', 'src/lib/page/workspace-settings-actions.ts'],
    ['feature', 'Load repository snapshot', 'loadSnapshot', 'src/lib/graph/data/DocumentGraphRepository.ts'],
    ['ipc', 'Invoke graph command', 'getDocumentGraph', 'src/lib/graph/data/DocumentGraphRepository.ts'],
    ['rust', 'Build graph DTO', 'get_document_graph', 'src-tauri/src/commands/index_commands.rs'],
    ['feature', 'Apply snapshot', 'applySnapshot', 'src/lib/graph/core/GraphRuntime.ts'],
  ] },
  { id: 'graph-interaction', group: 'Graph', title: 'Graph Selection Drag & Local Graph', summary: 'Pointer and keyboard interactions update graph selection, camera movement, local graph state, and editor focus.', trigger: 'Canvas pointer or keyboard interaction', result: 'Graph UI and editor focus are synchronized', tags: ['selection', 'drag', 'local graph'], refs: [
    ['entry', 'Receive pointer input', 'registerCanvasEngineEvents', 'src/lib/page/page-engine-init.ts'],
    ['feature', 'Hit test graph node', 'GraphRuntime', 'src/lib/graph/core/GraphRuntime.ts'],
    ['page', 'Open selected node', 'openGraphNode', 'src/lib/page/page-workspace-surface-runtime.ts'],
    ['page', 'Sync editor focus', 'syncSelectionFromActiveEditor', 'src/lib/page/editor-close-actions.ts'],
    ['feature', 'Update graph controller', 'setGraphSelectedNodeId', 'src/lib/page/controllers/graph-scene-controller.svelte.ts'],
  ] },
  { id: 'zoom', group: 'Settings', title: 'App Zoom Load & Change', summary: 'Zoom settings load from durable preferences, update UI optimistically, and persist through backend commands.', trigger: 'Zoom setting load or user change', result: 'Webview zoom and stored preference are updated', tags: ['settings', 'zoom', 'preference'], refs: [
    ['page', 'Load zoom controller', 'load', 'src/lib/page/controllers/app-zoom-controller.svelte.ts'],
    ['feature', 'Call zoom feature', 'AppZoomFeature', 'src/lib/features/settings/AppZoomFeature.ts'],
    ['ipc', 'Invoke zoom command', 'AppZoomClient', 'src/lib/services/app-zoom-service.ts'],
    ['rust', 'Persist zoom setting', 'app_zoom_commands', 'src-tauri/src/commands/app_zoom_commands.rs'],
    ['page', 'Apply zoom state', 'appZoom', 'src/lib/page/app-zoom.ts'],
  ] },
  { id: 'theme', group: 'Settings', title: 'Built-in Community Workspace Theme', summary: 'Theme selection merges built-in, community, and workspace CSS sources and applies them to the route.', trigger: 'Theme load or selection change', result: 'Active theme CSS is loaded', tags: ['theme', 'community', 'workspace'], refs: [
    ['page', 'Load theme controller', 'load', 'src/lib/page/controllers/app-theme-controller.svelte.ts'],
    ['feature', 'Load theme options', 'AppThemeFeature', 'src/lib/features/settings/AppThemeFeature.ts'],
    ['ipc', 'Invoke theme command', 'AppThemeClient', 'src/lib/services/app-theme-service.ts'],
    ['rust', 'Read theme service', 'theme_service', 'src-tauri/src/application/theme_service.rs'],
    ['page', 'Apply theme CSS', 'markdown-editor-theme', 'src/lib/editor/markdown-editor-theme.ts'],
  ] },
  { id: 'durable-preferences', group: 'Settings', title: 'Common Durable Preferences Sync', summary: 'Durable preference sync reads cached and backend values, normalizes them, applies controllers, and persists changes.', trigger: 'Controller load or preference change', result: 'UI preferences are consistent across sessions', tags: ['preferences', 'durable', 'sync'], refs: [
    ['page', 'Start durable sync', 'DurablePreferenceSync', 'src/lib/page/durable-preference-sync.ts'],
    ['feature', 'Read preference value', 'load', 'src/lib/page/durable-preference-sync.ts'],
    ['ipc', 'Persist preference', 'save', 'src/lib/page/durable-preference-sync.ts'],
    ['page', 'Apply normalized value', 'applyValue', 'src/lib/page/durable-preference-sync.ts'],
    ['page', 'Invalidate render', 'requestRender', 'src/lib/page/page-render-scheduler.ts'],
  ] },
  { id: 'community', group: 'Extensions', title: 'Community Catalog Install Remove', summary: 'Community catalog loading, install, and remove operations update package state and refresh theme options.', trigger: 'Community panel load or install action', result: 'Catalog and installed extension state are current', tags: ['community', 'install', 'catalog'], refs: [
    ['page', 'Load community controller', 'load', 'src/lib/page/controllers/community-controller.svelte.ts'],
    ['feature', 'Query community feature', 'CommunityFeature', 'src/lib/features/community/CommunityFeature.ts'],
    ['ipc', 'Invoke community command', 'community', 'src/lib/services/community-service.ts'],
    ['rust', 'Read catalog service', 'community_catalog_service', 'src-tauri/src/application/community_catalog_service.rs'],
    ['rust', 'Install package', 'community_install_service', 'src-tauri/src/application/community_install_service.rs'],
  ] },
  { id: 'collaboration', group: 'Extensions', title: 'Collaboration Document Session Realtime Sync', summary: 'Collaboration services coordinate document registry, persistence snapshots, sessions, and realtime updates.', trigger: 'Collaboration document open or local update', result: 'Local and remote collaborative document state is synchronized', tags: ['collaboration', 'realtime', 'session'], refs: [
    ['entry', 'Request collaboration action', 'CollaborationService', 'src/lib/collaboration/CollaborationService.ts'],
    ['feature', 'Ensure document registry', 'CollaborationDocumentRegistry', 'src/lib/collaboration/collaboration-document-registry.ts'],
    ['feature', 'Load persistence snapshot', 'CollaborationPersistenceClient', 'src/lib/collaboration/collaboration-persistence-client.ts'],
    ['feature', 'Manage session', 'CollaborationSessionClient', 'src/lib/collaboration/collaboration-session-client.ts'],
    ['ipc', 'Invoke collaboration command', 'collaboration_commands', 'src-tauri/src/commands/collaboration_commands.rs'],
  ] },
  { id: 'chat', group: 'Extensions', title: 'LLM Query & Markdown Save', summary: 'Chat prompts are sent to the backend LLM workflow, saved as workspace markdown, then picked up by indexing.', trigger: 'Chat prompt submit', result: 'Generated markdown appears in workspace', tags: ['LLM', 'markdown', 'chat'], refs: [
    ['entry', 'Submit prompt', 'GraphChatBar', 'src/lib/page/components/GraphChatBar.svelte'],
    ['feature', 'Call chat service', 'queryLlmAndSaveMarkdown', 'src/lib/services/chat-service.ts'],
    ['ipc', 'Invoke chat command', 'query_llm_and_save_markdown', 'src/lib/services/chat-service.ts'],
    ['rust', 'Run chat backend', 'chat_commands', 'src-tauri/src/commands/chat_commands.rs'],
    ['infra', 'Write markdown file', 'chat_file_service', 'src-tauri/src/application/chat_file_service.rs'],
  ] },
  { id: 'system-actions', group: 'Extensions', title: 'Clipboard & File Explorer System Actions', summary: 'System actions copy text to clipboard or reveal paths in the operating system file explorer.', trigger: 'Context menu or toolbar action', result: 'Operating system clipboard or file explorer action runs', tags: ['clipboard', 'file explorer', 'system'], refs: [
    ['entry', 'Select system action', 'copyTextToClipboard', 'src/lib/page/page-route-runtime-wiring.ts'],
    ['page', 'Call system service', 'system-service', 'src/lib/services/system-service.ts'],
    ['ipc', 'Invoke system command', 'copy_text_to_clipboard', 'src/lib/services/system-service.ts'],
    ['rust', 'Handle system command', 'system_commands', 'src-tauri/src/commands/system_commands.rs'],
    ['infra', 'Use platform integration', 'opener', 'src-tauri/src/app/bootstrap.rs'],
  ] },
  { id: 'pdf-annotations', group: 'Extensions', title: 'PDF Annotation Import Export Local Snapshot', summary: 'PDF annotation actions inspect backend capabilities, import or export annotation data, and persist local snapshots.', trigger: 'PDF viewer annotation action', result: 'Annotation state is imported, exported, or saved', tags: ['PDF', 'annotations', 'snapshot'], refs: [
    ['entry', 'Request annotation action', 'PdfDocumentService', 'src/lib/editor/PdfDocumentService.ts'],
    ['page', 'Check backend capabilities', 'getPdfAnnotationBackendCapabilities', 'src/lib/editor/PdfDocumentService.ts'],
    ['ipc', 'Invoke PDF command', 'getPdfAnnotationBackendCapabilities', 'src/lib/editor/PdfDocumentService.ts'],
    ['rust', 'Process PDF annotations', 'pdf_annotation_commands', 'src-tauri/src/commands/pdf_annotation_commands.rs'],
    ['infra', 'Transform PDF data', 'pdf_annotation_export_policy', 'src-tauri/src/application/pdf_annotation_export_policy.rs'],
  ] },
  { id: 'document-anchors', group: 'Extensions', title: 'Document Anchor Query & Save', summary: 'Document anchors connect editor positions to graph and document navigation through backend indexed anchor records.', trigger: 'Anchor panel or editor position save', result: 'Document anchors are queryable and reflected in UI', tags: ['anchors', 'document', 'navigation'], refs: [
    ['entry', 'Request anchors', 'DocumentAnchorService', 'src/lib/editor/DocumentAnchorService.ts'],
    ['feature', 'Build anchor DTO', 'DocumentAnchorService', 'src/lib/editor/DocumentAnchorService.ts'],
    ['ipc', 'Invoke anchor command', 'get_document_anchors', 'src/lib/shared/ipc/command-names.ts'],
    ['rust', 'Handle anchor command', 'index_commands', 'src-tauri/src/commands/index_commands.rs'],
    ['infra', 'Persist anchor model', 'anchor', 'src-tauri/src/models/anchor.rs'],
  ] },
  { id: 'page-unmount', group: 'App Lifecycle', title: 'Page Unmount & Resource Cleanup', summary: 'Unmount cleanup persists editor session state and releases events, observers, workers, runtime, renderer, and GPU resources.', trigger: 'Route unmount or window teardown', result: 'Runtime resources are disposed', tags: ['cleanup', 'dispose', 'unmount'], refs: [
    ['entry', 'Run cleanup callback', 'onMount cleanup', 'src/lib/page/page-lifecycle.ts'],
    ['page', 'Set destroyed guard', 'runPageLifecycle', 'src/lib/page/page-lifecycle.ts'],
    ['page', 'Persist editor session', 'persistEditorSessionState', 'src/lib/page/full-editor-runtime-view-session-actions.ts'],
    ['feature', 'Destroy graph runtime', 'destroy', 'src/lib/graph/core/GraphRuntime.ts'],
    ['infra', 'Release renderer backend', 'destroyCreatedEngine', 'src/lib/page/page-engine-init.ts'],
  ] },
];

export const FLOWS = FLOW_SPECS.map(makeFlow);
export const RELATION_KINDS = {
  load:    { label: 'LOAD',    color: '#a78bfa' },
  init:    { label: 'INIT',    color: '#60a5fa' },
  restore: { label: 'RESTORE', color: '#c084fc' },
  trigger: { label: 'TRIGGER', color: '#ffbf69' },
  call:    { label: 'CALL',    color: '#7f8cff' },
  event:   { label: 'EVENT',   color: '#4bd6c8' },
  sync:    { label: 'SYNC',    color: '#38bdf8' },
  apply:   { label: 'APPLY',   color: '#fb7185' },
  reload:  { label: 'RELOAD',  color: '#34d399' },
  extend:  { label: 'EXTEND',  color: '#f472b6' },
  cleanup: { label: 'CLEANUP', color: '#94a3b8' },
};

function flowById(id) {
  return FLOWS.find(flow => flow.id === id) ?? null;
}

export const GROUP_RELATIONS = [
  R('bootstrap-composition', 'App Lifecycle', 'App Lifecycle', 'init', 'tauri-bootstrap', 'frontend-composition', 'backend commands -> route services', 'Backend command registration provides the IPC surface consumed by frontend composition.'),
  R('composition-mount', 'App Lifecycle', 'App Lifecycle', 'load', 'frontend-composition', 'page-mount', 'route services -> mounted lifecycle', 'Composed page services are injected before mounted lifecycle starts.'),
  R('mount-engine', 'App Lifecycle', 'App Lifecycle', 'init', 'page-mount', 'engine-init', 'runPageEngineInit()', 'Mounted controllers initialize renderer and graph runtime.'),
  R('engine-render-loop', 'App Lifecycle', 'App Lifecycle', 'trigger', 'engine-init', 'render-loop', 'requestRender("initial")', 'Engine initialization schedules the first render frame.'),
  R('mount-workspace', 'App Lifecycle', 'Workspace', 'load', 'page-mount', 'workspace-tree-load', 'workspaceTree()', 'Initial mount requests active workspace settings and tree state.'),
  R('settings-mount', 'Settings', 'App Lifecycle', 'restore', 'durable-preferences', 'page-mount', 'DurablePreferenceSync.load()', 'Durable preferences feed controller state during page mount.'),
  R('workspace-registry-tree', 'Workspace', 'Workspace', 'reload', 'workspace-registry', 'workspace-tree-load', 'active workspace changed', 'Workspace registry changes reload tree and graph state.'),
  R('workspace-create-tree', 'Workspace', 'Workspace', 'event', 'workspace-create-file', 'workspace-tree-load', 'create -> reload tree', 'New files refresh workspace tree state.'),
  R('workspace-folder-tree', 'Workspace', 'Workspace', 'event', 'workspace-create-folder', 'workspace-tree-load', 'create folder -> reload tree', 'New folders refresh workspace tree state.'),
  R('workspace-move-tree', 'Workspace', 'Workspace', 'event', 'workspace-move-rename', 'workspace-tree-load', 'move/rename -> reload tree', 'Move and rename operations refresh tree state.'),
  R('workspace-copy-tree', 'Workspace', 'Workspace', 'event', 'workspace-external-copy', 'workspace-tree-load', 'external copy -> reload tree', 'External copies refresh tree state.'),
  R('workspace-trash-tree', 'Workspace', 'Workspace', 'cleanup', 'workspace-trash', 'workspace-tree-load', 'trash -> reload tree', 'Trash operations remove entries and refresh tree state.'),
  R('workspace-open-document', 'Workspace', 'Document & Editor', 'trigger', 'workspace-tree-load', 'document-open', 'row click -> openWorkspaceFile', 'Workspace rows trigger document open.'),
  R('document-save-reindex', 'Document & Editor', 'Search & Index', 'call', 'document-save', 'reindex', 'save -> reindexChangedPaths', 'Document saves refresh search and graph indexes.'),
  R('document-open-session', 'Document & Editor', 'Document & Editor', 'sync', 'document-open', 'editor-session', 'open editor -> persist session', 'Opened documents participate in editor session persistence.'),
  R('editor-close-session', 'Document & Editor', 'Document & Editor', 'cleanup', 'editor-close', 'editor-session', 'close editor -> persist session', 'Editor close updates persisted session layout.'),
  R('media-open-document', 'Document & Editor', 'Document & Editor', 'call', 'document-media-bytes', 'document-open', 'media resolve -> document context', 'Media reads are scoped to the active document context.'),
  R('reindex-graph', 'Search & Index', 'Graph', 'event', 'reindex', 'graph-snapshot', 'workspace-indexed -> reloadSnapshot', 'Index completion reloads graph snapshots.'),
  R('search-reindex', 'Search & Index', 'Search & Index', 'call', 'search', 'reindex', 'search depends on index data', 'Search results depend on current index data.'),
  R('graph-render', 'Graph', 'App Lifecycle', 'trigger', 'graph-snapshot', 'render-loop', 'snapshot applied -> requestRender', 'Graph snapshots invalidate rendering.'),
  R('graph-open-document', 'Graph', 'Document & Editor', 'trigger', 'graph-interaction', 'document-open', 'graph node click -> editor open', 'Graph node actions open matching documents.'),
  R('editor-graph-sync', 'Document & Editor', 'Graph', 'sync', 'editor-session', 'graph-interaction', 'active editor -> graph selection', 'Editor session state synchronizes graph selection and occupancy.'),
  R('zoom-render', 'Settings', 'App Lifecycle', 'apply', 'zoom', 'render-loop', 'zoom changed -> requestRender', 'Zoom changes invalidate frame rendering.'),
  R('theme-render', 'Settings', 'App Lifecycle', 'apply', 'theme', 'render-loop', 'theme changed -> render update', 'Theme changes update rendered UI state.'),
  R('community-theme', 'Extensions', 'Settings', 'reload', 'community', 'theme', 'theme package install -> reload themes', 'Community theme package changes reload theme options.'),
  R('chat-workspace', 'Extensions', 'Workspace', 'event', 'chat', 'workspace-tree-load', 'markdown write -> tree reload', 'Chat output writes workspace markdown and refreshes tree/index state.'),
  R('collab-document', 'Extensions', 'Document & Editor', 'extend', 'collaboration', 'document-open', 'collaboration attaches to editor document', 'Collaboration extends open document lifecycle.'),
  R('pdf-document', 'Extensions', 'Document & Editor', 'extend', 'pdf-annotations', 'document-open', 'PDF annotation document context', 'PDF annotations operate inside document editor context.'),
  R('anchor-document', 'Extensions', 'Document & Editor', 'extend', 'document-anchors', 'document-open', 'anchor lookup -> editor navigation', 'Document anchors extend editor navigation.'),
  R('system-document', 'Extensions', 'Document & Editor', 'call', 'system-actions', 'document-open', 'copy/reveal active document path', 'System actions often operate on active document paths.'),
  R('graph-cleanup', 'Graph', 'App Lifecycle', 'cleanup', 'graph-snapshot', 'page-unmount', 'GraphRuntime.destroy()', 'Unmount releases graph runtime resources.'),
  R('editor-cleanup', 'Document & Editor', 'App Lifecycle', 'cleanup', 'editor-session', 'page-unmount', 'persist session -> dispose', 'Unmount persists editor session and disposes editor resources.'),
  R('settings-cleanup', 'Settings', 'App Lifecycle', 'cleanup', 'theme', 'page-unmount', 'appTheme.dispose()', 'Unmount releases settings-related listeners.'),
];
export function R(id, from, to, kind, fromFlow, toFlow, via, description) {
  return { id, from, to, kind, fromFlow, toFlow, via, description };
}

export function makeFlow(spec) {
  return {
    id: spec.id,
    group: spec.group,
    title: spec.title,
    summary: spec.summary,
    trigger: spec.trigger,
    result: spec.result,
    tags: spec.tags,
    steps: spec.refs.map(([lane, title, call, source], index) => S(
      lane,
      title,
      call,
      `${title} through ${source}.`,
      call,
      source,
      index === spec.refs.length - 1 ? spec.result : `${title} completed`,
    )),
  };
}

export function S(lane, title, code, desc, call, source, result, meta = {}) {
  return {
    lane,
    title,
    code,
    desc,
    call,
    source,
    result,
    id: meta.id ?? '',
    inputs: normalizeList(meta.inputs),
    outputs: normalizeList(meta.outputs),
  };
}

export const CROSS_FUNCTION_EDGES = GROUP_RELATIONS.map(relation => {
  const fromFlow = flowById(relation.fromFlow);
  const toFlow = flowById(relation.toFlow);
  const fromStep = fromFlow?.steps.at(-1);
  const toStep = toFlow?.steps[0];
  return F(
    `${relation.id}:function`,
    relation.kind,
    relation.fromFlow,
    fromStep?.id || 1,
    relation.toFlow,
    toStep?.id || 1,
    fromStep?.call || relation.via,
    toStep?.call || relation.via,
    relation.via,
    relation.description,
    `${fromStep?.source || relation.fromFlow} -> ${toStep?.source || relation.toFlow}`,
  );
});


export function F(id, kind, fromFlow, fromStep, toFlow, toStep, fromFunction, toFunction, payload, effect, source) {
  return { id, kind, fromFlow, fromStep, toFlow, toStep, fromFunction, toFunction, payload, effect, source };
}

export function normalizeList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value == null || value === '') return [];
  return [String(value)];
}

export function stepIdFor(flowId, index) {
  return `${flowId}:${String(index + 1).padStart(2, '0')}`;
}

export function enrichFlowSteps() {
  FLOWS.forEach(flow => {
    flow.steps.forEach((step, index) => {
      step.id = step.id || stepIdFor(flow.id, index);
      step.flowId = flow.id;
      step.index = index;
      step.inputs = normalizeList(step.inputs);
      step.outputs = normalizeList(step.outputs);
      if (!step.inputs.length) {
        step.inputs = [index === 0 ? `Trigger: ${flow.trigger}` : flow.steps[index - 1].result];
      }
      if (!step.outputs.length) {
        step.outputs = [step.result];
      }
    });
  });
}

export function resolveStepId(flowId, selector) {
  const flow = flowById(flowId);
  if (!flow) throw new Error(`Unknown flow: ${flowId}`);
  if (Number.isInteger(selector)) {
    const step = flow.steps[selector - 1];
    if (!step) throw new Error(`Unknown step index ${selector} in ${flowId}`);
    return step.id;
  }
  const selectorText = String(selector);
  const direct = flow.steps.find(step => step.id === selectorText);
  if (direct) return direct.id;
  const query = selectorText.toLowerCase();
  const matched = flow.steps.find(step => [
    step.title,
    step.code,
    step.call,
    step.source,
  ].some(value => String(value).toLowerCase().includes(query)));
  if (!matched) throw new Error(`Unknown step selector "${selectorText}" in ${flowId}`);
  return matched.id;
}

export function normalizeFunctionEdge(edge) {
  return {
    ...edge,
    fromStep: resolveStepId(edge.fromFlow, edge.fromStep),
    toStep: resolveStepId(edge.toFlow, edge.toStep),
  };
}

export function buildSequentialFunctionEdges() {
  return FLOWS.flatMap(flow => flow.steps.slice(0, -1).map((step, index) => {
    const next = flow.steps[index + 1];
    return F(
      `${flow.id}:${String(index + 1).padStart(2, '0')}-to-${String(index + 2).padStart(2, '0')}`,
      'internal',
      flow.id,
      step.id,
      flow.id,
      next.id,
      step.call,
      next.call,
      step.outputs.join('; '),
      next.inputs.join('; '),
      `${step.source} -> ${next.source}`,
    );
  }));
}

enrichFlowSteps();
export const FUNCTION_EDGES = [
  ...buildSequentialFunctionEdges(),
  ...CROSS_FUNCTION_EDGES.map(normalizeFunctionEdge),
];

