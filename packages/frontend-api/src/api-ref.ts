export type ApiRef<T> = {
  id: string;
  T: T;
  toString(): string;
};

export function createApiRef<T>(id: string): ApiRef<T> {
  return {
    id,
    T: undefined as T,
    toString() {
      return `ApiRef(${id})`;
    },
  };
}
