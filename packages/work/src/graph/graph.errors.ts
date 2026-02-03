export class UnknownNodeError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`Requested Unknown Node Id: ${id}`);
    this.id = id;
  }
}

export class NoComputedValueError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`Requested node with no computed value: ${id}`);
    this.id = id;
  }
}

export class CyclicalGraphError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`Cycle detected while computing ${id}`);
    this.id = id;
  }
}

export class CancelledError extends Error {
  constructor() {
    super("Run cancelled");
  }
}

export class UnknownTaskError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`Requested unknown Task Id: ${id}`);
    this.id = id;
  }
}

export class MissingTaskValueError extends Error {
  readonly taskId: string;
  constructor(taskId: string) {
    super(`Missing task value: ${taskId}`);
    this.taskId = taskId;
  }
}
