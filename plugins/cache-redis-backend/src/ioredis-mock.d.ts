// `ioredis-mock` ships no types; it is an API-compatible drop-in for `ioredis`,
// so declare its default export as the ioredis client constructor. Test-only.
declare module "ioredis-mock" {
  import Redis from "ioredis";
  const RedisMock: typeof Redis;
  export default RedisMock;
}
