# Hello Terrain

A modern 3D terrain generation library with comprehensive documentation and interactive examples.

## 🚀 Quick Start

### 1. Setup Environment

```bash
# Clone the repository
git clone <your-repo-url>
cd hello-terrain

# Install dependencies
pnpm install

# Create environment configuration
cp env.example .env
```

### 2. Configure Credentials

Edit the `.env` file with your actual credentials:
- AWS access keys
- Domain name (Route 53 hosted zone will be detected automatically)
- Pulumi access token

### 3. Deploy

```bash
# Deploy to development environment
./scripts/deploy-local.sh

# Or deploy to production via GitHub Actions
# (push to main branch)
```

## 📁 Project Structure

```
hello-terrain/
├── apps/
│   ├── docs/          # Vocs documentation
│   └── examples/      # React/Vite examples
├── packages/
│   ├── hello-terrain/
│   │   ├── react/     # React components
│   │   └── three/     # Three.js utilities
├── infrastructure/    # Pulumi infrastructure code
├── scripts/          # Deployment and setup scripts
└── .env              # Environment configuration (create this)
```

## 🌐 Deployment

The project is deployed to:
- **Main Site**: `https://hello-terrain.kenny.wtf`
- **Examples**: `https://hello-terrain.kenny.wtf/examples`

### Infrastructure

- **AWS S3**: Static file hosting
- **CloudFront**: CDN and caching
- **Route 53**: DNS management
- **ACM**: SSL certificate management
- **Pulumi**: Infrastructure as Code
- **Vocs**: React-based documentation framework

## 🛠️ Development

### Local Development

```bash
# Start docs development server
cd apps/docs
pnpm dev

# Start examples development server
cd apps/examples
pnpm dev
```

### Building

```bash
# Build all packages
pnpm build

# Build specific apps
cd apps/docs && pnpm build
cd apps/examples && pnpm build
```

## 📚 Documentation

- [Deployment Guide](DEPLOYMENT.md) - Complete deployment instructions
- [Infrastructure README](infrastructure/README.md) - Infrastructure details

## 🔧 Scripts

- `./scripts/deploy-local.sh` - Deploy to development environment
