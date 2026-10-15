# Rewrite the front end on vendored Preact with htm, with no build step

- Status: Accepted. The rewrite is in progress.
- Deciders: Eli
- Date: 2026-10-15
- Tags: front-end, preact, htm, build, dependencies

## Context and Problem Statement

On 15 Oct, `public/app.js` held 930 lines that kept the page in step by hand. It looked up 33 elements by id and called a render function whenever something changed. That caused bugs, among them stale chip cards, the Send and Stop button state, and an event stream left open. The owner also wants the page to grow toward most of Desktop's features.

Should the page move to a framework, and which one?

## Decision Drivers

- Fewer bugs from keeping page and state in step by hand.
- Room to add most of Desktop's features.
- No install or build before a restart.
- The existing 913-line stylesheet keeps working as it is.

## Considered Options

1. Preact with htm, vendored in the repo
2. Lit
3. React
4. Vue
5. Alpine and htmx
6. Svelte or Solid
7. Plain JavaScript, as it is

## Decision Outcome

Chosen option: "Preact with htm, vendored in the repo", because it is small, needs no build step, uses React's component model and works with Capcom's existing CSS.

The rewrite comes first and keeps all current features. Desktop's features follow, in the order set in the [only-client decision](20261015-capcom-is-the-only-client.md). The owner defers a build step with Vite and TypeScript until the code outgrows this. As of 15 Oct 2026, the page on `main` is still the plain JavaScript version.

### Consequences

- ✅ Each part of the page owns its markup, state and handlers and redraws itself, which removes the hand-written syncing.
- ✅ Nothing to install or build, and the stylesheet stays as it is.
- ❌ A vendored copy of Preact and htm is third-party code that Capcom now updates by hand. This partly supersedes the [no-dependencies decision](20261007-no-dependencies-no-build-step.md) for the page. The server keeps no dependencies.
- ❌ Without TypeScript, mistakes across a growing codebase show up at run time.

## Pros and Cons of the Options

### Preact with htm

- ✅ One small library, no build, familiar component model
- ❌ Third-party code to vendor and update

### Lit

- ✅ Small, no build step, built on web components
- ❌ Shadow DOM hides each component's styles from the global CSS, which would need reworking

### React

- ✅ The same model as Preact
- ❌ Much larger for the same result here

### Vue

- ✅ Runs without a build
- ❌ The build-free version is large, and the small variant, petite-vue, is barely maintained

### Alpine and htmx

- ✅ Good for adding behaviour to static pages
- ❌ Weak for a live chat that holds this much state in the browser

### Svelte or Solid

- ❌ Both need a build step

### Plain JavaScript

- ✅ Nothing new to learn or vendor
- ❌ Hand-written syncing keeps causing bugs as the page grows

## Links

- Partly supersedes: [No dependencies, no build step](20261007-no-dependencies-no-build-step.md)
- [Capcom is the only client](20261015-capcom-is-the-only-client.md), which sets the features the page will grow into
