import * as aws from "@pulumi/aws";
import { uploadAssetsToS3 } from "./assets.js";
import { createBuckets } from "./buckets.js";
import { createCdn } from "./cdn.js";
import { certificateValidation } from "./certificate.js";
import { getConfig } from "./config.js";
import { createDomain } from "./domain.js";

// Get configuration
const config = getConfig();

// Get hosted zone for certificate validation
const hostedZone = aws.route53.getZone(
  {
    name: config.parentDomain,
  },
  { async: true }
);

const hostedZoneId = hostedZone.then((zone) => zone.zoneId);

// Create SSL certificate and validation
const validation = certificateValidation(
  config.domain,
  config.domainName,
  config.environment,
  hostedZoneId
);

// Create CloudFront origin access identities first
const mainOai = new aws.cloudfront.OriginAccessIdentity(
  "hello-terrain-main-oai",
  {
    comment: `OAI for ${config.domain} main site`,
  }
);

// Examples removed

// Create S3 buckets and their configurations with OAI
const buckets = createBuckets(config, mainOai);

// Create CDN with CloudFront distribution
const cdn = createCdn(config, buckets, validation.certificateArn, mainOai);

// Create domain DNS records
const domain = createDomain(
  config,
  cdn.distribution.domainName,
  cdn.distribution.hostedZoneId
);

// Upload assets to S3 buckets
uploadAssetsToS3(buckets.mainBucket, "../apps/docs/out", "docs");
// Examples removed

// Outputs
export const mainBucketName = buckets.mainBucket.bucket;
export const distributionDomain = cdn.distribution.domainName;
export const distributionId = cdn.distribution.id;
export const dnsRecordName = domain.dnsRecord.name;
export const dnsRecordFqdn = domain.dnsRecord.fqdn;
