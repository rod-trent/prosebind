/**
 * @prosebind/lsp — language server. Not implemented yet; v1 scope (DESIGN.md § 11).
 *
 * The mapping is settled — diagnostics, hover for entity cards, code actions for
 * "mark intentional" and "promote to canon", go-to-definition for where a fact was
 * established (DESIGN.md § 5). The engine it will wrap is already working: see
 * `@prosebind/core`'s `Project`, which returns exactly the diagnostics this server
 * needs to publish.
 */
export {};
