import { z } from "zod";
import { parse, stringify } from "yaml";

export const text = z.string().trim().min(1).max(20000);
const id = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/);
const version = z.literal(1);
export const roleSchema = z
  .object({
    schemaVersion: version,
    kind: z.literal("role"),
    id,
    roleType: z.enum(["judge", "prosecutor", "juror", "witness"]),
    name: text,
    personality: text,
    background: text,
    occupation: text,
    age: z.number().int().min(18).max(100).optional(),
    gender: text.optional(),
    ethnicity: text.optional(),
    annualIncome: z.number().min(0).optional(),
  })
  .strict();
export type RoleProfile = z.infer<typeof roleSchema>;
const qa = z.object({ question: text, answer: text }).strict();
const evidenceBase = { id, title: text, description: text, purpose: text };
export const evidenceSchema = z.discriminatedUnion("kind", [
  z.object({ ...evidenceBase, kind: z.literal("exhibit") }).strict(),
  z
    .object({
      ...evidenceBase,
      kind: z.literal("witness"),
      profile: roleSchema.refine(
        (r) => r.roleType === "witness",
        "必须为 witness 角色",
      ),
      privateKnowledge: text,
      responses: z
        .array(z.object({ cues: z.array(text).min(1), answer: text }).strict())
        .optional(),
      directExamination: z.array(qa).min(1).max(30),
      judgeExamination: z.array(qa).max(30),
    })
    .strict(),
]);
export type EvidenceProfile = z.infer<typeof evidenceSchema>;
export const caseSchema = z
  .object({
    schemaVersion: version,
    kind: z.literal("case"),
    id,
    title: text,
    court: text,
    docket: text,
    defendant: text,
    defendantBiography: text.optional(),
    synopsis: text.optional(),
    charge: text,
    background: text,
    legalElements: z.array(text).min(1).max(20),
    juryInstructions: text,
    prosecutionOpening: text,
    defenseOpening: text,
    prosecutionClosing: text,
    defenseClosing: text,
    prosecutionEvidence: z.array(evidenceSchema).max(30),
    defenseEvidence: z.array(evidenceSchema).max(30),
  })
  .strict();
export type CaseProfile = z.infer<typeof caseSchema>;
const weighted = <T extends z.ZodType>(value: T) =>
  z
    .array(
      z
        .object({
          value,
          weight: z.number().finite().positive().max(1000000),
        })
        .strict(),
    )
    .min(1)
    .max(200);
const bands = z
  .array(
    z
      .object({
        min: z.number().int().nonnegative(),
        max: z.number().int().nonnegative(),
        weight: z.number().finite().positive().max(1000000),
      })
      .strict()
      .refine((b) => b.max >= b.min, "max 必须大于等于 min"),
  )
  .min(1)
  .max(50);
export const weightedJuryPoolSchema = z
  .object({
    schemaVersion: version,
    kind: z.literal("jury-pool"),
    firstNames: weighted(z.object({ name: text, gender: text }).strict()),
    lastNames: weighted(text),
    occupations: weighted(text),
    ethnicities: weighted(text),
    personalities: weighted(text),
    experiences: weighted(text),
    ages: bands.refine(
      (bs) => bs.every((b) => b.min >= 18 && b.max <= 100),
      "陪审员年龄须在 18–100 之间",
    ),
    incomes: bands,
  })
  .strict();
const portraitPoolSchema = z
  .object({
    schemaVersion: version,
    kind: z.literal("jury-pool"),
    portraits: z
      .array(
        roleSchema.refine((r) => r.roleType === "juror", "候选人必须为陪审员"),
      )
      .min(12)
      .max(200)
      .refine(
        (people) =>
          new Set(people.map((p) => p.id)).size === people.length &&
          new Set(people.map((p) => p.name)).size === people.length,
        "候选人姓名和 ID 必须唯一",
      ),
  })
  .strict();
export const juryPoolSchema = z.union([
  weightedJuryPoolSchema,
  portraitPoolSchema,
]);
export type JuryPool = z.infer<typeof juryPoolSchema>;
export const bundleSchema = z
  .object({
    schemaVersion: version,
    kind: z.literal("bundle"),
    case: caseSchema,
    judge: roleSchema.refine((r) => r.roleType === "judge", "法官角色类型错误"),
    prosecutor: roleSchema.refine(
      (r) => r.roleType === "prosecutor",
      "控方角色类型错误",
    ),
    juryPool: juryPoolSchema,
  })
  .strict()
  .superRefine((bundle, ctx) => {
    const ids = new Set([
      "defense",
      "system",
      ...Array.from({ length: 12 }, (_, i) => `juror-${i + 1}`),
    ]);
    const add = (value: string, path: (string | number)[]) => {
      if (ids.has(value))
        ctx.addIssue({
          code: "custom",
          path,
          message: `重复或保留 ID：${value}`,
        });
      ids.add(value);
    };
    add(bundle.judge.id, ["judge", "id"]);
    add(bundle.prosecutor.id, ["prosecutor", "id"]);
    for (const side of ["prosecutionEvidence", "defenseEvidence"] as const) {
      bundle.case[side].forEach((e, i) => {
        add(e.id, ["case", side, i, "id"]);
        if (e.kind === "witness")
          add(e.profile.id, ["case", side, i, "profile", "id"]);
      });
    }
  });
export type ContentBundle = z.infer<typeof bundleSchema>;
export type Resource = CaseProfile | RoleProfile | JuryPool | ContentBundle;
export const MAX_CONTENT_BYTES = 512 * 1024;
export class ContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentError";
  }
}
export function parseResource(source: string): Resource {
  if (new TextEncoder().encode(source).length > MAX_CONTENT_BYTES)
    throw new ContentError("YAML 不得超过 512 KiB");
  const value = parse(source, { maxAliasCount: 0, uniqueKeys: true });
  const schema =
    value?.kind === "bundle"
      ? bundleSchema
      : value?.kind === "case"
        ? caseSchema
        : value?.kind === "role"
          ? roleSchema
          : value?.kind === "jury-pool"
            ? juryPoolSchema
            : undefined;
  if (!schema)
    throw new ContentError("未知 kind；需要 case、role、jury-pool 或 bundle");
  return schema.parse(value);
}
export const toYaml = (value: Resource) => stringify(value, { lineWidth: 0 });

/** Stable PRNG: state belongs to one jury generation, never to global Math.random. */
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(
  items: { value: T; weight: number }[],
  random: () => number,
): T {
  let point = random() * items.reduce((n, item) => n + item.weight, 0);
  for (const item of items) {
    point -= item.weight;
    if (point < 0) return item.value;
  }
  return items[items.length - 1].value;
}
export function generateJury(source: JuryPool, seed: number): RoleProfile[] {
  const pool = juryPoolSchema.parse(source),
    random = seededRandom(seed),
    names = new Set<string>();
  if ("portraits" in pool) {
    const candidates = [...pool.portraits];
    return Array.from({ length: 12 }, (_, i) => {
      const index = Math.floor(random() * candidates.length);
      const [profile] = candidates.splice(index, 1);
      return { ...profile, id: `juror-${i + 1}` };
    });
  }
  const number = (values: typeof pool.ages) => {
    const band = pick(
      values.map((value) => ({ value, weight: value.weight })),
      random,
    );
    return band.min + Math.floor(random() * (band.max - band.min + 1));
  };
  return Array.from({ length: 12 }, (_, i) => {
    let first = pick(pool.firstNames, random),
      name = "";
    for (let n = 0; n < 20; n++) {
      first = pick(pool.firstNames, random);
      name = `${first.name} ${pick(pool.lastNames, random)}`;
      if (!names.has(name)) break;
    }
    if (names.has(name)) name += ` ${i + 1}`;
    names.add(name);
    return {
      schemaVersion: 1,
      kind: "role",
      id: `juror-${i + 1}`,
      roleType: "juror",
      name,
      gender: first.gender,
      age: number(pool.ages),
      annualIncome: number(pool.incomes),
      occupation: pick(pool.occupations, random),
      ethnicity: pick(pool.ethnicities, random),
      personality: pick(pool.personalities, random),
      background: pick(pool.experiences, random),
    };
  });
}
