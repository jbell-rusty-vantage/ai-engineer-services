import type {
  AssetUploadInput,
  AssetUploadResult,
  CommandInput,
  JsonObject,
  ProductPort,
  ReadInput,
} from "@aiengineer/service-contracts";
import type { ProductService } from "./product-service.js";
import type { CallerSession } from "./session.js";

/** In-process `ProductPort` bound to one caller; used by the remote MCP server. */
export class SessionProductPort implements ProductPort {
  constructor(
    private readonly service: ProductService,
    private readonly session: CallerSession,
  ) {}

  command(operation: string, input: CommandInput): Promise<JsonObject> {
    return this.service.runCommand(this.session, operation, input);
  }

  read(operation: string, input: ReadInput): Promise<unknown> {
    return this.service.runRead(this.session, operation, input);
  }

  uploadAsset(metadata: AssetUploadInput, bytes: Uint8Array): Promise<AssetUploadResult> {
    return this.service.uploadAsset(this.session, metadata, bytes);
  }
}
