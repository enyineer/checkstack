import React from "react";
import { useApi, loggerApiRef } from "@checkstack/frontend-api";

export const CatalogPage = () => {
  const logger = useApi(loggerApiRef);

  React.useEffect(() => {
    logger.info("Catalog Page loaded");
  }, [logger]);

  return (
    <div className="p-4 rounded-lg bg-white shadow">
      <h2 className="text-2xl font-semibold mb-4">Catalog</h2>
      <p className="text-muted-foreground">Welcome to the Service Catalog.</p>
    </div>
  );
};
