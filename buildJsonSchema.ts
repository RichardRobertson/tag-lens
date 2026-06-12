#!/user/bin/env node

/// <reference types="node" />

import * as fs from "node:fs";
import { z } from "zod";
import { ConfigFileSchema } from "./src/configFileSchema.ts";

fs.writeFileSync(
    "./schema/tag-lens.config.json",
    JSON.stringify(z.toJSONSchema(ConfigFileSchema), undefined, "    ")
);
