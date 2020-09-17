const {
  Pool,
  Client
} = require("pg");
require('dotenv').config()
const connectionString = process.env.DB_CONNECTION_STRING;
const pool = new Pool({
  connectionString: connectionString
});


module.exports = {
  pool: pool,
  Client: Client,
  Pool: Pool
}
