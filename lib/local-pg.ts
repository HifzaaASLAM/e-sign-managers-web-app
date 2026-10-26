import path from "node:path";

const globalForPg = globalThis as unknown as {
  localPg?: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  };
};

export function isLocalPgEnabled() {
  return process.env.USE_LOCAL_PG === "true";
}

export function getLocalPgDataDir() {
  return path.join(process.cwd(), "prisma", "pglite-data");
}

export function getLocalPg() {
  if (!isLocalPgEnabled()) {
    throw new Error("Local PG is disabled.");
  }

  if (!globalForPg.localPg) {
    // Hide from webpack static analysis so Hostinger production builds do not
    // require @electric-sql/pglite unless USE_LOCAL_PG=true at runtime.
    // eslint-disable-next-line no-eval, @typescript-eslint/no-unsafe-call
    const req = eval("require") as NodeRequire;
    const { PGlite } = req("@electric-sql/pglite") as {
      PGlite: new (dir: string) => {
        query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
      };
    };
    globalForPg.localPg = new PGlite(getLocalPgDataDir());
  }

  return globalForPg.localPg;
}
