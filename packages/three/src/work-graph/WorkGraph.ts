import { Dag } from "@ts-dag/builder";

export class WorkGraph {
  private dag: Dag;

  constructor() {
    this.dag = new Dag();
  }
}
