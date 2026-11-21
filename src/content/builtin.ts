import caseYaml from "../../profiles/cases/harbor/case.yaml?raw";
import judgeYaml from "../../profiles/roles/judge.yaml?raw";
import prosecutorYaml from "../../profiles/roles/prosecutor.yaml?raw";
import poolYaml from "../../profiles/jury-pool.yaml?raw";
import { bundleSchema, parseResource } from "../domain/profiles";

export const builtinBundle = bundleSchema.parse({
  schemaVersion: 1,
  kind: "bundle",
  case: parseResource(caseYaml),
  judge: parseResource(judgeYaml),
  prosecutor: parseResource(prosecutorYaml),
  juryPool: parseResource(poolYaml),
});
