export type ServiceRef<T> = {
  id: string;
  T: T;
  toString(): string;
};

export function createServiceRef<T>(id: string): ServiceRef<T> {
  return {
    id,
    T: undefined as T,
    toString() {
      return `ServiceRef(${id})`;
    },
  };
}
