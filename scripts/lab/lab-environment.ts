import { isLoopbackHost, requiredEnvironment } from "@aiengineer/service-application";

/**
 * The one place mapping the lab stack's `supabase status -o env` names to the service's names (docs/ENVIRONMENT.md).
 * Newer CLIs print PUBLISHABLE_KEY / SECRET_KEY; older ones ANON_KEY / SERVICE_ROLE_KEY (same roles).
 */
export const SUPABASE_STATUS_TO_AIENG_DB = {
  API_URL: "AIENG_DB_URL",
  PUBLISHABLE_KEY: "AIENG_DB_PUBLISHABLE_KEY",
  ANON_KEY: "AIENG_DB_PUBLISHABLE_KEY",
  SECRET_KEY: "AIENG_DB_SECRET_KEY",
  SERVICE_ROLE_KEY: "AIENG_DB_SECRET_KEY",
} as const;

/** Connection details of the disposable Supabase lab stack (the same variables the service reads); never printed. */
export interface LabEnvironment {
  readonly databaseUrl: string;
  readonly publishableKey: string;
  readonly secretKey: string;
}

export function readLabEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): LabEnvironment {
  const hint = "put it in .env.lab from `supabase status -o env` of the lab workdir; mapping in docs/ENVIRONMENT.md";
  const databaseUrl = requiredEnvironment(environment, "AIENG_DB_URL", hint);
  // The lab creates users and writes fixture data: it never runs against a remote database.
  if (!isLoopbackHost(new URL(databaseUrl).hostname)) {
    throw new Error(
      "LAB_NOT_LOOPBACK: AIENG_DB_URL must be the loopback lab stack (.env.lab), never a remote database",
    );
  }
  return {
    databaseUrl,
    publishableKey: requiredEnvironment(environment, "AIENG_DB_PUBLISHABLE_KEY", hint),
    secretKey: requiredEnvironment(environment, "AIENG_DB_SECRET_KEY", hint),
  };
}

export interface LabUser {
  readonly id: string;
  readonly accessToken: string;
}

/** Creates a real Auth user on the disposable stack and signs in. */
export async function createLabUser(lab: LabEnvironment, label: string): Promise<LabUser> {
  const email = `${label}-${crypto.randomUUID().slice(0, 8)}@lab.invalid`;
  const password = crypto.randomUUID();
  const admin = {
    apikey: lab.secretKey,
    authorization: `Bearer ${lab.secretKey}`,
    "content-type": "application/json",
  };
  const created = await fetch(`${lab.databaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: admin,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!created.ok) throw new Error(`USER_CREATE_FAILED: ${created.status}`);
  const { id } = (await created.json()) as { id: string };
  const session = await fetch(`${lab.databaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: lab.publishableKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!session.ok) throw new Error(`SIGN_IN_FAILED: ${session.status}`);
  const { access_token: accessToken } = (await session.json()) as { access_token: string };
  return { id, accessToken };
}

/** Calls a worker operation directly; the lab script plays the worker role (e.g. indexing passages). */
export async function runWorker(
  lab: LabEnvironment,
  operation: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`${lab.databaseUrl}/rest/v1/rpc/product_worker`, {
    method: "POST",
    headers: {
      apikey: lab.secretKey,
      authorization: `Bearer ${lab.secretKey}`,
      "content-type": "application/json",
      "content-profile": "api",
    },
    body: JSON.stringify({ p_operation: operation, p_payload: payload }),
  });
  if (!response.ok) throw new Error(`WORKER_FAILED: ${operation} ${response.status} ${await response.text()}`);
  return response.json();
}
