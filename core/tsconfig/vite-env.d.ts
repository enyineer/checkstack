// Minimal subset of `vite/client` types that frontend packages depend on.
// We don't depend on `vite` package-wide (only `core/frontend` does), but
// several packages use `import.meta.env` and side-effect CSS imports.
//
// Kept here so all extending tsconfigs see it via `include`.

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
  readonly BASE_URL: string;
  readonly SSR: boolean;
  readonly [key: string]: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  glob<T = Record<string, unknown>>(
    pattern: string | string[],
    options?: { eager?: boolean; import?: string; query?: string },
  ): Record<string, T>;
}

declare module "*.css" {}
declare module "*.scss" {}
declare module "*.svg" {
  const content: string;
  export default content;
}
declare module "*.png" {
  const content: string;
  export default content;
}
declare module "*.jpg" {
  const content: string;
  export default content;
}
