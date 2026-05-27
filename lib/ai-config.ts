// lib/ai-config.ts
// Central registry of Claude model names.
// Update here when Anthropic releases new models — one change propagates everywhere.

export const AI_MODELS = {
  /** Fast, cheap — classification, routing, simple summaries */
  fast:     'claude-haiku-4-5',
  /** Balanced — main workhorse for most tasks */
  balanced: 'claude-sonnet-4-6',
  /** Powerful — complex document parsing (CIM, NDA, portfolio) */
  powerful: 'claude-opus-4-5',
  /** Powerful latest — highest-quality intake parsing */
  powerful_latest: 'claude-opus-4-7',
} as const

export type AiModel = typeof AI_MODELS[keyof typeof AI_MODELS]
