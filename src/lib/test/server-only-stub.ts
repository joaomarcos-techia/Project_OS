// Empty stub aliased in place of the `server-only` package under vitest.
// In the real build, `server-only` throws if a server module is pulled into a
// client bundle; that guard is irrelevant in the node test environment, where
// we exercise server modules directly. See vitest.config.ts resolve.alias.
export {};
