# Agent skills

This directory vendors the portable skill pack from
[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills), so
Freebuff discovers the skills as project-local `/skill` commands.

- **Upstream version:** 0.6.13
- **Commit:** `aeac41d4d005999432bb7312f7ff06383a91d59d`
- **License:** MIT, copyright Addy Osmani (see `skills/LICENSE`)

## Layout

| Path | Purpose |
| --- | --- |
| `skills/<name>/SKILL.md` | One workflow per skill. This is what the agent discovers. |
| `skills/<name>/references/` | Supporting material owned by a single skill. |
| `references/` | Shared checklists linked from skills as `../../references/...`. |

Do not rename `skills/` or move the shared `references/` directory: the relative
links between them are part of the pack.

## Skills

- **Define:** `interview-me`, `idea-refine`, `spec-driven-development`, `constraint-driven-development`
- **Plan:** `planning-and-task-breakdown`
- **Build:** `incremental-implementation`, `test-driven-development`, `context-engineering`, `source-driven-development`, `doubt-driven-development`, `frontend-ui-engineering`, `api-and-interface-design`
- **Verify:** `browser-testing-with-devtools`, `debugging-and-error-recovery`
- **Review:** `code-review-and-quality`, `code-simplification`, `security-and-hardening`, `performance-optimization`
- **Ship:** `git-workflow-and-versioning`, `ci-cd-and-automation`, `deprecation-and-migration`, `documentation-and-adrs`, `observability-and-instrumentation`, `shipping-and-launch`
- **Meta:** `using-agent-skills`

## Updating

```bash
git clone --depth 1 https://github.com/addyosmani/agent-skills.git /tmp/agent-skills
rm -rf .agents/skills .agents/references
cp -R /tmp/agent-skills/skills .agents/skills
cp -R /tmp/agent-skills/references .agents/references
cp /tmp/agent-skills/LICENSE .agents/skills/LICENSE
```

After an update, check that every skill still resolves its `../../references/`
links and update the version and commit above.
