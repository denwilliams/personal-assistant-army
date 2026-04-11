/**
 * Built-in skills are code-defined skills always available to every agent.
 *
 * They appear in every agent's skills catalog, can be loaded via `load_skill`,
 * but cannot be modified or deleted by agents or users. The canonical use case
 * is meta-skills that teach agents HOW to use the skill/workflow system
 * (e.g. `skill-creator`, `workflow-creator`).
 */

export interface BuiltInSkill {
  name: string;
  summary: string;
  content: string;
}

const SKILL_CREATOR: BuiltInSkill = {
  name: "skill-creator",
  summary:
    "Use when you need to create a new skill. Explains how to structure, name, and write high-quality skills that are easy to rediscover and reuse.",
  content: `# Skill Creator

Load this skill whenever you decide to save a reusable pattern, procedure, template, or technique as a skill. It explains how to produce a skill that future-you will actually want to load.

## When to create a skill

Create a skill when:
- You've executed the same multi-step procedure more than once
- You've learned a specific technique or approach that works better than alternatives
- You have a reusable template, structure, or output format
- The user has taught you a way of working they want repeated

DO NOT create a skill for:
- Plain facts or user preferences — use the \`remember\` memory tool
- One-off information that won't recur
- An ordered, sequential process — use \`create_workflow\` instead

If you're not sure whether something is a skill or a workflow, ask: *"Does this have strict ordered steps that must be followed in sequence?"* If yes, it's a workflow. If it's more like a cheat sheet, reference guide, or bundle of techniques, it's a skill.

## Skill anatomy

A skill has three fields:

1. **name** — a slug: lowercase, hyphen-separated, short but descriptive
   - Good: \`email-drafting\`, \`pr-review\`, \`meeting-notes\`, \`bug-triage\`
   - Bad: \`EmailStuff\`, \`skill1\`, \`helper\`
2. **summary** — 1-2 sentences describing WHEN to load this skill
3. **content** — full Markdown instructions, up to 50KB

## Writing a great summary

The summary is the ONLY thing injected into your system prompt for this skill. It must help you decide whether to load the skill on future turns, so it should describe the *trigger*, not the *content*.

- Good: "Use when drafting professional emails. Provides tone, structure, and common templates for thank-yous, follow-ups, and status updates."
- Bad: "A skill about emails."

Aim for format: **"Use when [trigger]. [What it provides]."**

## Writing great content

Structure the content as Markdown so you can skim it quickly when loaded. A reliable template:

\`\`\`markdown
# [Skill Title]

Brief statement of what this skill accomplishes.

## When to use
- Concrete trigger #1
- Concrete trigger #2

## Procedure
1. Step one
2. Step two
3. Step three

## Templates
[Any reusable snippets, boilerplate, or formats]

## Examples
[At least one worked example showing the skill applied]

## Gotchas
[Known pitfalls or edge cases]
\`\`\`

Keep it under 50KB. Prefer concrete examples to abstract advice.

## After creating a skill

1. Briefly mention the new skill in your response to the user so they know it exists
2. Use \`update_skill\` to refine it based on user feedback
3. If the skill proves valuable across many conversations, the user can promote it to a user-level skill via the UI

## Self-check before calling create_skill

Before calling \`create_skill\`, verify:
- [ ] The name is a lowercase-hyphenated slug
- [ ] The summary starts with "Use when..." or similar trigger language
- [ ] The content has a "When to use" section and at least one example
- [ ] The skill is not a near-duplicate of an existing skill (check \`list_skills\` first)
- [ ] This really is a skill and not a workflow (ordered steps) or a memory (plain fact)
`,
};

const WORKFLOW_CREATOR: BuiltInSkill = {
  name: "workflow-creator",
  summary:
    "Use when you need to create a new workflow. Explains how to break a sequential process into well-scoped, ordered steps.",
  content: `# Workflow Creator

Load this skill whenever you decide to save a sequential, ordered process as a workflow. It explains how to structure workflow steps so the process can be executed reliably later.

## Workflow vs Skill

Create a **workflow** when:
- The task has explicit, ordered steps that must be executed in sequence
- Skipping or reordering steps would cause the process to fail
- You want to track progress through a process, step by step

Create a **skill** instead when:
- The task is about knowledge, templates, or techniques
- Order of information doesn't fundamentally matter
- It reads more like a reference guide than a recipe

If in doubt, load the \`skill-creator\` skill and compare.

## Workflow anatomy

A workflow has four fields:

1. **name** — a slug: lowercase, hyphen-separated (e.g. \`new-customer-onboarding\`)
2. **summary** — 1-2 sentences describing WHEN to start this workflow
3. **steps** — an ordered array of \`{ title, instructions }\` objects
4. (implicit) the ordering of the array IS the execution order

## Writing great steps

Each step should:
- Have a clear, action-oriented **title** (e.g. "Gather repro details", not "Step 1")
- Contain detailed **instructions** the agent can follow without additional context
- State what information is required from the user, if any
- Note any tools, other skills, or other workflows it depends on
- Define a clear completion signal — how do you know this step is done?

## Granularity

Aim for 3-10 steps. If you have fewer than 3, you probably want a skill instead. If you have more than 10, consider splitting into multiple workflows or grouping related actions into a single step.

## Example: \`bug-triage\` workflow

\`\`\`
Step 1 — Gather bug details
  Ask the user for: reproduction steps, expected vs actual behaviour, environment,
  and any error messages or logs. Do not proceed until you have at least repro
  steps and expected/actual behaviour.

Step 2 — Classify severity
  Rate severity P0-P3 based on impact and frequency. P0 blocks all users. P1
  blocks a significant feature. P2 is a workaroundable bug. P3 is cosmetic.

Step 3 — Search for duplicates
  Use the issue-search tool to look for existing reports. If a duplicate exists,
  link it and stop the workflow.

Step 4 — Draft issue summary
  Write a clear title and structured description with sections:
  Context / Steps to reproduce / Expected / Actual / Environment.

Step 5 — Confirm with user
  Show the draft to the user. Apply feedback, then submit.
\`\`\`

## Execution model

When you load a workflow with \`load_workflow\`, you receive all steps at once. You must:
1. Announce to the user which workflow you're executing
2. Work through the steps in order
3. Briefly acknowledge the transition between steps ("Step 2: Classifying severity...")
4. Do not skip or reorder steps unless the user explicitly asks you to

## Self-check before calling create_workflow

Before calling \`create_workflow\`, verify:
- [ ] The name is a lowercase-hyphenated slug
- [ ] The summary starts with "Use when..." describing the trigger to start this workflow
- [ ] There are between 3 and 10 steps
- [ ] Every step has a clear, action-oriented title
- [ ] Every step's instructions are self-contained
- [ ] The workflow really is sequential (otherwise use \`create_skill\`)
`,
};

export const BUILT_IN_SKILLS: readonly BuiltInSkill[] = [
  SKILL_CREATOR,
  WORKFLOW_CREATOR,
];

export function findBuiltInSkill(name: string): BuiltInSkill | undefined {
  return BUILT_IN_SKILLS.find((s) => s.name === name);
}

export function isBuiltInSkillName(name: string): boolean {
  return BUILT_IN_SKILLS.some((s) => s.name === name);
}
