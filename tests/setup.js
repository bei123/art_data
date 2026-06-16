const CI_TEST_DB_PASSWORD = 'ci-test-db-password'
const CI_TEST_JWT_SECRET = 'ci-test-jwt-secret-key-at-least-32-characters'

const CI_TEST_ENV_DEFAULTS = {
  NODE_ENV: 'test',
  DB_PASSWORD: CI_TEST_DB_PASSWORD,
  JWT_SECRET: CI_TEST_JWT_SECRET,
  OSS_ACCESS_KEY_ID: 'ci-test-oss-access-key-id',
  OSS_ACCESS_KEY_SECRET: 'ci-test-oss-access-key-secret',
  OSS_BUCKET: 'ci-test-bucket',
  OSS_REGION: 'oss-cn-hangzhou',
}

for (const [key, value] of Object.entries(CI_TEST_ENV_DEFAULTS)) {
  process.env[key] ||= value
}