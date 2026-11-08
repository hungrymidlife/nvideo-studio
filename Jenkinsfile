pipeline {
  agent any
  options {
    skipDefaultCheckout(true)
    disableConcurrentBuilds()
    timestamps()
    timeout(time: 120, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '25', artifactNumToKeepStr: '10'))
  }
  parameters {
    string(name: 'RELEASE_PROFILES', defaultValue: '', description: 'Opt-in unsigned Windows portable profiles, comma-separated (e.g. core-release,media-release,library-release). Empty: existing verification only.')
  }
  // Poll changes every ~30 minutes (Jenkins H/30): main always validates, development branches require [ci-ready].
  triggers {
    pollSCM('H/30 * * * *')
  }
  stages {
    stage('Checkout configured SCM branch') {
      steps {
        script {
          def checkoutInfo = checkout scm
          env.CI_SHA = bat(returnStdout: true, script: '@git rev-parse HEAD').trim()
          if (!(env.CI_SHA ==~ /(?i)[0-9a-f]{40}/)) {
            error('Invalid checked-out commit SHA')
          }
          // Git plugin SCM metadata still identifies the branch when HEAD is detached.
          def scmBranch = (checkoutInfo?.GIT_BRANCH ?: env.GIT_BRANCH ?: env.BRANCH_NAME ?: '').trim()
          if (!scmBranch) {
            error('Cannot identify configured SCM branch; CI policy must fail closed.')
          }
          env.CI_CHECKOUT_BRANCH = scmBranch
          echo "Validation commit: ${env.CI_SHA}; checkout branch: ${env.CI_CHECKOUT_BRANCH}"
          // Main always validates. Other branches run full checks on final [ci-ready] commits.
          def gateExit = bat(returnStatus: true,
            script: '@node desktop-tauri\\ci\\jenkins\\ci-ready-gate.mjs')
          if (gateExit == 0) {
            env.CI_READY = 'true'
            echo 'CI gate: branch policy permits full verification.'
          } else if (gateExit == 2) {
            env.CI_READY = 'false'
            echo 'CI gate: unmarked development commit; skip validation and GitHub reporting.'
            currentBuild.result = 'NOT_BUILT'
          } else {
            error("CI readiness gate failed (exit ${gateExit}); no report is published.")
          }
        }
      }
    }
    stage('Install pinned Node dependencies') {
      when { expression { env.CI_READY == 'true' } }
      steps {
        dir('desktop-tauri') {
          bat 'call npm ci --no-audit --no-fund'
        }
      }
    }
    stage('Run the existing five-stage verification') {
      when { expression { env.CI_READY == 'true' } }
      steps {
        dir('desktop-tauri') {
          bat 'call .\\ci\\jenkins\\VERIFY_AND_LOG.bat'
        }
      }
    }
    stage('Opt-in selective release matrix') {
      when { expression { env.CI_READY == 'true' && params.RELEASE_PROFILES?.trim() } }
      steps {
        script {
          def requested = params.RELEASE_PROFILES.trim().split(',', -1).toList()
          if (requested.size() > 12 || requested.any { !(it ==~ /[a-z][a-z0-9-]{0,39}/) } || requested.unique(false).size() != requested.size()) {
            error('RELEASE_PROFILES requires unique lowercase profile IDs separated by commas, without paths or whitespace.')
          }
          // Interpolation is safe only after the exact allowlist above; no free-form command reaches cmd.exe.
          withEnv(["NVIDEO_RELEASE_PROFILES=${requested.join(' ')}"]) {
            dir('desktop-tauri') {
              bat '@node --experimental-strip-types scripts\\release-build.mjs matrix %NVIDEO_RELEASE_PROFILES% --strict-clean'
            }
          }
          archiveArtifacts artifacts: 'desktop-tauri/release-artifacts/**/artifacts.json,desktop-tauri/release-artifacts/**/smoke-result.json,desktop-tauri/release-artifacts/**/NVideoStudio_Portable.zip', fingerprint: true, allowEmptyArchive: false
        }
      }
    }
  }
  post {
    always {
      script {
        if (env.CI_READY == 'true') {
          archiveArtifacts artifacts: 'nvideo-ci.log', allowEmptyArchive: true
          if (env.CI_SHA?.trim()) {
          try {
            withCredentials([string(credentialsId: 'nvideo-github-report', variable: 'GH_CI_TOKEN')]) {
              def outcome = currentBuild.currentResult == 'SUCCESS' ? 'success' : 'failure'
              withEnv(["CI_REPORT_STATE=${outcome}"]) {
                dir('desktop-tauri') {
                  def resultCode = bat(returnStatus: true, script:
                    '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass ' +
                    '-File "ci\\jenkins\\publish-result.ps1" ' +
                    '-Commit "%CI_SHA%" -State "%CI_REPORT_STATE%" ' +
                    '-LogPath "%WORKSPACE%\\nvideo-ci.log"'
                  )
                  if (resultCode != 0) {
                    echo "WARNING: GitHub status publication failed (exit ${resultCode})."
                    if (outcome == 'success') {
                      unstable('Validation passed, but GitHub CI status could not be published.')
                    }
                  }
                }
              }
            }
          } catch (err) {
            echo "WARNING: GitHub result reporting unavailable: ${err.getMessage()}"
            if (currentBuild.currentResult == 'SUCCESS') {
              unstable('GitHub reporting credential or publishing step is not configured.')
            }
          }
          } else {
            echo 'WARNING: Checkout failed; no commit SHA available for GitHub status.'
          }
        } else {
          echo 'CI gate: skipped development commit; no artifacts or GitHub Commit Status/Issue.'
        }
      }
    }
  }
}
