require("dotenv").config();

/* =========================
   MYSQL (Your existing app DB)
   ========================= */
const mysql = require("mysql2/promise");

const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

console.log("✅ MySQL pool initialized");

/* =========================
   MSSQL (Sage 200 Evolution)
   ========================= */
const sql = require("mssql");

function buildSageConfig({ user, password, host, database }) {
  return {
    user: user || "sa",
    password,
    server: host || "localhost",
    database,
    port: 1433,
    options: {
      encrypt: false,
      trustServerCertificate: true,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };
}

// const sageConfig = {
//   user: process.env.SAGE_DB_USER || "sa",
//   password: process.env.SAGE_DB_PASSWORD,
//   server: process.env.SAGE_DB_HOST, // e.g. 192.168.1.20
//   database: process.env.SAGE_DB_NAME, // EvolutionCompany
//   port: 1433,
//   options: {
//     encrypt: false,
//     trustServerCertificate: true,
//   },
//   pool: {
//     max: 10,
//     min: 0,
//     idleTimeoutMillis: 30000,
//   },
// };

let sagePool;

async function getSagePool({ user, password, host, database }) {
  if (!sagePool) {
    sagePool = await sql.connect(
      buildSageConfig({ user, password, host, database })
    );
    console.log("✅ Connected to Sage 200 Evolution DB");
  }
  return sagePool;
}
module.exports = {
  db,
  sql,
  getSagePool,
};
