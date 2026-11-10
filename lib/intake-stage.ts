// lib/intake-stage.ts
// Pure deal-stage helpers for the email intake flow
// (app/api/notes/email/route.ts).
//
// The stage itself comes from the forwarding-note interpretation
// (parseForwardingNote, an LLM call) — what lives here is only the
// deterministic mapping *around* it, so it can be unit-tested without
// a database, an LLM, or a running app:
//
//   - which deal `status` a stage implies (Pass* → Dead, Closed* → Closed)
//   - which stage wins when several sources disagree
//   - the default stage for a deal with no instruction at all
//
// NOTE: the parallel intake-improvements work (deterministic "log as …"
// command parsing) owns the *interpretation* of the forwarding note.
// This module deliberately does not parse note text — it only maps the
// stage that interpretation produced.

export type DealStatus = 'Active' | 'Dead' | 'Closed'

/** The stage a brand-new deal gets when nothing says otherwise. */
export const DEFAULT_INTAKE_STAGE = 'Teaser'

/**
 * The deal status implied by a stage.
 *   - 'Pass (DOA)', 'Pass (Pre-LOI)', 'Pass (Post-LOI)' → 'Dead'
 *   - 'Closed (Platform)', 'Closed (Add-On)'            → 'Closed'
 *   - anything else ('Teaser', 'Reviewing', …)           → 'Active'
 */
export function stageToStatus(stage: string): DealStatus {
  if (stage.startsWith('Pass')) return 'Dead'
  if (stage.startsWith('Closed')) return 'Closed'
  return 'Active'
}

/**
 * Resolve the status for a deal being created/logged at `stage`.
 * An explicitly supplied status (e.g. from the forwarding-note
 * interpretation) wins; otherwise the stage implies it.
 */
export function resolveDealStatus(stage: string, explicitStatus?: string | null): DealStatus {
  if (explicitStatus === 'Active' || explicitStatus === 'Dead' || explicitStatus === 'Closed') {
    return explicitStatus
  }
  return stageToStatus(stage)
}

/**
 * Which stage a deal's files/docs route to.
 * An existing deal keeps its own stage; otherwise the forwarding
 * note's stage applies; otherwise the deal is a fresh Teaser.
 */
export function resolveEffectiveStage(
  existingStage?: string | null,
  instructedStage?: string | null,
): string {
  return existingStage ?? instructedStage ?? DEFAULT_INTAKE_STAGE
}

/**
 * Which stage a brand-new deal (no existing deal matched) is created in.
 * The forwarding note's stage applies when present, else Teaser.
 */
export function resolveIntakeStage(instructedStage?: string | null): string {
  return instructedStage || DEFAULT_INTAKE_STAGE
}
