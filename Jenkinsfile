// art_data CI — Multibranch / PR Pipeline
// Jenkins: New Item → Multibranch Pipeline → Script Path: Jenkinsfile
// Requires: NodeJS tool id "node-24" (or agent has Node 24 on PATH)

pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds(abortPrevious: true)
    timeout(time: 30, unit: 'MINUTES')
  }

  environment {
    NODE_VERSION = '24'
    NODE_ENV_TEST = 'test'
  }

  tools {
    nodejs 'node-24'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Install') {
      steps {
        withCredentials([string(credentialsId: 'art-data-node-auth-token', variable: 'NODE_AUTH_TOKEN')]) {
          sh 'npm ci'
        }
      }
    }

    stage('Lint') {
      steps {
        sh 'npm run lint'
      }
    }

    stage('Test') {
      steps {
        sh '''
          export NODE_ENV=test
          export DB_PASSWORD=ci-test-db-password
          export JWT_SECRET=ci-test-jwt-secret-key-at-least-32-characters
          export OSS_ACCESS_KEY_ID=ci-test-oss-access-key-id
          export OSS_ACCESS_KEY_SECRET=ci-test-oss-access-key-secret
          export OSS_BUCKET=ci-test-bucket
          export OSS_REGION=oss-cn-hangzhou
          npm run test
        '''
      }
    }

    stage('Build') {
      steps {
        withCredentials([string(credentialsId: 'art-data-vite-api-sign-secret', variable: 'VITE_API_SIGN_SECRET')]) {
          sh '''
            export NODE_ENV=production
            export VITE_PUBLIC_API_BASE_URL="${VITE_PUBLIC_API_BASE_URL:-https://api.wx.2000gallery.art}"
            export VITE_OSS_PUBLIC_ORIGIN="${VITE_OSS_PUBLIC_ORIGIN:-https://wx.oss.2000gallery.art}"
            export VITE_API_SIGN_KEY="${VITE_API_SIGN_KEY:-admin-web}"
            npm run build
          '''
        }
      }
    }

    stage('Optional audits') {
      parallel {
        stage('OpenAPI') {
          steps {
            catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
              sh 'npm run audit:openapi'
            }
          }
        }
        stage('Deps') {
          steps {
            catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
              sh 'npm run audit:deps'
            }
          }
        }
      }
    }
  }

  post {
    success {
      archiveArtifacts artifacts: 'dist/**', fingerprint: true, allowEmptyArchive: true
    }
  }
}
