# Production Deployment Guide

**Version**: 1.0.0
**Last Updated**: 2026-01-10
**Status**: PRE-PRODUCTION (Pending Test Coverage)

## ⚠️ CRITICAL: Pre-Deployment Checklist

**DO NOT DEPLOY TO PRODUCTION** until all items are checked:

- [ ] **Test Coverage**: Minimum 85% coverage achieved
  - Current: 14.69% ❌
  - Blocker: OpenAIRealtimeAdapter has 0% coverage
  - Required: Complete P0/P1 tests from QA assessment

- [ ] **Integration Tests**: All critical paths tested
  - [ ] Voice pipeline end-to-end
  - [ ] Lane arbitration edge cases
  - [ ] WebSocket reconnection logic
  - [ ] Barge-in functionality

- [ ] **Performance Tests**: TTFB < 400ms validated
  - [ ] Latency testing under load
  - [ ] Concurrent session tests (100+ users)
  - [ ] Memory leak detection
  - [ ] WebSocket connection stability

- [ ] **Security Audit**: All vulnerabilities addressed
  - [ ] Dependency scan (npm audit)
  - [ ] API key rotation policy
  - [ ] Rate limiting implementation
  - [ ] CORS configuration review

- [ ] **Monitoring Setup**: Production observability ready
  - [ ] Error tracking (Sentry/Datadog)
  - [ ] Performance monitoring (APM)
  - [ ] Log aggregation (CloudWatch/LogDNA)
  - [ ] Alerting thresholds configured

**Estimated Timeline**: 3-4 weeks from current state (see `docs/qa/production-readiness-assessment.md`)

---

## Architecture Overview

### System Components

```
┌─────────────────────────────────────────────────────────┐
│                     Production Stack                     │
└─────────────────────────────────────────────────────────┘

┌──────────────┐     HTTPS/WSS      ┌──────────────┐
│              │◄───────────────────►│              │
│   Client     │                     │  Load        │
│   (React)    │                     │  Balancer    │
│              │                     │  (ALB/nginx) │
└──────────────┘                     └───────┬──────┘
                                             │
                        ┌────────────────────┴────────────┐
                        │                                  │
                ┌───────▼──────┐                  ┌───────▼──────┐
                │   Server     │                  │   Server     │
                │   Instance 1 │                  │   Instance 2 │
                │   (Node.js)  │                  │   (Node.js)  │
                └───────┬──────┘                  └───────┬──────┘
                        │                                  │
                        └────────────────┬─────────────────┘
                                         │
                                ┌────────▼────────┐
                                │   OpenAI        │
                                │   Realtime API  │
                                │   (External)    │
                                └─────────────────┘
```

### Key Infrastructure

- **Client**: Static hosting (S3 + CloudFront, Vercel, or Netlify)
- **Server**: Container orchestration (ECS, Kubernetes, or Docker Swarm)
- **Load Balancer**: ALB (AWS), nginx, or Caddy
- **Monitoring**: Sentry, Datadog, or New Relic
- **Logging**: CloudWatch, LogDNA, or Papertrail

---

## Part 1: Environment Setup

### 1.1 Prerequisites

**Required**:
- Node.js 18+ (LTS)
- npm 9+
- Docker 24+ (for containerized deployment)
- Git 2.30+

**Cloud Provider** (choose one):
- AWS (recommended): ECS + ALB + S3 + CloudFront
- Google Cloud: Cloud Run + Cloud CDN
- Azure: Container Apps + CDN
- DigitalOcean: App Platform + Spaces

**Third-Party Services**:
- OpenAI API account with Realtime API access
- Domain name with SSL certificate
- Monitoring service (Sentry, Datadog, etc.)

### 1.2 Environment Variables

Create production `.env` file:

```bash
# Server Configuration
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# OpenAI Realtime API
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxx
OPENAI_MODEL=gpt-4o-realtime-preview-2024-12-17

# CORS Configuration
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# WebSocket Configuration
WS_HEARTBEAT_INTERVAL=30000  # 30 seconds
WS_MAX_PAYLOAD=1048576       # 1MB

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000   # 1 minute
RATE_LIMIT_MAX_REQUESTS=100  # 100 requests per minute

# Monitoring
SENTRY_DSN=https://xxxxxxxxxxxxx@sentry.io/xxxxxxx
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1  # 10% of transactions

# Feature Flags
LANE_A_ENABLED=true
MIN_DELAY_BEFORE_REFLEX_MS=100
MAX_REFLEX_DURATION_MS=2000
PREEMPT_THRESHOLD_MS=300
TRANSITION_GAP_MS=10

# Health Check
HEALTH_CHECK_PATH=/health
```

**Security Notes**:
- NEVER commit `.env` to git
- Use secrets management (AWS Secrets Manager, Google Secret Manager, etc.)
- Rotate API keys quarterly
- Use different keys for staging and production

### 1.3 Build Configuration

**Client Build** (`client/vite.config.ts`):
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,  // Disable sourcemaps in prod (security)
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,  // Remove console.logs
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
```

**Server Build** (`server/tsconfig.json`):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "sourceMap": false  // Disable sourcemaps in prod
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "**/*.test.ts", "**/__tests__"]
}
```

---

## Part 2: Containerization

### 2.1 Dockerfile (Multi-Stage Build)

**Server Dockerfile** (`server/Dockerfile`):
```dockerfile
# Stage 1: Build
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Stage 2: Production
FROM node:18-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start server
CMD ["node", "dist/index.js"]
```

**Client Dockerfile** (`client/Dockerfile`):
```dockerfile
# Stage 1: Build
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build for production
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine AS production

# Copy built files
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
```

**nginx.conf** (`client/nginx.conf`):
```nginx
server {
  listen 80;
  server_name _;

  root /usr/share/nginx/html;
  index index.html;

  # Gzip compression
  gzip on;
  gzip_vary on;
  gzip_min_length 10240;
  gzip_proxied expired no-cache no-store private auth;
  gzip_types text/plain text/css text/xml text/javascript application/javascript application/json;

  # Security headers
  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-XSS-Protection "1; mode=block" always;
  add_header Referrer-Policy "no-referrer-when-downgrade" always;

  # SPA routing
  location / {
    try_files $uri $uri/ /index.html;
  }

  # Cache static assets
  location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }

  # Proxy API requests
  location /api {
    proxy_pass http://server:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }

  # Proxy WebSocket
  location /ws {
    proxy_pass http://server:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 86400;  # 24 hours for long-lived connections
  }
}
```

### 2.2 Docker Compose (Orchestration)

**docker-compose.yml**:
```yaml
version: '3.8'

services:
  client:
    build:
      context: ./client
      dockerfile: Dockerfile
    ports:
      - "80:80"
    depends_on:
      - server
    restart: unless-stopped
    networks:
      - app-network

  server:
    build:
      context: ./server
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    env_file:
      - ./server/.env.production
    restart: unless-stopped
    networks:
      - app-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 10s

networks:
  app-network:
    driver: bridge
```

**Build and Test**:
```bash
# Build images
docker-compose build

# Run locally
docker-compose up -d

# Check logs
docker-compose logs -f

# Stop
docker-compose down
```

---

## Part 3: Cloud Deployment

### 3.1 AWS Deployment (Recommended)

#### Prerequisites
- AWS account with billing enabled
- AWS CLI configured (`aws configure`)
- ECR repository created
- ECS cluster created

#### Step 1: Push Images to ECR

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com

# Build and tag images
docker build -t voice-jib-jab-server ./server
docker tag voice-jib-jab-server:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/voice-jib-jab-server:latest

docker build -t voice-jib-jab-client ./client
docker tag voice-jib-jab-client:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/voice-jib-jab-client:latest

# Push to ECR
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/voice-jib-jab-server:latest
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/voice-jib-jab-client:latest
```

#### Step 2: Create ECS Task Definition

**task-definition.json**:
```json
{
  "family": "voice-jib-jab",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "containerDefinitions": [
    {
      "name": "server",
      "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/voice-jib-jab-server:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        }
      ],
      "secrets": [
        {
          "name": "OPENAI_API_KEY",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:openai-api-key"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/voice-jib-jab",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
```

#### Step 3: Create ECS Service

```bash
aws ecs create-service \
  --cluster voice-jib-jab-cluster \
  --service-name voice-jib-jab-service \
  --task-definition voice-jib-jab \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-12345,subnet-67890],securityGroups=[sg-12345],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/voice-jib-jab/50dc6c495c0c9188,containerName=server,containerPort=3000"
```

#### Step 4: Configure Application Load Balancer

1. Create Target Group (port 3000, health check `/health`)
2. Create ALB with HTTPS listener (443)
3. Attach SSL certificate (ACM)
4. Configure listener rules:
   - `/api/*` → Forward to server target group
   - `/ws` → Forward to server target group (enable WebSocket)
   - `/*` → Forward to client target group (S3 or CloudFront)

#### Step 5: Deploy Client to S3 + CloudFront

```bash
# Build client
cd client && npm run build

# Upload to S3
aws s3 sync dist/ s3://voice-jib-jab-client/ --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id E1234567890ABC \
  --paths "/*"
```

### 3.2 Alternative: Vercel + Railway

**Client (Vercel)**:
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
cd client
vercel --prod
```

**Server (Railway)**:
```bash
# Install Railway CLI
npm i -g @railway/cli

# Deploy
cd server
railway up
```

---

## Part 4: Monitoring & Observability

### 4.1 Sentry Setup (Error Tracking)

**Server Integration** (`server/src/index.ts`):
```typescript
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || "production",
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"),
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
  ],
});

// Error handler middleware
app.use(Sentry.Handlers.errorHandler());
```

**Client Integration** (`client/src/main.tsx`):
```typescript
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  tracesSampleRate: 0.1,
  integrations: [
    new Sentry.BrowserTracing(),
    new Sentry.Replay({
      maskAllText: false,
      blockAllMedia: false,
    }),
  ],
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
```

### 4.2 CloudWatch Metrics (AWS)

**Custom Metrics**:
```typescript
import { CloudWatch } from "aws-sdk";

const cloudwatch = new CloudWatch();

// Track TTFB
function trackTTFB(latencyMs: number) {
  cloudwatch.putMetricData({
    Namespace: "VoiceJibJab",
    MetricData: [
      {
        MetricName: "TTFB",
        Value: latencyMs,
        Unit: "Milliseconds",
        Timestamp: new Date(),
      },
    ],
  });
}

// Track concurrent sessions
function trackConcurrentSessions(count: number) {
  cloudwatch.putMetricData({
    Namespace: "VoiceJibJab",
    MetricData: [
      {
        MetricName: "ConcurrentSessions",
        Value: count,
        Unit: "Count",
        Timestamp: new Date(),
      },
    ],
  });
}
```

### 4.3 Alerting Configuration

**CloudWatch Alarms**:
```bash
# High error rate
aws cloudwatch put-metric-alarm \
  --alarm-name voice-jib-jab-high-error-rate \
  --alarm-description "Error rate > 5%" \
  --metric-name Errors \
  --namespace VoiceJibJab \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:voice-jib-jab-alerts

# High latency
aws cloudwatch put-metric-alarm \
  --alarm-name voice-jib-jab-high-latency \
  --alarm-description "TTFB > 500ms" \
  --metric-name TTFB \
  --namespace VoiceJibJab \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 500 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:voice-jib-jab-alerts
```

---

## Part 5: Performance Optimization

### 5.1 CDN Configuration

**CloudFront Distribution**:
- **Cache Behavior**: Cache static assets (JS, CSS, images) for 1 year
- **Compression**: Enable Gzip/Brotli
- **HTTP/2**: Enable
- **WebSocket Support**: Enable for `/ws` path

### 5.2 Database Optimization (Future)

When adding persistent storage:
- **Read Replicas**: For read-heavy workloads
- **Connection Pooling**: Max 10 connections per instance
- **Query Caching**: Redis for frequently accessed data

### 5.3 Auto-Scaling

**ECS Auto-Scaling Policy**:
```bash
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --scalable-dimension ecs:service:DesiredCount \
  --resource-id service/voice-jib-jab-cluster/voice-jib-jab-service \
  --min-capacity 2 \
  --max-capacity 10

aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --scalable-dimension ecs:service:DesiredCount \
  --resource-id service/voice-jib-jab-cluster/voice-jib-jab-service \
  --policy-name cpu-scaling \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration file://scaling-policy.json
```

**scaling-policy.json**:
```json
{
  "TargetValue": 70.0,
  "PredefinedMetricSpecification": {
    "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
  },
  "ScaleInCooldown": 300,
  "ScaleOutCooldown": 60
}
```

---

## Part 6: Security Hardening

### 6.1 API Key Rotation

**Quarterly Rotation Schedule**:
1. Generate new OpenAI API key
2. Update Secrets Manager
3. Deploy new ECS task definition
4. Wait 24 hours (allow old key to drain)
5. Revoke old API key

### 6.2 Rate Limiting

**Server Implementation** (`server/src/middleware/rateLimit.ts`):
```typescript
import rateLimit from "express-rate-limit";

export const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000"),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100"),
  message: "Too many requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply to API routes
app.use("/api/", apiLimiter);
```

### 6.3 CORS Configuration

**Production CORS** (`server/src/middleware/cors.ts`):
```typescript
import cors from "cors";

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [];

export const corsConfig = cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
});
```

### 6.4 Dependency Scanning

```bash
# Run npm audit
npm audit --production

# Fix vulnerabilities
npm audit fix

# Generate report
npm audit --json > audit-report.json
```

---

## Part 7: Disaster Recovery

### 7.1 Backup Strategy

**Data to Backup**:
- Environment variables (encrypted)
- Configuration files
- User data (if applicable)
- Session logs (7-day retention)

**Backup Schedule**:
- Real-time: Application logs → CloudWatch
- Daily: Configuration snapshots → S3
- Weekly: Full system backup

### 7.2 Rollback Procedure

**ECS Rollback**:
```bash
# List task definition revisions
aws ecs list-task-definitions --family-prefix voice-jib-jab

# Update service to previous revision
aws ecs update-service \
  --cluster voice-jib-jab-cluster \
  --service voice-jib-jab-service \
  --task-definition voice-jib-jab:42
```

**Client Rollback (S3)**:
```bash
# List S3 versions
aws s3api list-object-versions --bucket voice-jib-jab-client

# Restore previous version
aws s3api copy-object \
  --copy-source voice-jib-jab-client/index.html?versionId=xxxxx \
  --bucket voice-jib-jab-client \
  --key index.html
```

### 7.3 Incident Response

**Severity Levels**:
- **P0 (Critical)**: Service down, data loss imminent
  - Response time: < 15 minutes
  - Escalation: Page on-call engineer

- **P1 (High)**: Degraded performance, > 10% error rate
  - Response time: < 1 hour
  - Escalation: Slack alert

- **P2 (Medium)**: Minor issues, < 1% error rate
  - Response time: < 4 hours
  - Escalation: Email alert

**Incident Checklist**:
1. Acknowledge alert (Slack/PagerDuty)
2. Assess severity and impact
3. Check recent deployments (rollback if needed)
4. Review logs (CloudWatch, Sentry)
5. Apply hotfix or rollback
6. Monitor recovery metrics
7. Post-mortem within 48 hours

---

## Part 8: CI/CD Pipeline

### 8.1 GitHub Actions Workflow

**.github/workflows/deploy.yml**:
```yaml
name: Deploy to Production

on:
  push:
    branches:
      - main

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
      - run: npm test
      - run: npm run lint

  build-and-deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v1

      - name: Build and push server image
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          ECR_REPOSITORY: voice-jib-jab-server
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG ./server
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG

      - name: Deploy to ECS
        run: |
          aws ecs update-service \
            --cluster voice-jib-jab-cluster \
            --service voice-jib-jab-service \
            --force-new-deployment

      - name: Build and deploy client
        run: |
          cd client
          npm ci
          npm run build
          aws s3 sync dist/ s3://voice-jib-jab-client/ --delete
          aws cloudfront create-invalidation --distribution-id ${{ secrets.CLOUDFRONT_DISTRIBUTION_ID }} --paths "/*"
```

### 8.2 Quality Gates

**Required Checks Before Deploy**:
```yaml
# .github/workflows/quality-gate.yml
name: Quality Gate

on:
  pull_request:
    branches:
      - main

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test -- --coverage

      - name: Check coverage threshold
        run: |
          COVERAGE=$(npm test -- --coverage --silent | grep "All files" | awk '{print $10}' | sed 's/%//')
          if (( $(echo "$COVERAGE < 85" | bc -l) )); then
            echo "Coverage $COVERAGE% is below 85% threshold"
            exit 1
          fi

      - name: Run linter
        run: npm run lint

      - name: Check bundle size
        run: |
          npm run build
          SIZE=$(du -sk client/dist | awk '{print $1}')
          if [ $SIZE -gt 1024 ]; then
            echo "Bundle size ${SIZE}KB exceeds 1MB limit"
            exit 1
          fi
```

---

## Part 9: Cost Optimization

### 9.1 Estimated Monthly Costs (AWS)

**Assumptions**:
- 10,000 active users
- Average session: 5 minutes
- 50,000 sessions/month

**Breakdown**:
```
ECS Fargate (2 tasks, 1 vCPU, 2GB):       $60/month
Application Load Balancer:                $25/month
CloudFront (10GB data transfer):          $10/month
S3 (1GB storage, 100,000 requests):       $2/month
CloudWatch Logs (10GB/month):             $5/month
Secrets Manager (1 secret):               $0.40/month
OpenAI Realtime API (50,000 sessions):    $500/month (estimate)
---------------------------------------------------
TOTAL:                                    ~$602/month
```

### 9.2 Cost Reduction Strategies

1. **Reserved Capacity**: Save 30% with 1-year ECS commitment
2. **S3 Lifecycle Policies**: Archive logs to Glacier after 30 days
3. **CloudFront Caching**: Reduce origin requests by 80%
4. **Auto-Scaling**: Scale down during off-peak hours
5. **OpenAI Optimization**: Cache common responses (if applicable)

---

## Part 10: Post-Deployment Verification

### 10.1 Smoke Tests

```bash
#!/bin/bash
# smoke-test.sh

BASE_URL="https://api.yourdomain.com"

# Health check
echo "Testing health endpoint..."
curl -f $BASE_URL/health || exit 1

# WebSocket connection
echo "Testing WebSocket..."
wscat -c wss://api.yourdomain.com/ws -x '{"type":"ping"}' || exit 1

# API response time
echo "Testing API latency..."
RESPONSE_TIME=$(curl -o /dev/null -s -w '%{time_total}\n' $BASE_URL/api/status)
if (( $(echo "$RESPONSE_TIME > 0.5" | bc -l) )); then
  echo "API too slow: ${RESPONSE_TIME}s"
  exit 1
fi

echo "✅ All smoke tests passed"
```

### 10.2 Performance Baseline

**Expected Metrics** (Week 1):
- **TTFB**: < 400ms (p95)
- **Error Rate**: < 0.5%
- **Uptime**: > 99.9%
- **WebSocket Connections**: Stable for > 1 hour

**Monitor**:
```bash
# Watch CloudWatch metrics
watch -n 10 'aws cloudwatch get-metric-statistics \
  --namespace VoiceJibJab \
  --metric-name TTFB \
  --start-time $(date -u -d "5 minutes ago" +"%Y-%m-%dT%H:%M:%S") \
  --end-time $(date -u +"%Y-%m-%dT%H:%M:%S") \
  --period 60 \
  --statistics Average'
```

---

## Appendix A: Troubleshooting

### Common Issues

**Issue**: WebSocket connections dropping
**Solution**: Increase ALB idle timeout to 3600s

**Issue**: High memory usage
**Solution**: Enable Node.js memory profiling, check for leaks

**Issue**: OpenAI API rate limits
**Solution**: Implement exponential backoff, request quota increase

**Issue**: CORS errors in production
**Solution**: Verify `ALLOWED_ORIGINS` includes production domain

---

## Appendix B: Contact & Support

**On-Call Engineer**: @your-team (PagerDuty)
**Documentation**: https://docs.yourdomain.com
**Status Page**: https://status.yourdomain.com

---

**Document Owner**: DevOps Team
**Review Schedule**: Quarterly
**Next Review**: 2026-04-10
