const CI_TEST_DB_PASSWORD = 'ci-test-db-password'
const CI_TEST_JWT_SECRET = 'ci-test-jwt-secret-key-at-least-32-characters'

process.env.NODE_ENV = 'test'
process.env.DB_PASSWORD ||= CI_TEST_DB_PASSWORD
process.env.JWT_SECRET ||= CI_TEST_JWT_SECRET
