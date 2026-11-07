import { loadServiceConfig, type ServiceConfig } from "./config.js";
import { PostgrestDatabaseGateway } from "./database-gateway.js";
import { SupabaseObjectStorage } from "./object-storage.js";
import { ProductService } from "./product-service.js";

export * from "./artifact-custody.js";
export * from "./config.js";
export * from "./database-gateway.js";
export * from "./object-storage.js";
export * from "./product-service.js";
export * from "./session.js";
export * from "./session-port.js";

/** Composes the product service against the configured Supabase project. */
export function createProductService(config: ServiceConfig = loadServiceConfig()): ProductService {
  return new ProductService(new PostgrestDatabaseGateway(config), new SupabaseObjectStorage(config));
}
