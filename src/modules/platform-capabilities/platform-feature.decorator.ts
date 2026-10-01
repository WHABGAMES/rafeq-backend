import { SetMetadata } from '@nestjs/common';

export const PLATFORM_FEATURE_KEY = 'platform_feature_key';

/** Declares which platform capability must be usable for this endpoint. */
export const RequirePlatformFeature = (featureKey: string) =>
  SetMetadata(PLATFORM_FEATURE_KEY, featureKey);
