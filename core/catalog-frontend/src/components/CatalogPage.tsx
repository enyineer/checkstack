import React from "react";
import { useApi, loggerApiRef } from "@checkmate-monitor/frontend-api";
import { catalogApiRef } from "../api";

export const CatalogPage = () => {
  const logger = useApi(loggerApiRef);
  const catalog = useApi(catalogApiRef);

  React.useEffect(() => {
    logger.info("Catalog Page loaded", catalog);
  }, [logger, catalog]);

  return (
    <div className="p-4 rounded-lg bg-white shadow">
      <h2 className="text-2xl font-semibold mb-4">Catalog</h2>
      <p className="text-muted-foreground">Welcome to the Service Catalog.</p>
    </div>
  );
};
