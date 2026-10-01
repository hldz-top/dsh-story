/** Versioned settings candidates and their host-owned adoption state. */
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ArtifactId, ArtifactRef, NovelId, RequestId } from './contracts.ts'
import type { StageInputRef } from './stage-output.ts'

/** Host submission of one completed stage; callers cannot request automatic adoption. */
export interface SaveSettingsCandidateRequest {
  readonly novelId: NovelId
  readonly requestId: RequestId
  readonly dimensionCode: string
  /** Current applied version being revised; omitted for generation without revision lineage. */
  readonly revisionOf?: ArtifactId
  readonly researchPlanId: ArtifactId
  readonly childSessionId: SessionId
  readonly output: unknown
}
/** Exact settings version, review and validity against current source versions. */
export interface SettingsCandidateView {
  readonly dimensionCode: string
  /** Earlier applied version retained as reference material rather than an active dependency. */
  readonly revisionOf: ArtifactId | null
  readonly artifact: ArtifactRef<'settings-dimension'>
  readonly inputRefs: readonly StageInputRef[]
  readonly childSessionId: SessionId
  readonly status: 'candidate' | 'reviewed' | 'blocked' | 'applied'
  readonly stale: boolean
  readonly review: ArtifactRef<'review'> | null
}
/** Current adopted dimensions and all historical candidates. */
export interface SettingsView { readonly applied: readonly SettingsCandidateView[]; readonly history: readonly SettingsCandidateView[] }

/** Exact candidate under its owning novel. */
export interface SettingsCandidateRequest { readonly novelId: NovelId; readonly candidateId: ArtifactId }
/** Review output from an independent native stage; no approval boolean is accepted. */
export interface SaveSettingsReviewRequest extends SettingsCandidateRequest {
  readonly expectedReviewId: ArtifactId | null
  readonly requestId: RequestId
  readonly output: unknown
  readonly childSessionId: SessionId
}
/** Compare-and-adopt the exact reviewed version without replacing an unexpected head. */
export interface ApplySettingsCandidateRequest extends SettingsCandidateRequest {
  readonly reviewId: ArtifactId
  readonly expectedAppliedId: ArtifactId | null
}
