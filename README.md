# Docs

Source-based documentation of agent concepts and their implementation in Codex, Claude Code and Cursor. The publication contains 21 concepts in English and Portuguese, backed by an immutable archive of 714 official documents.

English is the canonical edition. Portuguese translates the same content. Both editions share their structure, examples, references and stable anchors. Implementation details remain attributed to the relevant product and surface; conceptual text does not imply universal support.

## Build

Requires Node.js 22 or later; CI uses Node.js 24. There are no package dependencies and no installation step.

```sh
git clone https://github.com/RanulfoMNeto/docs.git
cd docs
npm run build
npm test
```

The build writes the complete publication to `dist/`. Tests validate the content and produce two builds to verify byte-for-byte reproducibility. Neither command starts a server, opens a browser, downloads documentation or runs the examples in the articles.

Serve `dist/` through any static HTTP server to preview the publication. Search and the source reader use same-origin fetch requests and require HTTP; opening HTML through `file://` is not supported. Generated files are ignored by Git.

## GitHub Pages

1. Push this repository to GitHub with `main` as the publication branch.
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions**.
3. Run **Validate and publish documentation**, or push a change to `main`.

The [workflow](.github/workflows/pages.yml) validates pull requests and publishes successful builds from `main`. Only the deployment job receives Pages and identity-token write permissions. Relative URLs support the `/docs/` project path and a domain root without build configuration. The default publication URL is `https://ranulfomneto.github.io/docs/`. Deployment follows the [official GitHub Pages workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Architecture

The site is generated HTML enhanced with native browser APIs. Reading articles, following links and downloading Markdown do not require JavaScript. Search, implementation tabs, citation previews and the source reader are progressive enhancements. There is no framework, backend, translation service or external runtime dependency.

| Path | Responsibility |
| --- | --- |
| `content/<concept>.json` | Shared article structure with English and Portuguese text |
| `content/ui.json` | Interface translations |
| `content/references.json` | Exact source selectors and source hashes |
| `content/aliases.json` | Compatibility with previous hash-based routes |
| `content/review.json` | Reviewer identity and hashes of reviewed editorial inputs |
| `sources/raw/` | All 714 archived originals, including unused documents |
| `sources/manifest.json` | Snapshot scope, retrieval records and integrity hashes |
| `site/` | Browser behavior, shared pure functions and styling |
| `scripts/` | Static generator, evidence selection and tests |
| `assets/fonts/` | Local typography and provenance |

Each language receives 21 HTML articles and matching Markdown exports. A single source reader loads documents from the archive instead of storing a generated HTML copy of each original. Search indexes are loaded only when search opens. No historical revisions, generated publication files or migration tools are stored in the repository; future revisions belong in Git history.

## Editorial contract

Articles follow **Definition → Operation → Implementation → References**, organized into Architecture, Context, Execution and control, Extensions, and Coordination. Each implementation has Codex, Claude Code and Cursor panels. Documentary gaps are identified rather than filled with unsupported equivalences.

To edit an article:

1. Select evidence from the existing archive. Preserve qualifications, exceptions, platform constraints and literal commands.
2. Edit the English text, then its Portuguese translation in the same block. Code examples and reference identifiers are shared, not translated.
3. Give each heading a stable English identifier. Use `<concept>.md#<heading-id>` for internal content links. If moving a section, retain its old destination in `content/aliases.json`.
4. Review both editions against the selected original. The source popup must substantiate the complete adjacent passage, including the example where present.
5. Record the completed editorial review and run the static checks:

```sh
node scripts/build.mjs --record-review "reviewer identity"
npm test
```

Recording a review only stores the supplied identity and input hashes; it does not perform or certify a semantic assessment. The build rejects changed editorial inputs until their review record is updated. The current review was performed by an agent, not a human.

A reference selects one heading and an optional inclusive, one-based line interval. Its `segments` are ordered `[start, end)` positions in the original decoded JavaScript string: zero-based UTF-16 offsets, without newline or Unicode normalization. Discontinuous excerpts are joined with `[...]`. The compiler checks the source hash, selection boundaries, overlap and Unicode boundaries, then extracts the original directly. Transcribed examples must match their evidence. Source HTML is displayed as escaped text.

References appear beside each passage and at the end of its article. Hover or keyboard focus opens the exact original; touch opens it through the reference marker. Clicking a passage opens the local document with highlighted evidence. Citations, source highlights, backlinks and exported Markdown use the same selection.

## Archive and validation

The snapshot is dated **2026-10-16**. Its scope is the unique documentation URLs listed in the saved official indexes, including the combined ChatGPT/Codex export. It contains 714 successfully archived documents and retains seven failed retrieval records. It is a textual snapshot, not a claim to include every vendor resource: images, videos, authenticated content and explicitly excluded external products are outside its scope. The [manifest](sources/manifest.json) is authoritative. No source is removed because it is unused.

Original files are byte-preserved, and `.gitattributes` prevents Git from normalizing their line endings. Builds verify all original hashes and sizes. Checks also cover bilingual structure, shared identifiers, exact excerpts, anchors, old routes, search destinations, project-path links, local assets, theme tokens and reproducibility.

Static checks do not establish semantic correctness or visual accessibility. Browser interaction and visual review remain separate acceptance activities; this refactor was validated without starting the application or opening a browser.

## Attribution

This is an independent publication, not affiliated with OpenAI, Anthropic or Cursor. Archived documentation and selected excerpts retain their original ownership and applicable terms. Official URLs are retained with every reference and in the source manifest.

Anthropic Sans, Anthropic Serif Display and Paper Mono are stored locally. Their origins and hashes are recorded in [font provenance](assets/fonts/provenance.json). Inclusion of a public asset records its origin; it does not grant a redistribution license. No repository-wide license is applied to third-party documentation or fonts.
