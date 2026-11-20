
const pool = require("./db");

async function testConnection() {
  try {
    const result = await pool.query("SELECT version(), current_database()");

    console.log("Connexion PostgreSQL réussie !");
    console.log("Base de données :", result.rows[0].current_database);
    console.log("Version :", result.rows[0].version);
  } catch (error) {
    console.error("Échec de connexion :", error.message);
  } finally {
    await pool.end();
  }
}

testConnection();