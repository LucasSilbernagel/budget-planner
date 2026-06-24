// Simple database connection test using Node.js native ES modules
// Run with: DATABASE_URL="postgresql://user:password@localhost:5432/db" node test-db-simple.mjs
// Example: DATABASE_URL=postgresql://budget-planner-user:CHANGE_ME@localhost:5432/budget-planner-dev

import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL || ''

if (!databaseUrl || databaseUrl.trim() === '') {
  console.error('❌ DATABASE_URL environment variable is not set')
  console.error(
    'Example: DATABASE_URL=postgresql://budget-planner-user:yourpassword@localhost:5432/budget-planner-dev'
  )
  process.exit(1)
}

console.log('🔍 Testing PostgreSQL connection with pg...')
console.log('Connection string:', databaseUrl.replace(/:([^@]+)@/, ':****@'))

const pool = new Pool({ connectionString: databaseUrl })

async function testConnection() {
  try {
    const client = await pool.connect()
    console.log('✅ Connected to PostgreSQL')

    // Test basic query
    const result = await client.query('SELECT 1 as test_value')
    console.log('✅ Basic query test:', result.rows[0])

    // List tables
    const tables = await client.query(
      `SELECT table_name FROM information_schema.tables 
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE' 
       ORDER BY table_name`
    )
    console.log(
      '\n✅ Tables found:',
      tables.rows.map((r) => r.table_name)
    )

    // Test counting rows in each table
    const tableNames = tables.rows.map((r) => r.table_name)
    for (const tableName of tableNames) {
      // Use parameterized query to prevent SQL injection
      const count = await client.query('SELECT COUNT(*) as count FROM $1::regclass', [tableName])
      console.log(`   - ${tableName}: ${count.rows[0].count} rows`)
    }

    client.release()
    await pool.end()

    console.log('\n🎉 All pg connection tests passed!')
    console.log('✅ PostgreSQL is correctly configured and accessible.')

    return true
  } catch (error) {
    console.error('❌ Database connection test failed:', error.message)
    if (error.stack) console.error('Stack:', error.stack)
    return false
  }
}

testConnection()
  .then((success) => {
    process.exit(success ? 0 : 1)
  })
  .catch(() => {
    process.exit(1)
  })
