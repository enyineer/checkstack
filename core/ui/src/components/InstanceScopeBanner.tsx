import {
  InfoBanner,
  InfoBannerIcon,
  InfoBannerContent,
  InfoBannerTitle,
  InfoBannerDescription,
} from "./InfoBanner";
import { AlertTriangle } from "lucide-react";

/**
 * Warns operators that the metrics being displayed reflect a single process
 * — relevant when the underlying backend is in-memory and the deployment is
 * (or could become) horizontally scaled.
 *
 * Renders nothing when `scope === "cluster"`.
 */
export interface InstanceScopeBannerProps {
  scope: "instance" | "cluster";
  /** What the metrics are about ("Queue" / "Cache"). Used in the title only. */
  subject: string;
  /** Recommendation text — e.g. "switch to a Redis-backed queue". */
  recommendation: string;
}

export const InstanceScopeBanner = ({
  scope,
  subject,
  recommendation,
}: InstanceScopeBannerProps) => {
  if (scope === "cluster") return null;
  return (
    <InfoBanner variant="warning">
      <InfoBannerIcon>
        <AlertTriangle className="h-4 w-4" />
      </InfoBannerIcon>
      <InfoBannerContent>
        <InfoBannerTitle>{subject}: instance-local metrics</InfoBannerTitle>
        <InfoBannerDescription>
          These figures reflect this server instance only. In a horizontally
          scaled deployment, each replica reports its own numbers depending on
          which one your request hit. {recommendation}
        </InfoBannerDescription>
      </InfoBannerContent>
    </InfoBanner>
  );
};
