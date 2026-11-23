export type Role = 'employee' | 'manager';
export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'blocked';
export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type ImpactLevel = 'low' | 'medium' | 'high';
export type VerificationStatus = 'unsubmitted' | 'pending' | 'verified' | 'clarification_requested' | 'rejected';
export type EvidenceType = 'github' | 'document' | 'screenshot' | 'test_result' | 'deliverable' | 'explanation';
export type DependencyType = 'person' | 'team' | 'external' | 'tool' | 'unclear';
export type Dimension = 'productivity' | 'quality' | 'impact' | 'consistency' | 'ownership';
export type TimelineEventType = 'task_created' | 'task_completed' | 'evidence_submitted' | 'verified' | 'blocker_opened' | 'blocker_resolved' | 'feedback' | 'achievement';

export interface User {
  id: number; name: string; email: string; role: Role; team_id: number; manager_id: number | null;
  title: string; avatar_color: string; timezone: string;
}
export interface Task {
  id: number; user_id: number; title: string; description: string | null; category: string; priority: Priority;
  expected_outcome: string | null; actual_outcome: string | null; estimated_minutes: number | null; actual_minutes: number | null;
  deadline: string | null; status: TaskStatus; impact_level: ImpactLevel; impact_note: string | null;
  is_planned_today: boolean; planned_for_date: string | null; started_at: string | null; completed_at: string | null;
  ai_enriched: boolean; ai_suggestions_json: AiSuggestions | null; verification_status: VerificationStatus;
  deleted_at?: string | null; created_at: string; updated_at: string;
}
export interface AiSuggestions { category: string; expected_outcome: string; suggested_impact_level: ImpactLevel; impact_rationale: string; measurable_signal: string; model?: string; message_id?: string; generated_at?: string; state?: 'pending' | 'accepted' | 'dismissed'; applied?: string[] }
export interface TaskWithMeta extends Task { evidence_count: number; open_blocker: Blocker | null; is_overdue: boolean; user_name?: string }
export interface Evidence {
  id: number; task_id: number; type: EvidenceType; url: string | null; file_path: string | null; note: string | null;
  submitted_at: string; created_at: string; task_title?: string; verification_status?: VerificationStatus;
}
export interface Comment { id: number; task_id: number; author_id: number; body: string; kind: 'comment' | 'clarification' | 'decision'; created_at: string; author_name?: string }
export interface Blocker {
  id: number; task_id: number; user_id: number; description: string; dependency_type: DependencyType; dependency_name: string | null;
  is_external: boolean; status: 'open' | 'resolved'; opened_at: string; resolved_at: string | null; resolution_note: string | null;
  ai_extraction_json?: { dependency_type: DependencyType; dependency_name: string | null; is_external: boolean; confidence: 'low' | 'medium' | 'high'; note: string; model?: string } | null;
  task_title?: string; user_name?: string;
}
export interface Review { id: number; task_id: number; manager_id: number; decision: 'verified' | 'clarification_requested' | 'rejected'; note: string | null; quality_rating: number | null; created_at: string; manager_name?: string }
export interface TimelineEvent { id: number; user_id: number; task_id: number | null; event_type: TimelineEventType; title: string; detail: string | null; occurred_at: string }

export interface DimensionScore {
  value: number | null; data_points: number; inputs: Record<string, number | null>; explanation: string[];
  excluded: { id?: number; title?: string; reason: string }[];
  override?: { original_value: number | null; new_value: number; reason: string; manager_id: number; created_at: string };
}
export interface ScoreResult {
  user_id: number; period_start: string; period_end: string; overall: number | null; is_provisional: boolean;
  provisional_reasons: string[]; weights: Record<Dimension, number>; dropped: Dimension[];
  dimensions: Record<Dimension, DimensionScore>;
}
export interface PerformanceView { current: ScoreResult; previous: ScoreResult; rolling: ScoreResult; trend: ScoreResult[]; formulas: Record<Dimension, string> }

export interface DashboardSummary {
  planned_today: TaskWithMeta[]; completed_today: number; pending: number; blocked: number; planned_count: number;
  completion_pct: number | null; week: { date: string; label: string; planned: number; completed: number }[];
  upcoming: TaskWithMeta[]; achievements: TimelineEvent[];
  attention: { kind: 'rejected' | 'clarification' | 'overdue' | 'no_evidence'; task: TaskWithMeta; note: string | null }[];
}
export interface TeamMemberRow {
  user: User; current_task: Task | null; completed_week: number; on_time_pct: number | null; verified_pct: number | null;
  scores: ScoreResult; open_blockers: number; last_activity: string | null;
}
export interface ManagerSummary {
  team_size: number; completed_today: number; in_progress: number; blocked: number; pending_reviews: number;
  delivery_pct: number | null; trend: { label: string; completed: number; planned: number; on_time: number | null }[];
  achievements: (TimelineEvent & { user_name: string })[]; review_queue: TaskWithMeta[]; open_blockers: Blocker[]; members: TeamMemberRow[];
}
export interface ReportData {
  user_id: number | null; user_name: string | null; period_label: string; planned: TaskWithMeta[]; completed: TaskWithMeta[];
  pending: TaskWithMeta[]; blocked: TaskWithMeta[]; impact_points: number; evidence: Evidence[]; needs_attention: string[]; next_priorities: TaskWithMeta[];
  ai?: { model: string; records: number; message_id: string; generated_at: string };
  ai_analysis?: { achievements: string[]; recurring_problems: { dependency: string; occurrences: number; note: string }[]; planned_vs_actual: string; suggestions: string[] };
  scores?: { user_id: number; user_name: string; overall: number | null; is_provisional: boolean; dimensions: Record<Dimension, number | null> }[];
}
export interface Report { id: string; kind: 'daily' | 'weekly'; key: string; user_id: number | null; data: ReportData; summary_text: string; summary_source: 'ai' | 'template'; generated_at: string; saved_id?: number; delivered_via?: string | null; delivered_at?: string | null }
export interface ReportHistoryItem { saved_id: number; kind: 'daily' | 'weekly'; key: string; user_id: number | null; user_name: string; summary_text: string; summary_source: 'ai' | 'template'; generated_at: string; delivered_via: string | null }
export interface PerformanceRecord {
  id: number; user_id: number; period_start: string; productivity: number | null; quality: number | null; impact: number | null; consistency: number | null; ownership: number | null;
  overall: number | null; is_provisional: boolean; computed_at: string;
  inputs_json: { weights: Record<Dimension, number>; dropped: Dimension[]; provisional_reasons: string[]; dimensions: Record<Dimension, { value: number | null; data_points: number; inputs: Record<string, number | null>; override: unknown }> };
}

export interface Settings {
  score_weights: Record<Dimension, number>; workday_end: string; timezone: string; slack_channel: string | null;
  report_recipients: string[]; leave_days: Record<string, string[]>; features: Record<string, boolean>;
}
export interface NotificationPrefs { in_app: boolean; slack_dm: boolean; email_digest: boolean }
export interface ConnectionSettings { channel_id?: string; channel_name?: string; user_map?: Record<string, { id: string; label: string | null }>; recipients?: string[] }
export interface IntegrationConnection { app: 'slack' | 'gmail'; label: string | null; connected_at: string; flow_ready: boolean; expired: boolean; settings: ConnectionSettings }
export interface IntegrationStatus { app: 'slack' | 'gmail' | 'ai'; label: string; connected: boolean; expired: boolean; detail: string; connection?: IntegrationConnection | null }
export interface ConnectInfo { token: string; serviceIds: { slack: string; gmail: string }; actions: { slack: string[]; gmail: string[] }; reconnect: Partial<Record<'slack' | 'gmail', string>> }
export interface AiReportRef { saved_id: number; key: string; summary_text: string; generated_at: string; ai: { model: string; records: number; message_id: string } | null; analysis: { achievements: string[]; recurring_problems: { dependency: string; occurrences: number; note: string }[]; planned_vs_actual: string; suggestions: string[] } | null; source_task_ids: number[] }
export interface IntegrationEvent { id: number; event_type: string; payload_json: unknown; status: 'queued' | 'sent' | 'failed' | 'skipped_not_connected'; attempts: number; last_error: string | null; created_at: string; processed_at?: string | null; result_json?: Record<string, unknown> | null }

export interface Insights {
  ai_connected: boolean;
  recurring_blockers: { dependency: string; type: DependencyType; count: number; open: number; avg_hours: number | null; task_ids: number[] }[];
  planned_vs_actual: { label: string; planned: number; completed: number }[];
  estimation: { task_id: number; title: string; estimated: number; actual: number }[];
  source_task_ids: number[];
  latest_daily?: AiReportRef | null; latest_weekly?: AiReportRef | null;
  pending_suggestions?: { task_id: number; title: string; expected_outcome: string; suggested_impact_level: ImpactLevel }[];
}

export interface TaskFilters { q?: string; status?: TaskStatus | ''; priority?: Priority | ''; category?: string; sort?: 'deadline' | 'created' | 'priority'; user_id?: number; overdue?: boolean }
export type NewTask = Partial<Pick<Task, 'description' | 'category' | 'priority' | 'expected_outcome' | 'estimated_minutes' | 'deadline' | 'impact_level' | 'impact_note' | 'is_planned_today'>> & { title: string };
export interface NewEvidence { type: EvidenceType; url?: string; note?: string; file?: File | null }
export interface NewBlocker { description: string; dependency_type: DependencyType; dependency_name?: string; is_external: boolean }
export interface CompletePayload { actual_outcome: string; actual_minutes?: number | null; evidence: NewEvidence[] }
export interface ReviewPayload { decision: Review['decision']; note?: string; quality_rating?: number | null }
