// The single API surface used by every component. Backed by the Express server (http.ts).
import type {
  Blocker, Comment, CompletePayload, DashboardSummary, Dimension, Evidence, Insights, IntegrationEvent, IntegrationStatus,
  ManagerSummary, NewBlocker, NewEvidence, NewTask, NotificationPrefs, PerformanceView, Report, Review, ReviewPayload,
  ScoreResult, Settings, Task, PerformanceRecord, ReportHistoryItem, ConnectInfo, IntegrationConnection, TaskFilters, TaskStatus, TaskWithMeta, TimelineEvent, User,
} from './types';
import { httpApi } from './http';

export interface TaskDetail {
  task: TaskWithMeta; owner: User; evidence: Evidence[]; comments: Comment[]; blockers: Blocker[]; reviews: Review[]; timeline: TimelineEvent[];
}
export interface TeamPerformance {
  members: { user: User; trend: ScoreResult[] }[];
  planned_vs_completed: { name: string; planned: number; completed: number }[];
  blockers_by_type: { type: string; open: number; resolved: number }[];
}

export interface Api {
  auth: { login(email: string, password: string): Promise<User>; logout(): Promise<void>; me(): Promise<User | null> };
  users: { team(): Promise<User[]>; get(id: number): Promise<User> };
  tasks: {
    list(f?: TaskFilters): Promise<TaskWithMeta[]>; get(id: number): Promise<TaskDetail>; create(t: NewTask): Promise<TaskWithMeta>;
    update(id: number, patch: Partial<Task>): Promise<TaskWithMeta>; setStatus(id: number, s: TaskStatus): Promise<TaskWithMeta>;
    complete(id: number, p: CompletePayload): Promise<TaskWithMeta>; remove(id: number): Promise<void>;
    resubmit(id: number, response: string): Promise<TaskWithMeta>;
    aiSuggestions(id: number, action: 'accept' | 'dismiss', fields?: ('category' | 'expected_outcome' | 'impact_level')[]): Promise<TaskWithMeta>;
  };
  evidence: { list(userId?: number): Promise<Evidence[]>; add(taskId: number, e: NewEvidence): Promise<Evidence>; remove(id: number): Promise<void> };
  comments: { add(taskId: number, body: string): Promise<Comment> };
  blockers: { list(f?: { status?: 'open' | 'resolved'; user_id?: number }): Promise<Blocker[]>; open(taskId: number, p: NewBlocker): Promise<Blocker>; resolve(id: number, note: string): Promise<Blocker> };
  reviews: { queue(): Promise<TaskWithMeta[]>; submit(taskId: number, p: ReviewPayload): Promise<Review> };
  timeline: { list(userId?: number): Promise<TimelineEvent[]> };
  performance: {
    get(userId?: number): Promise<PerformanceView>;
    override(userId: number, periodStart: string, d: Dimension, value: number, reason: string): Promise<void>;
    clearOverride(userId: number, periodStart: string, d: Dimension): Promise<void>;
    records(userId?: number): Promise<PerformanceRecord[]>; recompute(userId?: number): Promise<PerformanceRecord[]>;
  };
  dashboard: { employee(): Promise<DashboardSummary>; manager(): Promise<ManagerSummary> };
  team: { performance(): Promise<TeamPerformance> };
  reports: {
    daily(date: string, userId?: number | null): Promise<Report>; weekly(weekStart: string, userId?: number | null): Promise<Report>;
    generate(kind: 'daily' | 'weekly', key: string, userId?: number | null): Promise<Report>;
    history(kind: 'daily' | 'weekly', userId?: number | null): Promise<ReportHistoryItem[]>;
    saved(kind: 'daily' | 'weekly', savedId: number): Promise<Report>;
  };
  insights: { get(userId?: number): Promise<Insights> };
  search: { query(q: string): Promise<{ tasks: TaskWithMeta[]; people: User[] }> };
  settings: {
    get(): Promise<Settings>; update(p: Partial<Settings>): Promise<Settings>;
    prefs(): Promise<NotificationPrefs>; updatePrefs(p: NotificationPrefs): Promise<NotificationPrefs>;
    updateProfile(p: Partial<Pick<User, 'name' | 'title' | 'timezone'>>): Promise<User>;
  };
  integrations: {
    status(): Promise<IntegrationStatus[]>; events(): Promise<IntegrationEvent[]>;
    connectInfo(): Promise<ConnectInfo>; connected(app: 'slack' | 'gmail', authId: string): Promise<IntegrationConnection>;
    slackOptions(field: 'channel' | 'user', search?: string, paginate?: string | null): Promise<{ options: { label: string; value: string }[]; hasMore: boolean; paginate: string | null; message: string | null }>;
    saveSlackChannel(channel_id: string, channel_name: string): Promise<IntegrationConnection>;
    mapSlackUser(user_id: number, slack_user_id: string | null, label: string | null): Promise<IntegrationConnection>;
    saveGmailRecipients(recipients: string[]): Promise<IntegrationConnection>;
    disconnect(app: 'slack' | 'gmail'): Promise<void>;
    run(what: 'slack-test' | 'gmail-test' | 'daily' | 'weekly', date?: string): Promise<{ queued: number }>;
    retry(eventId: number): Promise<{ queued: number }>;
  };
  admin: { resetDemo(): Promise<void> };
}

export const api: Api = httpApi;
export * from './types';
