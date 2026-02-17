import * as aws from "@pulumi/aws";
import type * as pulumi from "@pulumi/pulumi";
import type { BucketResources } from "./buckets.js";
import type { InfrastructureConfig } from "./config.js";

export interface CdnResources {
  mainOai: aws.cloudfront.OriginAccessIdentity;
  cachePolicy: aws.cloudfront.CachePolicy;
  headersPolicy: aws.cloudfront.ResponseHeadersPolicy;
  urlRewriteFunction: aws.cloudfront.Function;
  distribution: aws.cloudfront.Distribution;
}

export function createCdn(
  config: InfrastructureConfig,
  buckets: BucketResources,
  certificateArn: pulumi.Output<string>,
  mainOai: aws.cloudfront.OriginAccessIdentity,
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
    },
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

  // Response headers policy for external assets — enables CORS so assets can be
  // fetched cross-origin (e.g. from localhost during development)
  const externalHeadersPolicy = new aws.cloudfront.ResponseHeadersPolicy(
    "cdnExternalHeaders",
    {
      name: `hello-terrain-external-headers-${environment}`,
      comment: `Response headers for external assets - ${environment}`,
      corsConfig: {
        accessControlAllowCredentials: false,
        accessControlAllowHeaders: { items: ["*"] },
        accessControlAllowMethods: { items: ["GET", "HEAD"] },
        accessControlAllowOrigins: {
          items: [
            "https://*.kenny.wtf",
            "http://localhost:*",
            "https://localhost:*",
            "https://*.codesandbox.io",
            "https://*.csb.app",
          ],
        },
        accessControlExposeHeaders: {
          items: ["ETag", "Content-Length", "Content-Type"],
        },
        accessControlMaxAgeSec: 86400,
        originOverride: true,
      },
    },
  );

  // Create CloudFront Function to rewrite URLs for Next.js static export
  const urlRewriteFunction = new aws.cloudfront.Function(
    "url-rewrite-function",
    {
      name: `hello-terrain-url-rewrite-${environment}`,
      runtime: "cloudfront-js-2.0",
      comment: `URL rewrite function for Next.js static export - ${environment}`,
      code: `function handler(event) {
          var request = event.request;
          var uri = request.uri;

          // Skip rewriting for /api/ paths (e.g., /api/search is a static JSON file)
          if (uri.startsWith('/api/')) {
            return request;
          }

          // Skip rewriting for /external/ paths (direct asset serving)
          if (uri.startsWith('/external/')) {
            return request;
          }

          // Check if URI is missing a file extension and doesn't end with /
          if (!uri.includes('.') && !uri.endsWith('/')) {
            request.uri = uri + '.html';
          }
          // If URI ends with /, append index.html
          else if (uri.endsWith('/')) {
            request.uri = uri + 'index.html';
          }

          return request;
      }`,
      publish: true,
    },
  );

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
        functionAssociations: [
          {
            eventType: "viewer-request",
            functionArn: urlRewriteFunction.arn,
          },
        ],
      },

      orderedCacheBehaviors: [
        {
          pathPattern: "external/*",
          allowedMethods: ["GET", "HEAD", "OPTIONS"],
          cachedMethods: ["GET", "HEAD"],
          targetOriginId: "main",
          cachePolicyId: cachePolicy.id,
          responseHeadersPolicyId: externalHeadersPolicy.id,
          viewerProtocolPolicy: "redirect-to-https",
          compress: true,
          // No URL rewrite function — assets are served directly by their S3 key
        },
      ],

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
          responseCode: 200,
          responsePagePath: "/index.html",
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
    },
  );

  return {
    mainOai,
    cachePolicy,
    headersPolicy,
    urlRewriteFunction,
    distribution,
  };
}
