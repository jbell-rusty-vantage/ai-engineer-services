/**
 * The agent-facing surface in one place: the jobs an agent comes with, the MCP tool for each and the `aieng` command
 * for each. The MCP server takes its tool names and descriptions from here, the CLI its usage text, and the guide its
 * lists, so none of them can name something the others do not have.
 */

export const guideTopics = [
  "knowledge",
  "schema",
  "authoring",
  "research",
  "datasets",
  "learning",
  "workspace",
] as const;
export type GuideTopic = (typeof guideTopics)[number];

export interface SurfaceJob {
  readonly id: string;
  readonly label: string;
  readonly topic: GuideTopic;
  /** MCP tools for the job, the one to start with first. */
  readonly tools: readonly string[];
  /** The operation the index names for this job when no friendly command exists. */
  readonly operation?: string;
}

export const surfaceJobs = [
  {
    id: "find_knowledge",
    label: "Find what the knowledge base knows and how well it is supported",
    topic: "knowledge",
    tools: ["search_knowledge"],
  },
  { id: "read_knowledge", label: "Read one claim, entity or source", topic: "knowledge", tools: ["inspect_knowledge"] },
  { id: "see_due", label: "See what is stale or due for review", topic: "knowledge", tools: ["inspect_knowledge"] },
  {
    id: "navigate_schema",
    label: "Find where something lives in the schema",
    topic: "schema",
    tools: ["schema_search", "schema_get"],
  },
  {
    id: "author_content",
    label: "Author and release a course, module, lesson, activity or artifact",
    topic: "authoring",
    tools: ["draft_work", "inspect_authoring", "request_review", "publish_built_site"],
    operation: "create_work",
  },
  {
    id: "request_research",
    label: "Request research and deliver it",
    topic: "research",
    tools: ["propose_research", "inspect_research", "cite_evidence", "deliver_output"],
    operation: "propose_research",
  },
  {
    id: "work_with_datasets",
    label: "Work with datasets",
    topic: "datasets",
    tools: ["update_dataset", "inspect_research", "cite_evidence"],
    operation: "create_dataset",
  },
  {
    id: "study_and_practise",
    label: "Study and practise",
    topic: "learning",
    tools: [
      "search_learning",
      "read_lesson",
      "annotate_lesson_block",
      "check_progress",
      "start_attempt",
      "submit_attempt",
    ],
  },
  {
    id: "manage_workspace",
    label: "Manage workspaces and access",
    topic: "workspace",
    tools: [],
    operation: "ensure_personal_workspace",
  },
] as const satisfies readonly SurfaceJob[];

export type SurfaceJobId = (typeof surfaceJobs)[number]["id"];

export interface SurfaceTool {
  readonly name: string;
  readonly title: string;
  /** The MCP tool description: one line. Depth lives in the guide and in `aieng_describe`. */
  readonly summary: string;
  /** Catalog operations the tool calls. */
  readonly operations: readonly string[];
}

export const surfaceTools: readonly SurfaceTool[] = [
  {
    name: "aieng_guide",
    title: "Guide",
    summary: "Start here: the jobs this server does and the tool for each. Pass a topic for the full how-to.",
    operations: [],
  },
  {
    name: "aieng_describe",
    title: "Describe an operation",
    summary: "One operation's input schema, output shape and an example call; or the operations a tool calls.",
    operations: [],
  },
  {
    name: "search_knowledge",
    title: "Search the knowledge base",
    summary:
      "Keyword search over the industry knowledge base and its evidence. Hits carry an evidence signal and what to read next.",
    operations: ["search_knowledge"],
  },
  {
    name: "inspect_knowledge",
    title: "Inspect knowledge",
    summary:
      "Read one claim, an entity card or library dossier, the evidence of a fact or summary, an entity's changes, a source's track record, or what is due.",
    operations: [
      "get_claim",
      "get_entity",
      "get_fact_evidence",
      "list_entity_changes",
      "get_summary_evidence",
      "get_source",
      "list_due",
    ],
  },
  {
    name: "schema_search",
    title: "Search the schema",
    summary: "Find where something lives in the database schema: relations, functions, operations, tasks and terms.",
    operations: [],
  },
  {
    name: "schema_get",
    title: "Read a schema page",
    summary: "Read one schema workspace page by its path; without a page, the entry page.",
    operations: [],
  },
  {
    name: "search_learning",
    title: "Search my learning",
    summary:
      "Search the caller's notes, uploaded sources, conversations and released course material; results are labelled with exact locators.",
    operations: ["search"],
  },
  {
    name: "read_lesson",
    title: "Read a lesson",
    summary:
      "Render a revision you can read (a lesson, module, activity or other work): its blocks with stable keys and your private notes on them.",
    operations: ["get_lesson_view"],
  },
  {
    name: "annotate_lesson_block",
    title: "Annotate a lesson block",
    summary: "Save a private note or a generated explainer anchored to one block of a lesson.",
    operations: ["ensure_personal_workspace", "create_work"],
  },
  {
    name: "check_progress",
    title: "Check course progress",
    summary: "Which requirements of the adopted course release are met, computed from active credit.",
    operations: ["progress"],
  },
  {
    name: "draft_work",
    title: "Draft or revise a work",
    summary:
      "Create a work (course, module, lesson, activity, brief and more) or save a new revision: body, bindings and structure (parts, outcomes, requirements).",
    operations: ["create_work", "revise_work", "list_works", "get_revision"],
  },
  {
    name: "inspect_authoring",
    title: "Inspect authoring",
    summary:
      "Read authoring state: your workspaces, a workspace's works, one work or revision with its structure, an exposure preview, a thread, or review feedback.",
    operations: [
      "ensure_personal_workspace",
      "list_workspaces",
      "list_works",
      "get_revision",
      "get_report",
      "get_revision_structure",
      "preview_exposure",
      "get_thread",
      "list_reviews",
    ],
  },
  {
    name: "request_review",
    title: "Request a review",
    summary:
      "Hand a revision to a person: preview its exposure, leave your note in a workspace conversation, mark it ready for review. Records no review.",
    operations: [
      "get_revision",
      "preview_exposure",
      "create_thread",
      "append_message",
      "mark_ready_for_review",
      "deliver_output",
    ],
  },
  {
    name: "publish_built_site",
    title: "Publish a built site",
    summary:
      "Publish a built site as one verified file set with a preview deployment. Local server: a directory; remote: base64 files.",
    operations: ["register_file_set", "record_deployment"],
  },
  {
    name: "start_attempt",
    title: "Start an attempt",
    summary: "Start a practice or official attempt at a task under declared conditions.",
    operations: ["ensure_personal_workspace", "start_attempt"],
  },
  {
    name: "submit_attempt",
    title: "Submit an attempt",
    summary: "Freeze a submission of fixed evidence for an attempt.",
    operations: ["ensure_personal_workspace", "submit_attempt"],
  },
  {
    name: "propose_research",
    title: "Propose research",
    summary: "Validate a research brief revision as a proposal; only a person can accept it and its budget.",
    operations: ["propose_research"],
  },
  {
    name: "inspect_research",
    title: "Inspect research",
    summary:
      "Read research state: an acceptance, a dataset revision, the evidence behind a statement, or a source's usage.",
    operations: ["get_acceptance", "get_dataset", "trace_assertion", "trace_reverse"],
  },
  {
    name: "update_dataset",
    title: "Update a dataset",
    summary: "Edit a dataset draft, or propose a reviewed change to its latest fixed revision.",
    operations: ["edit_dataset", "propose_dataset_change"],
  },
  {
    name: "cite_evidence",
    title: "Cite evidence",
    summary:
      "Record support, contradiction, a qualifier, a calculation or an inference for a statement or a dataset value.",
    operations: ["add_support"],
  },
  {
    name: "deliver_output",
    title: "Deliver a research output",
    summary: "Offer a revision, file or file set against a research obligation; a person accepts or rejects it.",
    operations: ["deliver_output"],
  },
];

export interface SurfaceCommand {
  /** The words after `aieng` that select the command, for example `["knowledge", "search"]`. */
  readonly path: readonly string[];
  /** Arguments and options, as shown in the usage text. */
  readonly arguments: string;
  /** Empty for commands that serve every job. */
  readonly jobs: readonly SurfaceJobId[];
}

export const surfaceCommands: readonly SurfaceCommand[] = [
  { path: ["guide"], arguments: "[topic | skill | skill/references/name]", jobs: [] },
  { path: ["describe"], arguments: "<operation>", jobs: [] },
  { path: ["operations"], arguments: "", jobs: [] },
  {
    path: ["knowledge", "search"],
    arguments:
      "<query> [--lens corpus,evidence] [--tier <0-4,...>] [--space <slug,...>] [--kind <kind,...>] [--as-of <time>] [--limit <n>] [--no-collapse]",
    jobs: ["find_knowledge"],
  },
  { path: ["knowledge", "claim"], arguments: "<claim-id>", jobs: ["read_knowledge"] },
  { path: ["knowledge", "entity"], arguments: "<entity-id> | --library <slug>", jobs: ["read_knowledge"] },
  {
    path: ["knowledge", "facts"],
    arguments: "<entity-id> --kind <stream-kind> [--scope <scope-key>] [--limit <n>]",
    jobs: ["read_knowledge"],
  },
  {
    path: ["knowledge", "changes"],
    arguments: "<entity-id> [--after <seq>] [--through <seq>] [--limit <n>]",
    jobs: ["read_knowledge"],
  },
  { path: ["knowledge", "summary"], arguments: "<summary-id> [--limit <n>]", jobs: ["read_knowledge"] },
  { path: ["knowledge", "source"], arguments: "<source-entity-id> | --name <name>", jobs: ["read_knowledge"] },
  {
    path: ["knowledge", "due"],
    arguments: "[--as-of <time>] [--since <time>] [--release <release-id>] [--limit <n>]",
    jobs: ["see_due"],
  },
  { path: ["authoring", "workspaces"], arguments: "[--writable]", jobs: ["author_content"] },
  { path: ["authoring", "structure"], arguments: "<revision-id>", jobs: ["author_content"] },
  {
    path: ["authoring", "ready"],
    arguments: "<revision-id> --workspace <id> --note <text> [--thread <id>]",
    jobs: ["author_content"],
  },
  {
    path: ["authoring", "reviews"],
    arguments: "--workspace <id> [--revision <id>] [--status <status>]",
    jobs: ["author_content"],
  },
  { path: ["schema", "search"], arguments: "<query> [--kind <kind>] [--limit <n>]", jobs: ["navigate_schema"] },
  { path: ["schema", "get"], arguments: "[page]", jobs: ["navigate_schema"] },
  { path: ["search"], arguments: "<query> [--limit <n>]", jobs: ["study_and_practise"] },
  {
    path: ["command"],
    arguments: "<operation> [--workspace <id>] [--head <id>] [--key <idempotency-key>] [--payload <json|@file>]",
    jobs: [],
  },
  { path: ["read"], arguments: "<operation> [--workspace <id>] [--payload <json|@file>]", jobs: [] },
  {
    path: ["upload"],
    arguments: "<file> --workspace <id> --usage <usage> --rights <text> [--type <artifact-type>] [--media <type>]",
    jobs: ["author_content"],
  },
  {
    path: ["site", "publish"],
    arguments: "<directory> --workspace <id> [--entry index.html] [--environment preview|published]",
    jobs: ["author_content"],
  },
];

export function findSurfaceTool(name: string): SurfaceTool | undefined {
  return surfaceTools.find((tool) => tool.name === name);
}

/** The usage line of a command: `aieng knowledge claim <claim-id>`. */
export function commandUsage(command: SurfaceCommand): string {
  return ["aieng", ...command.path, command.arguments].filter(Boolean).join(" ");
}

/** The command whose path starts the given words, longest path first: `["site", "publish", "./dist"]` → site publish. */
export function findSurfaceCommand(words: readonly string[]): SurfaceCommand | undefined {
  return [...surfaceCommands]
    .sort((left, right) => right.path.length - left.path.length)
    .find((command) => command.path.every((word, index) => words[index] === word));
}
