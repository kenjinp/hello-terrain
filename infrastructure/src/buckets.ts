import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import type { InfrastructureConfig } from "./config.js";

export interface BucketResources {
  mainBucket: aws.s3.Bucket;
  mainBucketVersioning: aws.s3.BucketVersioning;
  mainBucketAcl: aws.s3.BucketAcl;
  mainBucketCors: aws.s3.BucketCorsConfiguration;
  mainBucketPolicy: aws.s3.BucketPolicy;
}

// Configure ACL for buckets with proper ownership controls and public access block
function configureACL(
  bucketName: string,
  bucket: aws.s3.Bucket,
  acl: string
): aws.s3.BucketAcl {
  const ownership = new aws.s3.BucketOwnershipControls(
    `${bucketName}-ownership`,
    {
      bucket: bucket.bucket,
      rule: {
        objectOwnership: "BucketOwnerPreferred",
      },
    }
  );
  const publicAccessBlock = new aws.s3.BucketPublicAccessBlock(
    `${bucketName}-public-access`,
    {
      bucket: bucket.bucket,
      blockPublicAcls: false,
      blockPublicPolicy: false,
      ignorePublicAcls: false,
      restrictPublicBuckets: false,
    }
  );
  const bucketACL = new aws.s3.BucketAcl(
    `${bucketName}-acl`,
    {
      bucket: bucket.bucket,
      acl: acl,
    },
    {
      dependsOn: [ownership, publicAccessBlock],
    }
  );
  return bucketACL;
}

export function createBuckets(
  config: InfrastructureConfig,
  mainOai: aws.cloudfront.OriginAccessIdentity
): BucketResources {
  const { domain, environment } = config;

  // Create S3 bucket for the main site (docs)
  const mainBucket = new aws.s3.Bucket("hello-terrain-main", {
    bucket: `${domain}-${environment}`,
    tags: {
      Environment: environment,
      Project: "hello-terrain",
      Domain: domain,
    },
  });

  new aws.s3.BucketWebsiteConfiguration("mainBucketWebsite", {
    bucket: mainBucket.bucket,
    indexDocument: { suffix: "index.html" },
    errorDocument: { key: "404.html" },
  });

  // Configure versioning for main bucket
  const mainBucketVersioning = new aws.s3.BucketVersioning(
    "hello-terrain-main-versioning",
    {
      bucket: mainBucket.id,
      versioningConfiguration: {
        status: "Enabled",
      },
    }
  );

  // Configure ACL for main bucket
  const mainBucketAcl = configureACL(
    "hello-terrain-main",
    mainBucket,
    "private"
  );

  // Configure CORS for main bucket
  const mainBucketCors = new aws.s3.BucketCorsConfiguration(
    "hello-terrain-main-cors",
    {
      bucket: mainBucket.id,
      corsRules: [
        {
          allowedHeaders: ["*"],
          allowedMethods: ["GET", "HEAD"],
          allowedOrigins: ["*"],
          exposeHeaders: ["ETag"],
          maxAgeSeconds: 3000,
        },
      ],
    }
  );

  // Create bucket policies for CloudFront access
  const mainBucketPolicy = new aws.s3.BucketPolicy(
    "hello-terrain-main-policy",
    {
      bucket: mainBucket.id,
      policy: pulumi.jsonStringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "AllowCloudFrontOAI",
            Effect: "Allow",
            Principal: {
              AWS: mainOai.iamArn,
            },
            Action: "s3:GetObject",
            Resource: [pulumi.interpolate`${mainBucket.arn}/*`],
          },
        ],
      }),
    }
  );

  return {
    mainBucket,
    mainBucketVersioning,
    mainBucketAcl,
    mainBucketCors,
    mainBucketPolicy,
  };
}
