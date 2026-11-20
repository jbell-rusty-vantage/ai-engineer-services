import { type Environment, loadServiceConfig, type ServiceConfig } from "./config.js";
import { PostgrestDatabaseGateway } from "./database-gateway.js";
import {
  checkDatabaseRelease,
  type DatabaseReleaseCheck,
  type DatabaseReleaseCheckOptions,
} from "./database-release.js";
import { PostgrestKnowledgeDatabase } from "./knowledge/knowledge-database.js";
import { KnowledgeService } from "./knowledge/knowledge-service.js";
import { SupabaseObjectStorage } from "./object-storage.js";
import { ProductService } from "./product-service.js";
import { SchemaWorkspace } from "./schema/schema-workspace.js";
import { resolveSchemaWorkspaceDirectory } from "./schema/schema-workspace-location.js";

export * from "./artifact-custody.js";
export * from "./config.js";
export * from "./database-gateway.js";
export * from "./database-release.js";
export * from "./knowledge/knowledge-database.js";
export * from "./knowledge/knowledge-service.js";
export * from "./object-storage.js";
export * from "./pinned-contract.js";
export { PostgrestTransport } from "./postgrest-transport.js";
export * from "./product-service.js";
export * from "./schema/schema-workspace.js";
export * from "./schema/schema-workspace-location.js";
export * from "./session.js";
export * from "./session-port.js";

/** Composes the product service against the configured Supabase project. */
export function createProductService(config: ServiceConfig = loadServiceConfig()): ProductService {
  return new ProductService(
    new PostgrestDatabaseGateway(config),
    new SupabaseObjectStorage(config),
    new KnowledgeService(new PostgrestKnowledgeDatabase(config)),
  );
}

/**
 * The check an in-process transport (API, remote MCP) runs when it starts: asks the configured database for its
 * release with the service key and applies the rule in the configured mode (features/database-release-check.md).
 */
export function createDatabaseReleaseCheck(
  config: ServiceConfig = loadServiceConfig(),
  options: Omit<DatabaseReleaseCheckOptions, "mode"> = {},
): DatabaseReleaseCheck {
  const database = new PostgrestDatabaseGateway(config);
  return () => checkDatabaseRelease(database, { ...options, mode: config.databaseReleaseCheck });
}

/** Schema navigation over the configured (or sibling) generated schema workspace; file reads only. */
export function createSchemaWorkspace(environment: Environment = process.env): SchemaWorkspace {
  return new SchemaWorkspace(resolveSchemaWorkspaceDirectory(environment));
}
