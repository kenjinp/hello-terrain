#!/bin/bash

# Local deployment script for Hello Terrain infrastructure
set -e

echo "🚀 Starting local deployment..."

# Load environment variables from .env file
# Try to find .env file in project root (works whether script is run from root or scripts/ directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env"

if [ -f "$ENV_FILE" ]; then
    echo "📄 Loading environment variables from .env file..."
    export $(cat "$ENV_FILE" | grep -v '^#' | xargs)
else
    echo "❌ Error: .env file not found at $ENV_FILE"
    echo ""
    echo "Please create a .env file in the project root with your credentials:"
    echo "1. Copy env.example to .env: cp env.example .env"
    echo "2. Edit .env with your actual credentials"
    echo "3. Run this script again"
    echo ""
    exit 1
fi

# Check if required environment variables are set
if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
    echo "❌ Error: AWS credentials not set in .env file"
    echo "Please add AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to your .env file"
    exit 1
fi

if [ -z "$DOMAIN_NAME" ]; then
    echo "❌ Error: Domain name not set in .env file"
    echo "Please add DOMAIN_NAME to your .env file"
    exit 1
fi

# Build docs
echo "📚 Building docs..."
# cd apps/docs
pnpm build
cd ../..

# Deploy infrastructure
echo "🏗️  Deploying infrastructure..."
cd infrastructure

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing infrastructure dependencies..."
    pnpm install
fi

# Set Pulumi configuration
echo "⚙️  Configuring Pulumi..."
pulumi config set aws:region ${PULUMI_AWS_REGION:-us-east-1}
pulumi config set domain ${DOMAIN:-hello-terrain.kenny.wtf}
pulumi config set environment ${ENVIRONMENT:-dev}
pulumi config set route53:domainName ${DOMAIN_NAME:-hello-terrain.kenny.wtf}

# Deploy infrastructure and assets
echo "🚀 Deploying infrastructure and assets to AWS..."
PULUMI_NODEJS_EXEC=ts-node pulumi up --yes

cd ..

echo "✅ Deployment completed successfully!"
echo "🌐 Main site: https://hello-terrain.kenny.wtf"
echo "🎮 Examples: https://hello-terrain.kenny.wtf/examples"
echo "⚠️  Note: DNS changes may take a few minutes to propagate"
