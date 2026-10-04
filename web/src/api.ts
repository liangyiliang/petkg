import type { EngineConfig, Formula, GraphPayload, Meta, PetProfile } from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* not json */
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json() as Promise<T>;
}

export const api = {
  meta: () => fetch("/api/meta").then((r) => json<Meta>(r)),
  graph: () => fetch("/api/graph").then((r) => json<GraphPayload>(r)),
  examples: () => fetch("/api/examples").then((r) => json<PetProfile[]>(r)),
  formulate: (pet: PetProfile, config?: EngineConfig) =>
    fetch("/api/formulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...pet, config }),
    }).then((r) => json<Formula>(r)),
};
