import { describe, expect, it } from "vitest";
import { builtinBundle } from "../src/content/builtin";
import {
  bundleSchema,
  generateJury,
  parseResource,
  toYaml,
} from "../src/domain/profiles";

describe("内容与候选池", () => {
  it("全部内置内容合法，完整 YAML 可无损往返", () => {
    expect(parseResource(toYaml(builtinBundle))).toEqual(builtinBundle);
  });
  it("拒绝重复证据、角色和引擎保留 ID", () => {
    const bundle = structuredClone(builtinBundle);
    bundle.case.defenseEvidence[0].id = bundle.case.prosecutionEvidence[0].id;
    expect(() => bundleSchema.parse(bundle)).toThrow("重复");
    bundle.case.defenseEvidence[0].id = "defense";
    expect(() => bundleSchema.parse(bundle)).toThrow("保留");
  });
  it("拒绝错误权重、无效年龄区间和拼错的字段", () => {
    const bundle = structuredClone(builtinBundle);
    bundle.juryPool.ages[0].weight = 0;
    expect(() => bundleSchema.parse(bundle)).toThrow();
    bundle.juryPool.ages[0].weight = 1;
    bundle.juryPool.ages[0].min = 17;
    expect(() => bundleSchema.parse(bundle)).toThrow();
    expect(() =>
      parseResource(toYaml(builtinBundle.case) + "\nunknownField: typo"),
    ).toThrow();
  });
  it("拒绝 YAML 别名、重复键、过大内容和未知格式", () => {
    expect(() => parseResource("a: &a [1]\nb: *a")).toThrow();
    expect(() => parseResource("kind: case\nkind: role")).toThrow();
    expect(() => parseResource("x".repeat(512 * 1024 + 1))).toThrow("512");
    expect(() => parseResource("kind: mystery")).toThrow("未知");
  });
  it("同一个种子可复现十二位不同姓名的成员，所有值在定义范围内", () => {
    const jury = generateJury(builtinBundle.juryPool, 17);
    expect(jury).toEqual(generateJury(builtinBundle.juryPool, 17));
    expect(jury).not.toEqual(generateJury(builtinBundle.juryPool, 18));
    expect(new Set(jury.map((j) => j.name)).size).toBe(12);
    expect(new Set(jury.map((j) => j.id)).size).toBe(12);
    expect(
      jury.every(
        (j) =>
          j.age! >= 22 &&
          j.age! <= 75 &&
          j.annualIncome! >= 28000 &&
          j.annualIncome! <= 160000,
      ),
    ).toBe(true);
  });
  it("姓名候选不足时仍能产生十二个可区分姓名", () => {
    const pool = structuredClone(builtinBundle.juryPool);
    pool.firstNames = pool.firstNames.slice(0, 1);
    pool.lastNames = pool.lastNames.slice(0, 1);
    expect(new Set(generateJury(pool, 5).map((j) => j.name)).size).toBe(12);
  });
});
