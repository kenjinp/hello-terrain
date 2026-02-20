export type Unsubscribe = () => void;

export type ParamSetCallback<T> = (prev: T) => T;
export type ParamSetInput<T> = T | ParamSetCallback<T>;
export type ParamSubscribeCallback<T> = (next: T, prev: T) => void;

export interface ParamRef<T> {
  readonly kind: "param";
  readonly id: string;
  readonly name?: string;
  get(): T;
  set(valueOrCb: ParamSetInput<T>): ParamRef<T>;
  subscribe(cb: ParamSubscribeCallback<T>): Unsubscribe;
  displayName(name: string): ParamRef<T>;
}
