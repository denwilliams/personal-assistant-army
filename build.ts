#!/usr/bin/env bun

import * as tailwindPlugin from "bun-plugin-tailwind";

const result = await Bun.build({
  entrypoints: ["./index.ts"],
  outdir: "./",
  target: "bun",
  minify: true,
  plugins: [tailwindPlugin.default || tailwindPlugin],
  compile: {
    outfile: "./army",
  },
});

if (!result.success) {
  console.error("Build failed:");
  for (const message of result.logs) {
    console.error(message);
  }
  process.exit(1);
}

console.log("✅ Build successful!");
