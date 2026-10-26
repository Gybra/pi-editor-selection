# General Software Engineering Principles

These rules are mandatory for every code change, regardless of language, framework, or project. Do not treat them as optional suggestions.

Before writing code, understand the requirement and the relevant existing code. Do not proceed with the first plausible idea without checking whether an existing, simpler, or more direct solution would work better. Choose the smallest solution that fully meets the need. If a rule cannot be followed, explain why before proceeding.

## Choose the Smallest Correct Solution

You MUST implement the simplest solution that fully meets the requirement.

You MUST NOT add abstractions, layers, helpers, configuration, indirection, or generalized infrastructure for hypothetical future needs. Add them only when they provide a concrete benefit to the current work, such as correctness, security, necessary reuse, testability, or meaningfully reduced duplication.

## Preserve Responsibility and Domain Boundaries

Each class and module MUST have a clear, cohesive responsibility and belong to the domain that owns that behavior.

Keep domain-specific rules with their owning domain. A workflow may coordinate multiple domains when that is its purpose, but the coordination MUST be explicit and live at the appropriate application boundary. Do not move domain logic into unrelated domains or create unnecessary cross-domain dependencies.

## Keep Functions Focused and Compact

You MUST keep functions focused on a clear purpose and compact enough to understand in one pass.

Split a function when doing so clarifies distinct responsibilities or makes the main workflow easier to follow. Do not split mechanically by line count, or create tiny helpers that only move code around and make the flow harder to trace.

## Keep Files Manageable

When a file becomes excessively large or difficult to navigate, you MUST split it into cohesive, clearly named files while preserving responsibility and domain boundaries.

Split by responsibility and domain, not by arbitrary line counts. Do not fragment cohesive code or introduce extra indirection merely to make files shorter.

## Write for Human Understanding

You MUST use clear names, straightforward control flow, and familiar patterns. Do not use cleverness or excessive compression at the expense of readability.

Make the intent easy to understand for someone reviewing or maintaining the code. Remove duplication and unnecessary structure, but keep boundaries that make the code clearer.

## Keep Exported Types in a Types Module

You MUST declare every exported `type` and `interface` in the package's types module (`src/types.ts`), never in a file that also exports functions, classes, or values. Import them with `import type`.

A type used by only one file stays in that file, unexported.

## pi-editor-selection constraints

Pi extension that adds text selection, mouse selection and wheel scrolling to Pi's prompt editor.

- Never change Pi's TUI mode or settings. Keyboard selection works in both TUI modes; mouse features run only in fullscreen mode.
- Do not add Ctrl/Cmd+A, Ctrl/Cmd+C or Ctrl/Cmd+X bindings, and preserve Pi's undo behavior.
- Keep the package minimal TypeScript using Pi's extension API, with no runtime dependencies, bundler or `postinstall` script. Pi host packages are `peerDependencies` with `*` ranges.
- Work on a dedicated feature branch with logically scoped, one-line conventional commits, without Co-Authored-By trailers. Never commit planning documents (design specs, implementation plans) or reference them from tracked files.
- Before committing, run `npm run typecheck` and `npm test`; before a release also inspect `npm pack --dry-run --json` and keep the published `files` allowlist up to date.

Source of mandatory principles: https://github.com/Gybra/software-engineering-principles (access may require repository authorization).
