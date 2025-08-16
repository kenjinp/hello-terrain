import * as aws from "@pulumi/aws";
import type * as pulumi from "@pulumi/pulumi";
import type { BucketResources } from "./buckets.js";
import type { InfrastructureConfig } from "./config.js";

export interface CdnResources {
  mainOai: aws.cloudfront.OriginAccessIdentity;
  cachePolicy: aws.cloudfront.CachePolicy;
  headersPolicy: aws.cloudfront.ResponseHeadersPolicy;
  distribution: aws.cloudfront.Distribution;
}

export function createCdn(
  config: InfrastructureConfig,
  buckets: BucketResources,
  certificateArn: pulumi.Output<string>,
  mainOai: aws.cloudfront.OriginAccessIdentity
): CdnResources {
  const { domain, environment } = config;

  // Create CloudFront cache policy
  const cachePolicy = new aws.cloudfront.CachePolicy(
    "hello-terrain-cache-policy",
    {
      name: `hello-terrain-cache-${environment}`,
      comment: `Cache policy for ${domain} ${environment}`,
      defaultTtl: 86400, // 24 hours
      maxTtl: 31536000, // 1 year
      minTtl: 0,
      parametersInCacheKeyAndForwardedToOrigin: {
        cookiesConfig: {
          cookieBehavior: "none",
        },
        headersConfig: {
          headerBehavior: "none",
        },
        queryStringsConfig: {
          queryStringBehavior: "none",
        },
      },
    }
  );

  // Create CloudFront response headers policy
  const headersPolicy = new aws.cloudfront.ResponseHeadersPolicy("cdnHeaders", {
    name: `hello-terrain-headers-${environment}`,
    comment: `Response headers policy for ${domain} ${environment}`,
    customHeadersConfig: {
      items: [
        {
          header: "Cross-Origin-Opener-Policy",
          override: true,
          value: "same-origin",
        },
        {
          header: "Cross-Origin-Embedder-Policy",
          override: true,
          value: "require-corp",
        },
      ],
    },
  });

  // Create CloudFront distribution
  const distribution = new aws.cloudfront.Distribution(
    "hello-terrain-distribution",
    {
      enabled: true,
      isIpv6Enabled: true,
      defaultRootObject: "index.html",
      aliases: [domain],

      origins: [
        {
          domainName: buckets.mainBucket.bucketDomainName,
          originId: "main",
          s3OriginConfig: {
            originAccessIdentity: mainOai.cloudfrontAccessIdentityPath,
          },
        },
      ],

      // "All" is the most broad distribution, and also the most expensive.
      // "100" is the least broad, and also the least expensive.
      priceClass: "PriceClass_100",

      defaultCacheBehavior: {
        responseHeadersPolicyId: headersPolicy.id,
        allowedMethods: ["GET", "HEAD", "OPTIONS"],
        cachedMethods: ["GET", "HEAD"],
        targetOriginId: "main",
        cachePolicyId: cachePolicy.id,
        viewerProtocolPolicy: "redirect-to-https",
        compress: true,
      },

      orderedCacheBehaviors: [],

      // Serve SPA index on missing objects so deep links work on refresh
      customErrorResponses: [
        {
          errorCode: 403,
          responseCode: 200,
          responsePagePath: "/index.html",
          errorCachingMinTtl: 0,
        },
        {
          errorCode: 404,
          responseCode: 404,
          responsePagePath: "/404.html",
          errorCachingMinTtl: 0,
        },
      ],

      viewerCertificate: {
        acmCertificateArn: certificateArn,
        sslSupportMethod: "sni-only",
        minimumProtocolVersion: "TLSv1.2_2021",
      },

      restrictions: {
        geoRestriction: {
          restrictionType: "none",
        },
      },

      tags: {
        Environment: environment,
        Project: "hello-terrain",
        Domain: domain,
      },
    }
  );

  return {
    mainOai,
    cachePolicy,
    headersPolicy,
    distribution,
  };
}
