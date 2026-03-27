export type Status =
  | 'new'
  | 'active'
  | 'done'
  | 'blocked'
  | 'at-risk'
  | 'deferred'
  | 'cancelled'
  | 'review'
  | 'paused';

export type Priority = 'low' | 'normal' | 'high' | 'critical';

export type DurationUnit = 'h' | 'd' | 'bd' | 'w' | 'm' | 'q';

export interface Duration {
  value: number;
  unit: DurationUnit;
}

export interface DateRange {
  start?: string;
  end?: string;
  duration?: Duration;
}

export interface Dependency {
  ids: string[];
  logic: 'and' | 'or';
}

export interface Task {
  type: 'task';
  status: Status;
  name: string;
  description?: string;
  id?: string;
  assignees: string[];
  tags: string[];
  priority?: Priority;
  progress?: number;
  duration?: Duration;
  startDate?: string;
  dueDate?: string;
  after: Dependency[];
  modifiers: string[];
  recurrence?: string;
  externalRef?: string;
  subtasks: Task[];
  computedStart?: Date;
  computedEnd?: Date;
  plannedStart?: Date;   // original undelayed start when +delayed:X is used
  plannedEnd?: Date;     // original undelayed end when +delayed:X is used
  line: number;
}

export interface Milestone {
  type: 'milestone';
  name: string;
  description?: string;
  id?: string;
  date?: string;
  after: Dependency[];
  modifiers: string[];
  computedDate?: Date;
  line: number;
}

export interface ParallelBlock {
  type: 'parallel';
  name?: string;
  id?: string;
  after: Dependency[];
  items: Array<Task | Milestone | Section | ParallelBlock>;
  computedStart?: Date;
  computedEnd?: Date;
  line: number;
}

export interface Section {
  type: 'section';
  title: string;
  level: 1 | 2 | 3;
  line: number;
}

export interface Comment {
  type: 'comment';
  text: string;
  line: number;
}

export type DocumentItem = Task | Milestone | ParallelBlock | Section | Comment;

export interface YattHeader {
  title?: string;
  owner?: string;
  start?: string;
  schedule?: 'calendar-days' | 'business-days';
  timezone?: string;
  weekStart?: 'mon' | 'sun';
}

export interface YattDocument {
  header: YattHeader;
  items: DocumentItem[];
  idMap: Map<string, Task | Milestone | ParallelBlock>;
}

export interface ParseError {
  message: string;
  line: number;
  severity: 'error' | 'warning';
}
