import { z } from "zod";
import { defineTool } from "./tool-definition.js";

const id = z.guid();

export const proposeResearch = defineTool({
  name: "propose_research",
  title: "Propose research",
  description:
    "Submit a research brief revision as a proposal. The brief's metadata.research (aieng.research-brief.v1) states the " +
    "question, plan, world window, budget_limit_usd and the outputs (obligations) the research must deliver. Returns the " +
    "problems to fix, or valid. Only a person can accept the proposal and its budget.",
  input: z.object({
    workspace_id: id,
    revision_id: id.describe("Brief revision to propose (write it first with draft_work, kind brief)"),
  }),
  run: (context, input) =>
    context.port.command("propose_research", {
      workspaceId: input.workspace_id,
      payload: { revision_id: input.revision_id },
    }),
});

const inspectTargets = {
  acceptance: "get_acceptance",
  dataset: "get_dataset",
  statement: "trace_assertion",
  source_usage: "trace_reverse",
} as const;

export const inspectResearch = defineTool({
  name: "inspect_research",
  title: "Inspect research",
  description:
    "Read research state. acceptance: obligations, deliveries and whether they are fulfilled. dataset: a fixed revision " +
    "(or the draft) with value statuses and support counts. statement: the evidence behind one statement (quotes, source " +
    "URLs, stored-byte digests, calculations, decisions) or that it has none. source_usage: every statement, value, " +
    "dataset revision, report and delivery that uses a source document.",
  input: z.object({
    workspace_id: id,
    what: z.enum(["acceptance", "dataset", "statement", "source_usage"]),
    id: id.describe("Acceptance, dataset work, statement or source document revision id"),
    revision_no: z.number().int().min(1).optional().describe("dataset only; default the latest revision"),
    draft: z.boolean().optional().describe("dataset only; read the uncommitted draft"),
  }),
  run: (context, input) => {
    const payload =
      input.what === "acceptance"
        ? { acceptance_id: input.id }
        : input.what === "dataset"
          ? {
              dataset_work_id: input.id,
              ...(input.revision_no ? { revision_no: input.revision_no } : {}),
              ...(input.draft ? { draft: true } : {}),
            }
          : input.what === "statement"
            ? { assertion_id: input.id }
            : { source_revision_ids: [input.id] };
    return context.port.read(inspectTargets[input.what], { workspaceId: input.workspace_id, payload });
  },
});

const cell = z.object({
  row_key: id,
  field_key: id,
  value: z.unknown().optional(),
  value_status: z.enum([
    "observed",
    "calculated",
    "inferred",
    "estimated",
    "unknown",
    "not_found",
    "undisclosed",
    "conflicting",
    "not_applicable",
  ]),
  observed_at: z.string().optional(),
});

export const updateDataset = defineTool({
  name: "update_dataset",
  title: "Update a dataset",
  description:
    "Change a research dataset. draft: edit the working draft directly (your own dataset, before it is committed). " +
    "proposal: propose a reviewable change to the latest fixed revision (refresh, correction, watch); a person applies it, " +
    "an identical proposal is reported as a duplicate and a refresh with no changed values creates nothing. Every value " +
    "carries a status: undisclosed, not_found, conflicting and not_applicable are different from unknown.",
  input: z.object({
    workspace_id: id,
    dataset_work_id: id,
    mode: z.enum(["draft", "proposal"]),
    cells: z.array(cell).default([]),
    rows_add: z.array(z.object({ row_key: id.optional(), label: z.string(), entity_id: id.optional() })).optional(),
    rows_remove: z.array(id).optional(),
    base_revision_no: z.number().int().min(1).optional().describe("proposal only: the latest fixed revision"),
    reason: z.enum(["refresh", "correction", "watch", "agent_edit", "import"]).optional(),
    dedupe_key: z.string().optional().describe("proposal only: stable key so a repeated refresh is not proposed twice"),
    explanation: z.string().optional(),
  }),
  run: (context, input) => {
    const rows = {
      ...(input.rows_add ? { rows_add: input.rows_add } : {}),
      ...(input.rows_remove ? { rows_remove: input.rows_remove } : {}),
    };
    if (input.mode === "draft") {
      return context.port.command("edit_dataset", {
        workspaceId: input.workspace_id,
        payload: { dataset_work_id: input.dataset_work_id, cells: input.cells, ...rows },
      });
    }
    return context.port.command("propose_dataset_change", {
      workspaceId: input.workspace_id,
      payload: {
        dataset_work_id: input.dataset_work_id,
        base_revision_no: input.base_revision_no,
        reason: input.reason ?? "refresh",
        dedupe_key: input.dedupe_key,
        cells: input.cells,
        ...rows,
        ...(input.explanation ? { explanation: input.explanation } : {}),
      },
    });
  },
});

export const citeEvidence = defineTool({
  name: "cite_evidence",
  title: "Cite evidence",
  description:
    "Record why a statement or a dataset value says what it says: supports, contradicts or qualifies (quote exact lines " +
    "from a stored source document), calculated_from (expression and input cells), inferred_by (a decision answer) or " +
    "context. Contradicting evidence is kept, never replaced. Citing does not make a claim true; it records who judged " +
    "which exact evidence.",
  input: z.object({
    workspace_id: id,
    statement_id: id.optional(),
    dataset_work_id: id.optional(),
    row_key: id.optional(),
    field_key: id.optional(),
    cell_id: id.optional(),
    role: z.enum(["supports", "contradicts", "qualifies", "context", "calculated_from", "inferred_by"]),
    source_revision_id: id.optional().describe("A stored source document revision"),
    quotes: z.array(z.string().min(1)).optional().describe("Exact lines from the source, in document order"),
    target: z
      .object({ kind: z.enum(["cell", "decision", "claim", "assertion"]), id, answer_key: z.string().optional() })
      .optional(),
    method: z.object({ expression: z.string(), inputs: z.array(id) }).optional(),
  }),
  run: (context, input) => {
    const subject = input.statement_id
      ? { assertion_id: input.statement_id }
      : {
          dataset_work_id: input.dataset_work_id,
          ...(input.row_key ? { row_key: input.row_key } : {}),
          ...(input.field_key ? { field_key: input.field_key } : {}),
          ...(input.cell_id ? { cell_id: input.cell_id } : {}),
        };
    const source = input.source_revision_id
      ? {
          target: { kind: "source_revision", id: input.source_revision_id },
          ...(input.quotes
            ? {
                selector: { type: "aieng.text-quotes.v1", quotes: input.quotes },
                excerpt: input.quotes.join(" … "),
              }
            : {}),
        }
      : input.target
        ? { target: input.target }
        : {};
    return context.port.command("add_support", {
      workspaceId: input.workspace_id,
      payload: { subject, role: input.role, ...source, ...(input.method ? { method: input.method } : {}) },
    });
  },
});

export const deliverOutput = defineTool({
  name: "deliver_output",
  title: "Deliver a research output",
  description:
    "Offer a dataset, report or experience revision (or a file / file set) against one obligation of accepted research. " +
    "A person accepts or rejects it; the agent that produced it cannot accept its own delivery.",
  input: z.object({
    workspace_id: id,
    obligation_id: id,
    revision_id: id.optional(),
    artifact_id: id.optional(),
    file_set_id: id.optional(),
  }),
  run: (context, input) => {
    const { workspace_id, ...payload } = input;
    return context.port.command("deliver_output", { workspaceId: workspace_id, payload });
  },
});
