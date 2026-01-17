# Hello Terrain Infrastructure

This directory contains the Pulumi infrastructure code for the Hello Terrain project, organized into modular components for better maintainability and readability.

## Structure

The infrastructure is split into focused modules:

### `config.ts`
Centralizes all configuration logic including:
- Domain and environment configuration
- Domain parsing (parent domain, subdomain extraction)
- Environment variable handling

### `buckets.ts`
Handles all S3 bucket creation and configuration:
- Main site bucket (docs)
- Examples bucket
- Bucket versioning (V2)
- Bucket ACL configuration (V2)
- CORS configuration (V2)

### `cdn.ts`
Manages CloudFront CDN configuration:
- Origin Access Controls (OAC)
- Cache policies
- Response headers policies
- CloudFront distribution with multiple origins
- Cache behaviors for different path patterns

### `domain.ts`
Handles DNS and domain management:
- Route 53 hosted zone lookup
- DNS record creation
- Domain validation

### `deployment.ts`
Manages deployment-related resources:
- Asset uploads to S3
- CloudFront cache invalidation
- Deployment dependencies

### `certificate.ts`
Handles SSL certificate creation and validation (existing module)

### `assets.ts`
Handles asset upload utilities (existing module)

## Usage

The main `index.ts` file orchestrates all modules in the correct order:

1. **Configuration** - Load and parse configuration
2. **Buckets** - Create S3 buckets and their configurations
3. **Certificate** - Create and validate SSL certificate
4. **CDN** - Create CloudFront distribution and policies
5. **Domain** - Create DNS records
6. **Deployment** - Upload assets and invalidate cache

## Benefits

- **Modularity**: Each component has a single responsibility
- **Reusability**: Components can be easily reused or modified
- **Testability**: Individual modules can be tested in isolation
- **Maintainability**: Changes to one component don't affect others
- **Readability**: Clear separation of concerns makes the code easier to understand

## Configuration

The infrastructure uses a centralized configuration system that supports:
- Pulumi config values
- Environment variables
- Default fallback values

Key configuration options:
- `domain`: The main domain name
- `environment`: Deployment environment (dev, prod, etc.)
- `domainName`: Full domain name for DNS records
