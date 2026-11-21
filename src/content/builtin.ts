import caseYaml from "../../profiles/cases/harbor/case.yaml?raw";
import judgeYaml from "../../profiles/roles/judge.yaml?raw";
import prosecutorYaml from "../../profiles/roles/prosecutor.yaml?raw";
import poolYaml from "../../profiles/jury-pool.yaml?raw";
import {
  bundleSchema,
  parseResource,
  weightedJuryPoolSchema,
} from "../domain/profiles";

const shared = bundleSchema.parse({
  schemaVersion: 1,
  kind: "bundle",
  case: parseResource(caseYaml),
  judge: parseResource(judgeYaml),
  prosecutor: parseResource(prosecutorYaml),
  juryPool: parseResource(poolYaml),
});

export const builtinBundle = {
  ...shared,
  juryPool: weightedJuryPoolSchema.parse(shared.juryPool),
};

export const caseLibrary = [
  builtinBundle,
  ...Object.values(
    import.meta.glob<string>(
      [
        "../../profiles/cases/*/case.yaml",
        "../../profiles/cases/*/bundle.yaml",
        "!../../profiles/cases/harbor/case.yaml",
      ],
      { eager: true, query: "?raw", import: "default" },
    ),
  ).map((source) => {
    const resource = parseResource(source);
    return resource.kind === "bundle"
      ? resource
      : bundleSchema.parse({ ...builtinBundle, case: resource });
  }),
];
