import * as core from "@actions/core";
import { run } from "./run.js";

run().catch((error) => core.setFailed(error instanceof Error ? error.message : String(error)));
