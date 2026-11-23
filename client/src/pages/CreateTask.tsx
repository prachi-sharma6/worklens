import { useNavigate } from 'react-router-dom';
import { Lightbulb } from 'lucide-react';
import { Card } from '@/components/ui';
import { TaskForm } from '@/components/TaskForm';

export default function CreateTask() {
  const nav = useNavigate();
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="h-page">Create task</h1>
        <p className="text-sm text-muted mt-0.5">Describe the outcome, not the activity. You can also press <kbd className="text-[11px] border border-border rounded px-1">Ctrl K</kbd> → Add task from anywhere.</p>
      </div>
      <Card><TaskForm defaultExpanded onCreated={(t) => nav(`/tasks/${t.id}`)} /></Card>
      <Card title={<span className="flex items-center gap-1.5"><Lightbulb size={14} className="text-warning" />Writing tasks that measure well</span>}>
        <ul className="text-xs text-muted space-y-1.5 list-disc pl-4">
          <li><b className="text-fg font-medium">Expected outcome</b> should be checkable: “p95 under 400ms”, not “improve performance”.</li>
          <li>Splitting work into many tiny tasks won’t raise your score — tasks are weighted by priority and scored as ratios.</li>
          <li>Hours are tracked only for estimation accuracy. They never increase any score.</li>
          <li>Blocked? Report it early from the task page with a named dependency — that counts toward Ownership.</li>
        </ul>
      </Card>
    </div>
  );
}
