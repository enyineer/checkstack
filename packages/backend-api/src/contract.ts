// Helper to ensure backend routers implement their RPC contracts
// This provides compile-time type checking to prevent contract drift

export function validateRouter<TContract>() {
  return <TRouter extends TContract>(router: TRouter): TRouter => {
    return router;
  };
}
