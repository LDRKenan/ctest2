const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { logger } = require('../middleware/logger');

const execAsync = promisify(exec);

class DeploymentAutomation {
    constructor() {
        this.deploymentConfigs = {
            web: {
                vercel: this.deployToVercel.bind(this),
                netlify: this.deployToNetlify.bind(this),
                aws: this.deployToAWS.bind(this)
            },
            backend: {
                railway: this.deployToRailway.bind(this),
                heroku: this.deployToHeroku.bind(this),
                aws: this.deployBackendToAWS.bind(this)
            },
            ios: {
                appstore: this.deployToAppStore.bind(this)
            },
            android: {
                playstore: this.deployToPlayStore.bind(this)
            }
        };
    }

    async deployProject(projectPath, platform, deploymentTarget, config = {}) {
        try {
            logger.info({
                message: 'Starting deployment',
                platform,
                deploymentTarget,
                projectPath
            });

            const deploymentFunction = this.deploymentConfigs[platform]?.[deploymentTarget];
            
            if (!deploymentFunction) {
                throw new Error(`Deployment target ${deploymentTarget} not supported for platform ${platform}`);
            }

            // Pre-deployment setup
            await this.setupDeploymentEnvironment(projectPath, platform, config);

            // Execute deployment
            const result = await deploymentFunction(projectPath, config);

            logger.info({
                message: 'Deployment completed successfully',
                platform,
                deploymentTarget,
                result
            });

            return result;

        } catch (error) {
            logger.error({
                message: 'Deployment failed',
                platform,
                deploymentTarget,
                error: error.message
            });
            throw error;
        }
    }

    async setupDeploymentEnvironment(projectPath, platform, config) {
        // Create deployment configuration files
        switch (platform) {
            case 'web':
                await this.createWebDeploymentConfig(projectPath, config);
                break;
            case 'backend':
                await this.createBackendDeploymentConfig(projectPath, config);
                break;
            case 'ios':
                await this.createIOSDeploymentConfig(projectPath, config);
                break;
            case 'android':
                await this.createAndroidDeploymentConfig(projectPath, config);
                break;
        }
    }

    async createWebDeploymentConfig(projectPath, config) {
        // Vercel configuration
        const vercelConfig = {
            name: config.appName || 'generated-app',
            version: 2,
            builds: [
                {
                    src: 'package.json',
                    use: '@vercel/next'
                }
            ],
            env: config.environmentVariables || {}
        };

        await fs.writeJson(path.join(projectPath, 'vercel.json'), vercelConfig, { spaces: 2 });

        // Netlify configuration
        const netlifyConfig = {
            build: {
                command: 'npm run build',
                publish: '.next'
            },
            redirects: [
                {
                    from: '/api/*',
                    to: '/.netlify/functions/:splat',
                    status: 200
                }
            ]
        };

        await fs.writeJson(path.join(projectPath, 'netlify.toml'), netlifyConfig);
    }

    async createBackendDeploymentConfig(projectPath, config) {
        // Railway configuration
        const railwayConfig = {
            deploy: {
                startCommand: 'npm start',
                healthcheckPath: '/health'
            }
        };

        await fs.writeJson(path.join(projectPath, 'railway.json'), railwayConfig, { spaces: 2 });

        // Dockerfile for containerized deployments
        const dockerfile = `
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
`;

        await fs.writeFile(path.join(projectPath, 'Dockerfile'), dockerfile.trim());

        // Docker compose for local development
        const dockerCompose = `
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    depends_on:
      - mongodb
  
  mongodb:
    image: mongo:latest
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db

volumes:
  mongodb_data:
`;

        await fs.writeFile(path.join(projectPath, 'docker-compose.yml'), dockerCompose.trim());
    }

    async createIOSDeploymentConfig(projectPath, config) {
        // Fastlane configuration
        const fastfileContent = `
default_platform(:ios)

platform :ios do
  desc "Build and upload to TestFlight"
  lane :beta do
    build_app(scheme: "${config.appName || 'App'}")
    upload_to_testflight
  end

  desc "Build and upload to App Store"
  lane :release do
    build_app(scheme: "${config.appName || 'App'}")
    upload_to_app_store
  end
end
`;

        const fastlaneDir = path.join(projectPath, 'fastlane');
        await fs.ensureDir(fastlaneDir);
        await fs.writeFile(path.join(fastlaneDir, 'Fastfile'), fastfileContent.trim());

        // App configuration
        const appConfig = {
            app_identifier: config.bundleId || `com.codemia.${config.appName?.toLowerCase() || 'app'}`,
            apple_id: config.appleId || '',
            team_id: config.teamId || ''
        };

        await fs.writeFile(path.join(fastlaneDir, 'Appfile'), 
            Object.entries(appConfig).map(([key, value]) => `${key} "${value}"`).join('\n')
        );
    }

    async createAndroidDeploymentConfig(projectPath, config) {
        // Fastlane configuration for Android
        const fastfileContent = `
default_platform(:android)

platform :android do
  desc "Build and upload to Play Store Internal Testing"
  lane :internal do
    gradle(task: "bundleRelease")
    upload_to_play_store(track: 'internal')
  end

  desc "Build and upload to Play Store"
  lane :release do
    gradle(task: "bundleRelease")
    upload_to_play_store
  end
end
`;

        const fastlaneDir = path.join(projectPath, 'fastlane');
        await fs.ensureDir(fastlaneDir);
        await fs.writeFile(path.join(fastlaneDir, 'Fastfile'), fastfileContent.trim());

        // Gradle signing configuration
        const signingConfig = `
android {
    signingConfigs {
        release {
            storeFile file("${config.keystorePath || 'release-key.keystore'}")
            storePassword "${config.keystorePassword || ''}"
            keyAlias "${config.keyAlias || 'release'}"
            keyPassword "${config.keyPassword || ''}"
        }
    }
    
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
`;

        const buildGradlePath = path.join(projectPath, 'app', 'build.gradle');
        if (await fs.pathExists(buildGradlePath)) {
            let buildGradle = await fs.readFile(buildGradlePath, 'utf8');
            buildGradle += '\n' + signingConfig;
            await fs.writeFile(buildGradlePath, buildGradle);
        }
    }

    // Platform-specific deployment methods
    async deployToVercel(projectPath, config) {
        try {
            // Install Vercel CLI if not present
            await execAsync('npm install -g vercel', { cwd: projectPath });
            
            // Deploy to Vercel
            const { stdout } = await execAsync('vercel --prod --yes', { cwd: projectPath });
            
            const deploymentUrl = stdout.match(/https:\/\/[^\s]+/)?.[0];
            
            return {
                platform: 'vercel',
                url: deploymentUrl,
                status: 'deployed'
            };
        } catch (error) {
            throw new Error(`Vercel deployment failed: ${error.message}`);
        }
    }

    async deployToNetlify(projectPath, config) {
        try {
            await execAsync('npm install -g netlify-cli', { cwd: projectPath });
            await execAsync('netlify build', { cwd: projectPath });
            const { stdout } = await execAsync('netlify deploy --prod', { cwd: projectPath });
            
            const deploymentUrl = stdout.match(/https:\/\/[^\s]+/)?.[0];
            
            return {
                platform: 'netlify',
                url: deploymentUrl,
                status: 'deployed'
            };
        } catch (error) {
            throw new Error(`Netlify deployment failed: ${error.message}`);
        }
    }

    async deployToRailway(projectPath, config) {
        try {
            await execAsync('npm install -g @railway/cli', { cwd: projectPath });
            const { stdout } = await execAsync('railway deploy', { cwd: projectPath });
            
            return {
                platform: 'railway',
                status: 'deployed',
                logs: stdout
            };
        } catch (error) {
            throw new Error(`Railway deployment failed: ${error.message}`);
        }
    }

    async deployToAppStore(projectPath, config) {
        try {
            // Requires Fastlane setup
            await execAsync('bundle install', { cwd: projectPath });
            await execAsync('bundle exec fastlane beta', { cwd: projectPath });
            
            return {
                platform: 'ios',
                target: 'testflight',
                status: 'uploaded'
            };
        } catch (error) {
            throw new Error(`App Store deployment failed: ${error.message}`);
        }
    }

    async deployToPlayStore(projectPath, config) {
        try {
            await execAsync('bundle install', { cwd: projectPath });
            await execAsync('bundle exec fastlane internal', { cwd: projectPath });
            
            return {
                platform: 'android',
                target: 'internal_testing',
                status: 'uploaded'
            };
        } catch (error) {
            throw new Error(`Play Store deployment failed: ${error.message}`);
        }
    }

    async deployToAWS(projectPath, config) {
        // AWS deployment using CDK or CloudFormation
        const cdkConfig = {
            app: 'npx ts-node bin/app.ts',
            context: {
                '@aws-cdk/core:enableStackNameDuplicates': true,
                '@aws-cdk/core:stackRelativeExports': true
            }
        };

        await fs.writeJson(path.join(projectPath, 'cdk.json'), cdkConfig, { spaces: 2 });
        
        return {
            platform: 'aws',
            status: 'configuration_created',
            message: 'AWS CDK configuration created. Run "cdk deploy" to deploy.'
        };
    }

    async deployBackendToAWS(projectPath, config) {
        // Similar to deployToAWS but for backend services
        return this.deployToAWS(projectPath, config);
    }

    async deployToHeroku(projectPath, config) {
        try {
            // Create Procfile
            await fs.writeFile(path.join(projectPath, 'Procfile'), 'web: npm start');
            
            await execAsync('git init', { cwd: projectPath });
            await execAsync('git add .', { cwd: projectPath });
            await execAsync('git commit -m "Initial commit"', { cwd: projectPath });
            
            const appName = config.appName || `codemia-${Date.now()}`;
            await execAsync(`heroku create ${appName}`, { cwd: projectPath });
            await execAsync('git push heroku main', { cwd: projectPath });
            
            return {
                platform: 'heroku',
                appName,
                url: `https://${appName}.herokuapp.com`,
                status: 'deployed'
            };
        } catch (error) {
            throw new Error(`Heroku deployment failed: ${error.message}`);
        }
    }

    async generateDeploymentGuide(platforms, deploymentTargets) {
        const guide = `# Deployment Guide

## Generated App Deployment Instructions

### Prerequisites
- Node.js 18+ installed
- Git installed
- Platform-specific CLI tools installed

### Deployment Steps

${platforms.map(platform => {
    const target = deploymentTargets[platform] || 'default';
    return this.generatePlatformGuide(platform, target);
}).join('\n\n')}

### Environment Variables
Make sure to set the following environment variables in your deployment platform:
- \`NODE_ENV=production\`
- \`DATABASE_URL=your_database_connection_string\`
- \`JWT_SECRET=your_jwt_secret\`
- \`API_KEYS=your_api_keys\`

### Monitoring and Maintenance
- Set up error tracking (Sentry, Bugsnag)
- Configure logging aggregation
- Set up uptime monitoring
- Enable automatic backups for databases

### Troubleshooting
- Check deployment logs for errors
- Verify environment variables are set correctly
- Ensure all dependencies are properly installed
- Test API endpoints after deployment
`;

        return guide;
    }

    generatePlatformGuide(platform, target) {
        const guides = {
            web: {
                vercel: `#### Web App - Vercel Deployment
1. Install Vercel CLI: \`npm install -g vercel\`
2. Navigate to web directory: \`cd web\`
3. Deploy: \`vercel --prod\`
4. Follow prompts to configure domain and settings`,
                
                netlify: `#### Web App - Netlify Deployment
1. Install Netlify CLI: \`npm install -g netlify-cli\`
2. Navigate to web directory: \`cd web\`
3. Build: \`npm run build\`
4. Deploy: \`netlify deploy --prod --dir=.next\``
            },
            backend: {
                railway: `#### Backend - Railway Deployment
1. Install Railway CLI: \`npm install -g @railway/cli\`
2. Navigate to backend directory: \`cd backend\`
3. Login: \`railway login\`
4. Deploy: \`railway deploy\``,
                
                heroku: `#### Backend - Heroku Deployment
1. Install Heroku CLI
2. Navigate to backend directory: \`cd backend\`
3. Create app: \`heroku create your-app-name\`
4. Deploy: \`git push heroku main\``
            },
            ios: {
                appstore: `#### iOS App - App Store Deployment
1. Install Fastlane: \`gem install fastlane\`
2. Navigate to iOS directory: \`cd ios\`
3. Setup certificates: \`fastlane match\`
4. Deploy to TestFlight: \`fastlane beta\`
5. Submit for review: \`fastlane release\``
            },
            android: {
                playstore: `#### Android App - Play Store Deployment
1. Install Fastlane: \`gem install fastlane\`
2. Navigate to Android directory: \`cd android\`
3. Build release: \`./gradlew bundleRelease\`
4. Deploy to internal testing: \`fastlane internal\`
5. Promote to production: \`fastlane release\``
            }
        };

        return guides[platform]?.[target] || `#### ${platform} - ${target} deployment guide not available`;
    }
}

module.exports = DeploymentAutomation;
