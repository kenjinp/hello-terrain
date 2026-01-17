import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import Mime from "mime";

// Function to calculate file hash for etag
// biome-ignore lint/correctness/noUnusedVariables: <explanation>
function calculateFileHash(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash("md5");
  hashSum.update(fileBuffer);
  return hashSum.digest("hex");
}

// Function to recursively get all files in a directory
function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const files = fs.readdirSync(dirPath);

  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(fullPath);
    }
  }

  return arrayOfFiles;
}

// Function to upload assets to S3 bucket
export function uploadAssetsToS3(
  bucket: aws.s3.Bucket,
  localPath: string,
  resourceNamePrefix = ""
): aws.s3.BucketObject[] {
  const objects: aws.s3.BucketObject[] = [];

  if (!fs.existsSync(localPath)) {
    console.warn(
      `Warning: Local path ${localPath} does not exist. Skipping asset upload.`
    );
    return objects;
  }

  const files = getAllFiles(localPath);

  for (const filePath of files) {
    const relativePath = path.relative(localPath, filePath);
    const key = relativePath.replace(/\\/g, "/");
    const contentType = Mime.getType(filePath) || undefined;

    const resourceName = [
      resourceNamePrefix || "asset",
      relativePath.replace(/[^a-zA-Z0-9]/g, "-"),
    ]
      .filter(Boolean)
      .join("-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    const object = new aws.s3.BucketObject(resourceName, {
      bucket: bucket.bucket,
      key,
      source: new pulumi.asset.FileAsset(filePath),
      contentType,
      //   etag: calculateFileHash(filePath),
    });

    objects.push(object);
  }

  return objects;
}
