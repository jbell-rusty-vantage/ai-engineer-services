import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { type JsonObject, ProductError, type ProductPort } from "@aiengineer/service-contracts";

export interface SiteFile {
  /** Relative POSIX path inside the site, e.g. `assets/app.js`. */
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface PublishSiteInput {
  readonly workspaceId: string;
  readonly entrypoint: string;
  readonly files: readonly SiteFile[];
  readonly environment?: "preview" | "published";
  readonly usage?: "private_copy" | "redistributable";
  readonly rightsBasis?: string;
}

export interface PublishedSite {
  readonly fileSetId: string;
  readonly treeSha256: string;
  readonly deploymentId: string;
  readonly url: string;
  readonly status: string;
  readonly files: number;
}

const mediaTypes: Readonly<Record<string, string>> = {
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

export function mediaTypeForPath(path: string): string {
  return mediaTypes[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** Reads every file under a local directory (skipping dot-files and node_modules) as site files. */
export async function collectDirectoryFiles(directory: string, limit = 500): Promise<SiteFile[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files: SiteFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = join(entry.parentPath, entry.name);
    const path = relative(directory, absolute).split(sep).join("/");
    if (path.split("/").some((segment) => segment.startsWith(".") || segment === "node_modules")) continue;
    if (files.length >= limit) throw new ProductError("LIMIT_EXCEEDED", `more than ${limit} files`);
    files.push({ path, bytes: new Uint8Array(await readFile(absolute)) });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Publishes a harness- or author-built site: uploads each file as a verified artifact, registers the file set and
 * records an isolated-origin platform deployment. Works against any `ProductPort` (in process or over HTTP).
 */
export async function publishSite(port: ProductPort, input: PublishSiteInput): Promise<PublishedSite> {
  if (!input.files.some((file) => file.path === input.entrypoint))
    throw new ProductError("VALIDATION", "entrypoint is not one of the files");
  const uploaded: JsonObject[] = [];
  for (const file of input.files) {
    const asset = await port.uploadAsset(
      {
        workspaceId: input.workspaceId,
        artifactType: "experience_bundle",
        mediaType: mediaTypeForPath(file.path),
        usage: input.usage ?? "redistributable",
        rightsBasis: input.rightsBasis ?? "built by the author for this workspace",
      },
      file.bytes,
    );
    uploaded.push({ path: file.path, artifact_id: asset.artifactId });
  }
  const fileSet = await port.command("register_file_set", {
    workspaceId: input.workspaceId,
    payload: { entrypoint: input.entrypoint, files: uploaded },
  });
  const deployment = await port.command("record_deployment", {
    workspaceId: input.workspaceId,
    payload: { target: "platform_static", environment: input.environment ?? "preview", file_set_id: fileSet.fileSetId },
  });
  return {
    fileSetId: String(fileSet.fileSetId),
    treeSha256: String(fileSet.treeSha256),
    deploymentId: String(deployment.deploymentId),
    url: String(deployment.url),
    status: String(deployment.status),
    files: uploaded.length,
  };
}
